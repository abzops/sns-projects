import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckSquare,
  Clock,
  Search,
  ShieldAlert,
  Inbox,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDepartments } from '../hooks/useDepartments';
import { supabase } from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import TaskCard from '../components/TaskCard';
import TaskRow from '../components/TaskRow';
import TaskDetailPanel from '../components/TaskDetailPanel';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import styles from './MyWorkPage.module.css';

export default function MyWorkPage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const { departments = [] } = useDepartments(workspaceId);

  const [activeTab, setActiveTab] = useState('R'); // 'R' | 'A' | 'C' | 'I' | 'all'
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'cards'
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterOnlyOverdue, setFilterOnlyOverdue] = useState(false);
  const [filterOnlyBlocked, setFilterOnlyBlocked] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);

  // Fetch all tasks relevant to user via RACI or primary assignee in this workspace
  const fetchMyWork = useCallback(async () => {
    if (!workspaceId || !user) {
      setTasks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1. Fetch user's RACI assignments in this workspace
      const { data: userRaci, error: raciErr } = await supabase
        .from('task_raci_assignments')
        .select(`
          id,
          task_id,
          raci_role,
          user_id,
          department_id,
          tasks:task_id (
            id,
            project_id,
            milestone_id,
            task_list_id,
            title,
            description,
            status_id,
            priority,
            assignee_id,
            due_date,
            position,
            created_at,
            projects:project_id (
              id,
              name,
              color,
              workspace_id
            ),
            milestones:milestone_id (
              id,
              name
            ),
            task_lists:task_list_id (
              id,
              name
            ),
            task_statuses:status_id (
              id,
              name,
              color,
              system_code
            ),
            assignee:assignee_id (
              id,
              full_name,
              avatar_url
            )
          )
        `)
        .eq('user_id', user.id);

      if (raciErr) throw raciErr;

      // 2. Also fetch tasks directly assigned to user as primary assignee
      const { data: directTasks, error: directErr } = await supabase
        .from('tasks')
        .select(`
          id,
          project_id,
          milestone_id,
          task_list_id,
          title,
          description,
          status_id,
          priority,
          assignee_id,
          due_date,
          position,
          created_at,
          projects:project_id (
            id,
            name,
            color,
            workspace_id
          ),
          milestones:milestone_id (
            id,
            name
          ),
          task_lists:task_list_id (
            id,
            name
          ),
          task_statuses:status_id (
            id,
            name,
            color,
            system_code
          ),
          assignee:assignee_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('assignee_id', user.id);

      if (directErr) throw directErr;

      // Collect unique tasks for this workspace
      const taskMap = new Map();
      const userRolesByTaskId = new Map(); // taskId -> Set of 'R','A','C','I'

      // Process RACI items
      for (const item of userRaci || []) {
        const t = item.tasks;
        if (!t || t.projects?.workspace_id !== workspaceId) continue;

        if (!taskMap.has(t.id)) {
          taskMap.set(t.id, t);
        }
        if (!userRolesByTaskId.has(t.id)) {
          userRolesByTaskId.set(t.id, new Set());
        }
        userRolesByTaskId.get(t.id).add(item.raci_role);
      }

      // Process direct tasks
      for (const t of directTasks || []) {
        if (!t || t.projects?.workspace_id !== workspaceId) continue;
        if (!taskMap.has(t.id)) {
          taskMap.set(t.id, t);
        }
        if (!userRolesByTaskId.has(t.id)) {
          userRolesByTaskId.set(t.id, new Set());
        }
        // Direct assignee defaults to Responsible if not already assigned
        if (userRolesByTaskId.get(t.id).size === 0) {
          userRolesByTaskId.get(t.id).add('R');
        }
      }

      // 3. Batch load full RACI info for these tasks
      const allTaskIds = Array.from(taskMap.keys());
      let fullRaciMap = new Map();

      if (allTaskIds.length > 0) {
        const { data: allRaci } = await supabase
          .from('task_raci_assignments')
          .select(`
            id,
            task_id,
            raci_role,
            user_id,
            department_id,
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
          .in('task_id', allTaskIds);

        if (allRaci) {
          for (const r of allRaci) {
            if (!fullRaciMap.has(r.task_id)) fullRaciMap.set(r.task_id, []);
            fullRaciMap.get(r.task_id).push(r);
          }
        }

        // Batch load subtasks stats
        const { data: subtaskRows } = await supabase
          .from('subtasks')
          .select('id, task_id, status')
          .in('task_id', allTaskIds);

        const subtaskMap = new Map();
        if (subtaskRows) {
          for (const st of subtaskRows) {
            if (!subtaskMap.has(st.task_id)) {
              subtaskMap.set(st.task_id, { total: 0, completed: 0 });
            }
            const s = subtaskMap.get(st.task_id);
            if (st.status !== 'cancelled') {
              s.total += 1;
              if (st.status === 'done') s.completed += 1;
            }
          }
        }

        // Assemble enriched task list
        const enrichedList = Array.from(taskMap.values()).map((t) => {
          const raciList = fullRaciMap.get(t.id) || [];
          const responsible = raciList.filter((r) => r.raci_role === 'R');
          const accountable = raciList.find((r) => r.raci_role === 'A') || null;
          const consulted = raciList.filter((r) => r.raci_role === 'C');
          const informed = raciList.filter((r) => r.raci_role === 'I');
          const isComplete = responsible.length > 0 && !!accountable;

          const myRoles = Array.from(userRolesByTaskId.get(t.id) || []);
          const stStats = subtaskMap.get(t.id) || { total: 0, completed: 0 };

          return {
            ...t,
            myRoles,
            raci: {
              all: raciList,
              responsible,
              accountable,
              consulted,
              informed,
              isComplete,
            },
            subtask_count: stStats.total,
            subtasks_completed_count: stStats.completed,
          };
        });

        setTasks(enrichedList);
      } else {
        setTasks([]);
      }
    } catch (err) {
      console.error('Error fetching My Work:', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, user]);

  useEffect(() => {
    fetchMyWork();
  }, [fetchMyWork]);

  // Counts per RACI role
  const tabCounts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rTasks = tasks.filter((t) => t.myRoles?.includes('R'));
    const aTasks = tasks.filter((t) => t.myRoles?.includes('A'));
    const cTasks = tasks.filter((t) => t.myRoles?.includes('C'));
    const iTasks = tasks.filter((t) => t.myRoles?.includes('I'));

    const overdueCount = tasks.filter((t) => {
      if (!t.due_date) return false;
      const isDone = t.task_statuses?.system_code === 'done' || t.task_statuses?.name?.toLowerCase().includes('done');
      return !isDone && new Date(t.due_date) < today;
    }).length;

    const blockedCount = tasks.filter(
      (t) => t.task_statuses?.system_code === 'blocked' || t.task_statuses?.name?.toLowerCase().includes('blocked')
    ).length;

    return {
      R: rTasks.length,
      A: aTasks.length,
      C: cTasks.length,
      I: iTasks.length,
      all: tasks.length,
      overdue: overdueCount,
      blocked: blockedCount,
    };
  }, [tasks]);

  // Filtered tasks for active tab & controls
  const filteredTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return tasks.filter((t) => {
      // 1. Tab filter
      if (activeTab !== 'all' && !t.myRoles?.includes(activeTab)) {
        return false;
      }

      // 2. Overdue filter
      if (filterOnlyOverdue) {
        const isDone = t.task_statuses?.system_code === 'done' || t.task_statuses?.name?.toLowerCase().includes('done');
        if (isDone || !t.due_date || new Date(t.due_date) >= today) return false;
      }

      // 3. Blocked filter
      if (filterOnlyBlocked) {
        const isBlocked = t.task_statuses?.system_code === 'blocked' || t.task_statuses?.name?.toLowerCase().includes('blocked');
        if (!isBlocked) return false;
      }

      // 4. Priority filter
      if (filterPriority && t.priority !== filterPriority) {
        return false;
      }

      // 5. Search text
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = t.title?.toLowerCase().includes(q);
        const matchProj = t.projects?.name?.toLowerCase().includes(q);
        const matchDesc = t.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchProj && !matchDesc) return false;
      }

      return true;
    });
  }, [tasks, activeTab, filterOnlyOverdue, filterOnlyBlocked, filterPriority, search]);

  const handleTaskSave = async (updatedTask) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          title: updatedTask.title,
          description: updatedTask.description,
          status_id: updatedTask.status_id,
          priority: updatedTask.priority,
          assignee_id: updatedTask.assignee_id,
          due_date: updatedTask.due_date,
          updated_at: new Date().toISOString(),
        })
        .eq('id', updatedTask.id);

      if (error) throw error;
      await fetchMyWork();
      setSelectedTask(null);
    } catch (err) {
      console.error('Error saving task:', err);
    }
  };

  const handleTaskDelete = async (taskId) => {
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
      await fetchMyWork();
      setSelectedTask(null);
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size="lg" />
        <p>Loading your work items…</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <PageHeader
        title="My Work"
        subtitle="Operational inbox and tasks assigned to you across the organization"
        badge={
          <span className={styles.totalTasksPill}>
            <CheckSquare size={13} /> {tabCounts.all} Active Tasks
          </span>
        }
      />

      {/* Highlights / Quick Action Banners */}
      {(tabCounts.overdue > 0 || tabCounts.blocked > 0) && (
        <div className={styles.highlightsRow}>
          {tabCounts.overdue > 0 && (
            <button
              type="button"
              className={`${styles.highlightPill} ${styles.highlightDanger} ${filterOnlyOverdue ? styles.highlightActive : ''}`}
              onClick={() => {
                setFilterOnlyOverdue(!filterOnlyOverdue);
                setFilterOnlyBlocked(false);
              }}
            >
              <Clock size={14} />
              <span><strong>{tabCounts.overdue}</strong> Overdue Tasks</span>
            </button>
          )}

          {tabCounts.blocked > 0 && (
            <button
              type="button"
              className={`${styles.highlightPill} ${styles.highlightWarning} ${filterOnlyBlocked ? styles.highlightActive : ''}`}
              onClick={() => {
                setFilterOnlyBlocked(!filterOnlyBlocked);
                setFilterOnlyOverdue(false);
              }}
            >
              <ShieldAlert size={14} />
              <span><strong>{tabCounts.blocked}</strong> Blocked Tasks</span>
            </button>
          )}
        </div>
      )}

      {/* RACI Perspective Tabs */}
      <div className={styles.tabsHeader}>
        <div className={styles.tabsList}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'R' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('R')}
          >
            <span className={styles.tabBadgeR}>R</span>
            <div className={styles.tabLabelWrap}>
              <strong>Needs My Action</strong>
              <small>Responsible ({tabCounts.R})</small>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'A' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('A')}
          >
            <span className={styles.tabBadgeA}>A</span>
            <div className={styles.tabLabelWrap}>
              <strong>I Own</strong>
              <small>Accountable ({tabCounts.A})</small>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'C' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('C')}
          >
            <span className={styles.tabBadgeC}>C</span>
            <div className={styles.tabLabelWrap}>
              <strong>Needs My Input</strong>
              <small>Consulted ({tabCounts.C})</small>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'I' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('I')}
          >
            <span className={styles.tabBadgeI}>I</span>
            <div className={styles.tabLabelWrap}>
              <strong>For My Info</strong>
              <small>Informed ({tabCounts.I})</small>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'all' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <span className={styles.tabBadgeAll}>★</span>
            <div className={styles.tabLabelWrap}>
              <strong>All Items</strong>
              <small>Total ({tabCounts.all})</small>
            </div>
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className={styles.filterBar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Filter by title, project name, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filterControls}>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${viewMode === 'list' ? styles.toggleActive : ''}`}
              onClick={() => setViewMode('list')}
              title="Table View"
            >
              List
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${viewMode === 'cards' ? styles.toggleActive : ''}`}
              onClick={() => setViewMode('cards')}
              title="Cards View"
            >
              Cards
            </button>
          </div>
        </div>
      </div>

      {/* Task Content */}
      {filteredTasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            search || filterOnlyOverdue || filterOnlyBlocked || filterPriority
              ? 'No matching tasks'
              : activeTab === 'R'
              ? 'No action required right now'
              : activeTab === 'A'
              ? 'No accountable tasks assigned to you'
              : 'Inbox is clear'
          }
          description={
            search || filterOnlyOverdue || filterOnlyBlocked || filterPriority
              ? 'Try adjusting your filters or search terms.'
              : 'Tasks assigned to you via RACI matrix will appear here automatically.'
          }
        />
      ) : viewMode === 'list' ? (
        <div className={styles.tableCard}>
          <table className={styles.taskTable}>
            <thead>
              <tr>
                <th>Task & Project</th>
                <th>Status</th>
                <th>Priority</th>
                <th>RACI Assignment</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onClick={() => setSelectedTask(t)}
                  showProjectName
                  showHierarchy
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.cardsGrid}>
          {filteredTasks.map((t) => (
            <div key={t.id} className={styles.cardItemWrap}>
              <div className={styles.cardProjectTag} style={{ borderColor: t.projects?.color || 'var(--yellow)' }}>
                <span>{t.projects?.name}</span>
              </div>
              <TaskCard
                task={t}
                onClick={() => setSelectedTask(t)}
                showStatus
                showHierarchy
              />
            </div>
          ))}
        </div>
      )}

      {/* Enhanced Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={handleTaskSave}
          onDelete={handleTaskDelete}
          statuses={[]}
          members={[]}
          departments={departments}
        />
      )}
    </div>
  );
}
