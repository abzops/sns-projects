import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTaskStatuses } from './useTaskStatuses';
import { useMembers } from './useMembers';

function enrichTasks(tasks, statuses, members, raciRows = [], subtasksByTaskId = new Map()) {
  const statusesById = new Map((statuses || []).map((status) => [status.id, status]));
  const membersByUserId = new Map((members || []).filter((member) => member.user_id).map((member) => [member.user_id, member]));

  const raciByTaskId = new Map();
  for (const raci of raciRows) {
    if (!raciByTaskId.has(raci.task_id)) {
      raciByTaskId.set(raci.task_id, []);
    }
    raciByTaskId.get(raci.task_id).push(raci);
  }

  return (tasks || []).map((task) => {
    const status = statusesById.get(task.status_id);
    const assigneeMember = task.assignee_id ? membersByUserId.get(task.assignee_id) : null;

    const taskRaci = raciByTaskId.get(task.id) || [];
    const responsible = taskRaci.filter((r) => r.raci_role === 'R');
    const accountable = taskRaci.find((r) => r.raci_role === 'A') || null;
    const consulted = taskRaci.filter((r) => r.raci_role === 'C');
    const informed = taskRaci.filter((r) => r.raci_role === 'I');
    const raciComplete = responsible.length > 0 && !!accountable;

    const subtaskStats = subtasksByTaskId.get(task.id) || { total: 0, completed: 0 };

    return {
      ...task,
      task_statuses: status ? { id: status.id, name: status.name, color: status.color, system_code: status.system_code } : null,
      assignee: assigneeMember?.profiles || null,
      raci: {
        all: taskRaci,
        responsible,
        accountable,
        consulted,
        informed,
        isComplete: raciComplete,
      },
      subtask_count: subtaskStats.total,
      subtasks_completed_count: subtaskStats.completed,
    };
  });
}


export function useTasks(projectId, workspaceId) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const { statuses } = useTaskStatuses(projectId);
  const { members } = useMembers(workspaceId);

  const fetchTasks = useCallback(
    async (options = {}) => {
      const isSilent = options?.silent ?? false;
      if (!projectId || !user) {
        setTasks([]);
        setInitialLoading(false);
        setRefreshing(false);
        return;
      }

      if (!isSilent) {
        setInitialLoading((prev) => (tasks.length === 0 ? true : prev));
        setRefreshing(true);
      }

      setError(null);

      const supabase = getSupabase();
      const { data, error: fetchError } = await supabase
        .from('tasks')
        .select(`
          id,
          project_id,
          phase_id,
          task_list_id,
          title,
          description,
          status_id,
          priority,
          assignee_id,
          due_date,
          position,
          created_by,
          created_at,
          updated_at,
          phases:phase_id (
            id,
            name,
            start_date,
            end_date
          ),
          task_lists:task_list_id (
            id,
            name
          )
        `)
        .eq('project_id', projectId)
        .order('position', { ascending: true });

      if (fetchError) {
        console.error('Error fetching tasks:', fetchError);
        setError(fetchError);
        setInitialLoading(false);
        setRefreshing(false);
        return;
      }

      const taskIds = (data || []).map((t) => t.id);
      let raciRows = [];
      const subtasksByTaskId = new Map();

      if (taskIds.length > 0) {
        // 1. Fetch RACI assignments
        const { data: raciData, error: raciError } = await supabase
          .from('task_raci_assignments')
          .select(`
            id,
            task_id,
            raci_role,
            user_id,
            department_id,
            created_by,
            created_at,
            profiles:user_id (
              id,
              full_name,
              avatar_url
            ),
            departments:department_id (
              id,
              code,
              name,
              color
            )
          `)
          .in('task_id', taskIds);

        if (!raciError) {
          raciRows = raciData || [];
        }

        // 2. Fetch Subtask stats
        const { data: subtaskData } = await supabase
          .from('subtasks')
          .select('id, task_id, status')
          .in('task_id', taskIds);

        if (subtaskData) {
          for (const st of subtaskData) {
            if (!subtasksByTaskId.has(st.task_id)) {
              subtasksByTaskId.set(st.task_id, { total: 0, completed: 0 });
            }
            const s = subtasksByTaskId.get(st.task_id);
            if (st.status !== 'cancelled') {
              s.total += 1;
              if (st.status === 'done') {
                s.completed += 1;
              }
            }
          }
        }
      }

      setTasks(enrichTasks(data || [], statuses, members, raciRows, subtasksByTaskId));
      setInitialLoading(false);
      setRefreshing(false);
    },
    [projectId, user, statuses, members, tasks.length]
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = async (taskData) => {
    const supabase = getSupabase();
    const targetStatusId = taskData.status_id || statuses?.[0]?.id || null;
    const maxPosition = tasks
      .filter((task) => task.status_id === targetStatusId)
      .reduce((max, task) => Math.max(max, task.position ?? 0), -1);

    // Validate hierarchy consistency if phase or task_list is provided
    const phaseId = taskData.phase_id || null;
    const taskListId = taskData.task_list_id || null;

    if ((phaseId && !taskListId) || (!phaseId && taskListId)) {
      return {
        data: null,
        error: new Error('Structured tasks must specify both Phase and Task List (or leave both empty for uncategorized).'),
      };
    }

    // Determine Accountable and Responsible users
    const accountableUserId = taskData.accountable_id || taskData.assignee_id || user.id;
    const responsibleUserId = taskData.responsible_id || taskData.assignee_id || user.id;

    if (!accountableUserId || !responsibleUserId) {
      return {
        data: null,
        error: new Error('New tasks require at least 1 Responsible and exactly 1 Accountable user.'),
      };
    }

    // Insert task
    const { data: createdTask, error: insertError } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        phase_id: phaseId,
        task_list_id: taskListId,
        title: taskData.title?.trim(),
        description: taskData.description?.trim() || null,
        status_id: targetStatusId,
        priority: taskData.priority || 'none',
        assignee_id: accountableUserId || null,
        due_date: taskData.due_date || null,
        position: maxPosition + 1,
        created_by: user.id,
      })
      .select(`
        id,
        project_id,
        phase_id,
        task_list_id,
        title,
        description,
        status_id,
        priority,
        assignee_id,
        due_date,
        position,
        created_by,
        created_at,
        updated_at
      `)
      .single();

    if (insertError) {
      return { data: null, error: insertError };
    }

    // Mandatory RACI insertion with atomic compensation rollback
    const raciInserts = [];
    // 1. Accountable (A) - exactly 1
    raciInserts.push({
      task_id: createdTask.id,
      raci_role: 'A',
      user_id: accountableUserId,
      created_by: user.id,
    });

    // 2. Responsible (R) - at least 1
    if (responsibleUserId !== accountableUserId) {
      raciInserts.push({
        task_id: createdTask.id,
        raci_role: 'R',
        user_id: responsibleUserId,
        created_by: user.id,
      });
    } else {
      raciInserts.push({
        task_id: createdTask.id,
        raci_role: 'R',
        user_id: responsibleUserId,
        created_by: user.id,
      });
    }

    // 3. Additional Consulted / Informed if provided
    if (Array.isArray(taskData.consulted_ids)) {
      for (const cId of taskData.consulted_ids) {
        if (cId) raciInserts.push({ task_id: createdTask.id, raci_role: 'C', user_id: cId, created_by: user.id });
      }
    }
    if (Array.isArray(taskData.informed_ids)) {
      for (const iId of taskData.informed_ids) {
        if (iId) raciInserts.push({ task_id: createdTask.id, raci_role: 'I', user_id: iId, created_by: user.id });
      }
    }

    const { error: raciInsertErr } = await supabase
      .from('task_raci_assignments')
      .insert(raciInserts);

    if (raciInsertErr) {
      console.error('RACI insertion failed; rolling back task creation:', raciInsertErr);
      await supabase.from('tasks').delete().eq('id', createdTask.id);
      return { data: null, error: new Error(`Failed to assign mandatory RACI: ${raciInsertErr.message}`) };
    }

    await fetchTasks({ silent: true });
    return { data: createdTask, error: null };
  };

  const updateTask = async (id, updates) => {
    const supabase = getSupabase();
    const payload = {
      title: updates.title,
      description: updates.description || null,
      status_id: updates.status_id || null,
      priority: updates.priority || 'none',
      assignee_id: updates.assignee_id || null,
      due_date: updates.due_date || null,
      position: updates.position ?? 0,
      updated_at: new Date().toISOString(),
    };

    if ('phase_id' in updates) {
      payload.phase_id = updates.phase_id || null;
    }
    if ('task_list_id' in updates) {
      payload.task_list_id = updates.task_list_id || null;
    }

    // If updating hierarchy, validate both or none
    if ('phase_id' in payload || 'task_list_id' in payload) {
      const pId = 'phase_id' in payload ? payload.phase_id : updates.phase_id;
      const tlId = 'task_list_id' in payload ? payload.task_list_id : updates.task_list_id;
      if ((pId && !tlId) || (!pId && tlId)) {
        return {
          data: null,
          error: new Error('Structured tasks must specify both Phase and Task List (or leave both empty for uncategorized).'),
        };
      }
    }

    const { data, error: updateError } = await supabase
      .from('tasks')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (!updateError) {
      await fetchTasks({ silent: true });
    }

    return { data, error: updateError };
  };

  const deleteTask = async (id) => {
    const supabase = getSupabase();
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);

    if (!deleteError) {
      await fetchTasks({ silent: true });
    }

    return { error: deleteError };
  };

  const reorderTask = async (taskId, newStatusId, sourceTaskIdsOrOptions, destinationTaskIdsParam) => {
    const supabase = getSupabase();

    let sourceTaskIds = [];
    let destinationTaskIds = [];

    const currentTask = tasks.find((t) => t.id === taskId);
    const oldStatusId = currentTask ? currentTask.status_id : newStatusId;

    if (Array.isArray(sourceTaskIdsOrOptions) && Array.isArray(destinationTaskIdsParam)) {
      sourceTaskIds = sourceTaskIdsOrOptions;
      destinationTaskIds = destinationTaskIdsParam;
    } else if (
      sourceTaskIdsOrOptions &&
      typeof sourceTaskIdsOrOptions === 'object' &&
      !Array.isArray(sourceTaskIdsOrOptions)
    ) {
      sourceTaskIds = sourceTaskIdsOrOptions.sourceTaskIds || [];
      destinationTaskIds = sourceTaskIdsOrOptions.destinationTaskIds || [];
    } else if (Array.isArray(sourceTaskIdsOrOptions)) {
      if (oldStatusId === newStatusId) {
        sourceTaskIds = sourceTaskIdsOrOptions;
        destinationTaskIds = sourceTaskIdsOrOptions;
      } else {
        sourceTaskIds = tasks
          .filter((t) => t.status_id === oldStatusId && t.id !== taskId)
          .map((t) => t.id);
        destinationTaskIds = sourceTaskIdsOrOptions;
      }
    } else {
      sourceTaskIds = tasks
        .filter((t) => t.status_id === oldStatusId && t.id !== taskId)
        .map((t) => t.id);
      destinationTaskIds = [
        ...tasks.filter((t) => t.status_id === newStatusId && t.id !== taskId).map((t) => t.id),
        taskId,
      ];
    }

    // Optimistically update local tasks cache without causing unmount/flicker
    const targetStatus = statuses?.find((s) => s.id === newStatusId);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          return {
            ...t,
            status_id: newStatusId,
            task_statuses: targetStatus
              ? { id: targetStatus.id, name: targetStatus.name, color: targetStatus.color, system_code: targetStatus.system_code }
              : t.task_statuses,
          };
        }
        return t;
      })
    );

    const { data, error: rpcError } = await supabase.rpc('reorder_kanban_tasks', {
      p_task_id: taskId,
      p_new_status_id: newStatusId,
      p_source_task_ids: sourceTaskIds,
      p_destination_task_ids: destinationTaskIds,
    });

    if (rpcError) {
      console.error('Failed to atomically reorder task:', rpcError);
      await fetchTasks({ silent: true });
      return { data: null, error: rpcError };
    }

    // Silently revalidate canonical task state in background
    await fetchTasks({ silent: true });
    return { data, error: null };
  };

  return {
    tasks,
    loading: initialLoading,
    initialLoading,
    refreshing,
    error,
    createTask,
    updateTask,
    deleteTask,
    reorderTask,
    refetch: fetchTasks,
  };
}
