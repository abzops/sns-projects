import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const instanceCache = new Map(); // taskListId -> instanceData

export function useProcessInstance(taskListId) {
  const [instance, setInstance] = useState(() => (taskListId ? instanceCache.get(taskListId) || null : null));
  const [loading, setLoading] = useState(() => (taskListId ? !instanceCache.has(taskListId) : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchInstance = useCallback(async (options = {}) => {
    const isSilent = options?.silent ?? false;
    if (!taskListId) {
      setInstance(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (!isSilent && !instanceCache.has(taskListId)) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      // 1. Fetch task list metadata
      const { data: listData, error: lErr } = await supabase
        .from('task_lists')
        .select(`
          id,
          project_id,
          phase_id,
          name,
          description,
          task_list_type,
          defined_process_id,
          defined_process_version_id,
          process_state,
          started_by,
          started_at,
          completed_at,
          cancelled_by,
          cancelled_at,
          cancellation_reason,
          created_at,
          projects:project_id (
            id,
            name,
            workspace_id,
            color
          ),
          phases:phases!fk_task_lists_phase (
            id,
            name,
            status
          ),
          defined_processes:defined_process_id (
            id,
            name,
            code,
            description,
            departments:department_id (
              id,
              name,
              code
            )
          ),
          defined_process_versions:defined_process_version_id (
            id,
            version_number,
            status,
            change_summary
          ),
          profiles:started_by (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('id', taskListId)
        .single();

      if (lErr) throw lErr;

      // 2. Fetch all defined tasks for this instance
      const { data: tasksData, error: tErr } = await supabase
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
          due_date,
          position,
          defined_process_version_id,
          process_step_id,
          workflow_state,
          current_cycle_number,
          ready_at,
          activated_at,
          workflow_completed_at,
          overdue_cycle_notified,
          created_at,
          updated_at,
          task_statuses:status_id (
            id,
            name,
            color,
            system_code,
            position
          )
        `)
        .eq('task_list_id', taskListId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (tErr) throw tErr;

      const taskIds = (tasksData || []).map((t) => t.id);
      const stepIds = (tasksData || []).map((t) => t.process_step_id).filter(Boolean);

      // Run parallel queries for sub-entities
      const [
        { data: raciData },
        { data: completionsData },
        { data: consultationsData },
        { data: evidenceData },
        { data: approvalData },
        { data: auditData },
        { data: stepsData },
        { data: evidenceDefsData },
      ] = await Promise.all([
        // RACI assignments
        taskIds.length > 0
          ? supabase
              .from('task_raci_assignments')
              .select(`
                id,
                task_id,
                raci_role,
                user_id,
                department_id,
                response_required,
                created_at,
                profiles:user_id (
                  id,
                  full_name,
                  avatar_url
                ),
                departments:department_id (
                  id,
                  name,
                  code
                )
              `)
              .in('task_id', taskIds)
          : Promise.resolve({ data: [] }),

        // Responsible completions
        taskIds.length > 0
          ? supabase
              .from('task_responsible_completions')
              .select(`
                id,
                task_id,
                cycle_number,
                user_id,
                completion_note,
                completed_at,
                profiles:user_id (
                  id,
                  full_name,
                  avatar_url
                )
              `)
              .in('task_id', taskIds)
              .order('completed_at', { ascending: true })
          : Promise.resolve({ data: [] }),

        // Consultation responses
        taskIds.length > 0
          ? supabase
              .from('task_consultation_responses')
              .select(`
                id,
                task_id,
                cycle_number,
                user_id,
                response_text,
                responded_at,
                profiles:user_id (
                  id,
                  full_name,
                  avatar_url
                )
              `)
              .in('task_id', taskIds)
              .order('responded_at', { ascending: true })
          : Promise.resolve({ data: [] }),

        // Evidence submissions
        taskIds.length > 0
          ? supabase
              .from('task_evidence_submissions')
              .select(`
                id,
                task_id,
                cycle_number,
                evidence_def_id,
                evidence_type,
                payload,
                submitted_by,
                submitted_at,
                profiles:submitted_by (
                  id,
                  full_name,
                  avatar_url
                )
              `)
              .in('task_id', taskIds)
              .order('submitted_at', { ascending: true })
          : Promise.resolve({ data: [] }),

        // Approval cycles
        taskIds.length > 0
          ? supabase
              .from('task_approval_cycles')
              .select(`
                id,
                task_id,
                cycle_number,
                status,
                decided_by,
                decided_at,
                rejection_reason,
                new_due_date,
                created_at,
                profiles:decided_by (
                  id,
                  full_name,
                  avatar_url
                )
              `)
              .in('task_id', taskIds)
              .order('cycle_number', { ascending: true })
          : Promise.resolve({ data: [] }),

        // Process audit events
        supabase
          .from('process_audit_events')
          .select(`
            id,
            workspace_id,
            project_id,
            task_list_id,
            task_id,
            event_type,
            actor_id,
            payload,
            created_at,
            profiles:actor_id (
              id,
              full_name,
              avatar_url
            )
          `)
          .eq('task_list_id', taskListId)
          .order('created_at', { ascending: true }),

        // Defined process steps template info
        listData.defined_process_version_id
          ? supabase
              .from('defined_process_steps')
              .select(`
                id,
                step_code,
                title,
                description,
                sequence_order,
                expected_duration_days,
                approval_required,
                consultation_required
              `)
              .eq('version_id', listData.defined_process_version_id)
              .order('sequence_order', { ascending: true })
          : Promise.resolve({ data: [] }),

        // Evidence definitions
        stepIds.length > 0
          ? supabase
              .from('defined_process_step_evidence_defs')
              .select(`
                id,
                step_id,
                title,
                description,
                evidence_type,
                is_mandatory
              `)
              .in('step_id', stepIds)
          : Promise.resolve({ data: [] }),
      ]);

      // Compose client-side state
      const stepsMap = new Map((stepsData || []).map((s) => [s.id, s]));

      const enrichedTasks = (tasksData || []).map((task) => {
        const stepDef = stepsMap.get(task.process_step_id) || {};
        const taskRaci = (raciData || []).filter((r) => r.task_id === task.id);
        const taskCompletions = (completionsData || []).filter(
          (c) => c.task_id === task.id && c.cycle_number === task.current_cycle_number
        );
        const taskConsultations = (consultationsData || []).filter(
          (c) => c.task_id === task.id && c.cycle_number === task.current_cycle_number
        );
        const taskEvidence = (evidenceData || []).filter(
          (e) => e.task_id === task.id && e.cycle_number === task.current_cycle_number
        );
        const currentApproval = (approvalData || []).find(
          (a) => a.task_id === task.id && a.cycle_number === task.current_cycle_number
        );
        const taskEvidenceDefs = (evidenceDefsData || []).filter(
          (ed) => ed.step_id === task.process_step_id
        );

        const responsibleCount = taskRaci.filter((r) => r.raci_role === 'R').length;
        const accountable = taskRaci.find((r) => r.raci_role === 'A');
        const consultedCount = taskRaci.filter((r) => r.raci_role === 'C' && r.response_required).length;

        return {
          ...task,
          step_def: stepDef,
          sequence_order: stepDef.sequence_order || 1,
          approval_required: stepDef.approval_required || false,
          consultation_required: stepDef.consultation_required || false,
          raci: taskRaci,
          responsible_count: responsibleCount,
          responsible_completed_count: taskCompletions.length,
          responsible_completions: taskCompletions,
          accountable_user: accountable,
          consultations_required_count: consultedCount,
          consultation_responses: taskConsultations,
          evidence_submissions: taskEvidence,
          evidence_defs: taskEvidenceDefs,
          approval_cycle: currentApproval || null,
        };
      });

      const totalTasks = enrichedTasks.length;
      const completedTasks = enrichedTasks.filter((t) => t.workflow_state === 'completed').length;
      const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      const instancePayload = {
        ...listData,
        tasks: enrichedTasks,
        audit_events: auditData || [],
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        progress_percent: progressPercent,
      };

      instanceCache.set(taskListId, instancePayload);
      setInstance(instancePayload);
    } catch (err) {
      console.error('[useProcessInstance] Error loading process instance:', err);
      setError(err.message || 'Failed to load process instance.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [taskListId]);

  useEffect(() => {
    fetchInstance();
  }, [fetchInstance]);

  // Workflow RPC actions
  const completeResponsiblePart = async (taskId, note = null) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('complete_responsible_part', {
        p_task_id: taskId,
        p_note: note,
      });
      if (rpcErr) throw rpcErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] completeResponsiblePart error:', err);
      return { success: false, error: err.message || 'Failed to complete your assigned work.' };
    }
  };

  const submitEvidence = async (taskId, evidenceDefId = null, evidenceType = 'text', payload = {}) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('submit_task_evidence', {
        p_task_id: taskId,
        p_evidence_def_id: evidenceDefId,
        p_evidence_type: evidenceType,
        p_payload: payload,
      });
      if (rpcErr) throw rpcErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] submitEvidence error:', err);
      return { success: false, error: err.message || 'Failed to submit evidence.' };
    }
  };

  const submitConsultation = async (taskId, responseText) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('submit_task_consultation', {
        p_task_id: taskId,
        p_response: responseText,
      });
      if (rpcErr) throw rpcErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] submitConsultation error:', err);
      return { success: false, error: err.message || 'Failed to submit consultation.' };
    }
  };

  const approveTask = async (taskId) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('approve_process_task', {
        p_task_id: taskId,
      });
      if (rpcErr) throw rpcErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] approveTask error:', err);
      return { success: false, error: err.message || 'Failed to approve task.' };
    }
  };

  const rejectTask = async (taskId, reason, newDueDate) => {
    try {
      const { data, error: rpcErr } = await supabase.rpc('reject_process_task', {
        p_task_id: taskId,
        p_reason: reason,
        p_new_due_date: newDueDate,
      });
      if (rpcErr) throw rpcErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] rejectTask error:', err);
      return { success: false, error: err.message || 'Failed to reject task.' };
    }
  };

  const getPermissions = async (targetInstanceId) => {
    const id = targetInstanceId || instance?.process_instance_id || instance?.id;
    if (!id) return null;
    try {
      const { data, error: permErr } = await supabase.rpc('get_process_instance_permissions', {
        p_instance_id: id,
      });
      if (permErr) throw permErr;
      return data;
    } catch (err) {
      console.error('[useProcessInstance] getPermissions error:', err);
      return null;
    }
  };

  const moveProcessInstance = async (params = {}) => {
    const {
      instanceId,
      targetPlacementType,
      targetPhaseId = null,
      targetTaskListId = null,
      targetParentTaskId = null,
      reason = '',
    } = params;

    const id = instanceId || instance?.process_instance_id || instance?.id;
    if (!id) {
      return { success: false, error: 'Instance ID required for movement.' };
    }

    try {
      const { data, error: moveErr } = await supabase.rpc('move_process_instance', {
        p_instance_id: id,
        p_target_placement_type: targetPlacementType,
        p_target_phase_id: targetPhaseId,
        p_target_task_list_id: targetTaskListId,
        p_target_parent_task_id: targetParentTaskId,
        p_reason: reason,
      });
      if (moveErr) throw moveErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] moveProcessInstance error:', err);
      return { success: false, error: err.message || 'Failed to move process instance.' };
    }
  };

  const cancelProcessInstance = async (reason, targetInstanceId = null) => {
    const id = targetInstanceId || instance?.process_instance_id || instance?.id;
    if (!id) {
      return { success: false, error: 'Instance ID required for cancellation.' };
    }

    try {
      const { data, error: cancelErr } = await supabase.rpc('cancel_process_instance', {
        p_instance_id: id,
        p_reason: reason,
      });
      if (cancelErr) throw cancelErr;
      await fetchInstance({ silent: true });
      return { success: true, data };
    } catch (err) {
      console.error('[useProcessInstance] cancelProcessInstance error:', err);
      return { success: false, error: err.message || 'Failed to cancel process instance.' };
    }
  };

  return {
    instance,
    tasks: instance?.tasks || [],
    auditEvents: instance?.audit_events || [],
    loading,
    refreshing,
    error,
    refetch: fetchInstance,
    completeResponsiblePart,
    submitEvidence,
    submitConsultation,
    approveTask,
    rejectTask,
    getPermissions,
    moveProcessInstance,
    cancelProcessInstance,
  };
}
