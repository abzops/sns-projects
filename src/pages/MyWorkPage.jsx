import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckSquare,
  Clock,
  Search,
  ShieldAlert,
  Inbox,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDepartments } from '../hooks/useDepartments';
import { useUserContext } from '../hooks/useUserContext';
import { supabase } from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import TaskCard from '../components/TaskCard';
import TaskRow from '../components/TaskRow';
import TaskDetailPanel from '../components/TaskDetailPanel';
import { TaskRowSkeleton, CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import styles from './MyWorkPage.module.css';

// In-memory session cache scoped by workspaceId:userId
const myWorkCache = new Map();

export default function MyWorkPage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const userId = user?.id || null;
  const { departments = [] } = useDepartments(workspaceId);
  const { departmentMemberships = [], isReadOnly, loading: userContextLoading, authorizationScopeKey } = useUserContext(workspaceId);
  const departmentIds = useMemo(
    () => departmentMemberships.map((membership) => membership.departments?.id).filter(Boolean),
    [departmentMemberships]
  );

  const cacheKey = `${userId || 'anonymous'}:${workspaceId || 'none'}:${authorizationScopeKey || 'loading'}`;
  const cachedData = myWorkCache.get(cacheKey) || null;

  const [activeTab, setActiveTab] = useState('all'); // RACI role | 'S' (Subtasks) | 'all'
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'cards'
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterOnlyOverdue, setFilterOnlyOverdue] = useState(false);
  const [filterOnlyBlocked, setFilterOnlyBlocked] = useState(false);

  const [tasks, setTasks] = useState(() => cachedData || []);
  const [initialLoading, setInitialLoading] = useState(() => !cachedData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  // Keep selectedTask synchronized with canonical refreshed tasks collection
  useEffect(() => {
    if (!selectedTask?.id || !tasks || tasks.length === 0) return;
    const refreshed = tasks.find((t) => t.id === selectedTask.id);
    if (refreshed && refreshed !== selectedTask) {
      setSelectedTask(refreshed);
    }
  }, [tasks, selectedTask]);

  // Parallelized, non-blocking fetch
  const fetchMyWork = useCallback(
    async (options = {}) => {
      const isSilent = options?.silent ?? false;
      if (!workspaceId || !userId) {
        setTasks([]);
        setInitialLoading(false);
        setRefreshing(false);
        return;
      }

      if (!authorizationScopeKey) {
        if (!myWorkCache.has(cacheKey)) {
          setTasks([]);
          setInitialLoading(true);
        }
        return;
      }

      if (!isSilent && !myWorkCache.has(cacheKey)) {
        setInitialLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        // Step 1: bulk-fetch every direct involvement path; RLS remains authoritative.
        let raciQuery = supabase
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
                phase_id,
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
                phases:phases!fk_tasks_phase (
                  id,
                  name
                ),
                task_lists:task_lists!fk_tasks_task_list (
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
            `);
        raciQuery = departmentIds.length > 0
          ? raciQuery.or(`user_id.eq.${userId},department_id.in.(${departmentIds.join(',')})`)
          : raciQuery.eq('user_id', userId);

        const [raciRes, directRes, subtaskAssignmentRes] = await Promise.all([
          raciQuery,

          supabase
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
              created_at,
              projects:project_id (
                id,
                name,
                color,
                workspace_id
              ),
              phases:phases!fk_tasks_phase (
                id,
                name
              ),
              task_lists:task_lists!fk_tasks_task_list (
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
            .eq('assignee_id', userId),

          supabase
            .from('subtasks')
            .select(`
              id,
              task_id,
              title,
              status,
              assignee_id,
              due_date,
              tasks:task_id (
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
                created_at,
                projects:project_id (id, name, color, workspace_id),
                phases:phases!fk_tasks_phase (id, name),
                task_lists:task_lists!fk_tasks_task_list (id, name),
                task_statuses:status_id (id, name, color, system_code),
                assignee:assignee_id (id, full_name, avatar_url)
              )
            `)
            .eq('assignee_id', userId),
        ]);

        if (raciRes.error) throw raciRes.error;
        if (directRes.error) throw directRes.error;
        if (subtaskAssignmentRes.error) throw subtaskAssignmentRes.error;

        // Combine unique tasks for this workspace
        const taskMap = new Map();
        const userRolesByTaskId = new Map();

        // Process RACI items
        for (const item of raciRes.data || []) {
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
        for (const t of directRes.data || []) {
          if (!t || t.projects?.workspace_id !== workspaceId) continue;
          if (!taskMap.has(t.id)) {
            taskMap.set(t.id, t);
          }
          if (!userRolesByTaskId.has(t.id)) {
            userRolesByTaskId.set(t.id, new Set());
          }
          if (userRolesByTaskId.get(t.id).size === 0) {
            userRolesByTaskId.get(t.id).add('R');
          }
        }

        // A Subtask assignment is distinct from a Child Task. Surface its parent Task
        // once and retain the assigned Subtask records for clear My Work context.
        const mySubtasksByTaskId = new Map();
        for (const item of subtaskAssignmentRes.data || []) {
          const t = item.tasks;
          if (!t || t.projects?.workspace_id !== workspaceId) continue;
          if (!taskMap.has(t.id)) taskMap.set(t.id, t);
          if (!userRolesByTaskId.has(t.id)) userRolesByTaskId.set(t.id, new Set());
          userRolesByTaskId.get(t.id).add('S');
          if (!mySubtasksByTaskId.has(t.id)) mySubtasksByTaskId.set(t.id, []);
          mySubtasksByTaskId.get(t.id).push({
            id: item.id,
            title: item.title,
            status: item.status,
            due_date: item.due_date,
          });
        }

        const allTaskIds = Array.from(taskMap.keys());
        let fullRaciMap = new Map();
        const subtaskMap = new Map();

        // Step 2: Concurrently fetch full RACI metadata and Subtask counts in parallel
        if (allTaskIds.length > 0) {
          const [allRaciRes, subtasksRes] = await Promise.all([
            supabase
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
              .in('task_id', allTaskIds),

            supabase
              .from('subtasks')
              .select('id, task_id, status')
              .in('task_id', allTaskIds),
          ]);

          if (allRaciRes.data) {
            for (const r of allRaciRes.data) {
              if (!fullRaciMap.has(r.task_id)) fullRaciMap.set(r.task_id, []);
              fullRaciMap.get(r.task_id).push(r);
            }
          }

          if (subtasksRes.data) {
            for (const st of subtasksRes.data) {
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
            myAssignedSubtasks: mySubtasksByTaskId.get(t.id) || [],
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

        myWorkCache.set(cacheKey, enrichedList);
        setTasks(enrichedList);
      } catch (err) {
        console.error('Error fetching My Work:', err);
        setError(err);
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [cacheKey, departmentIds, userId, workspaceId]
  );

  useEffect(() => {
    if (myWorkCache.has(cacheKey)) {
      setTasks(myWorkCache.get(cacheKey));
      setInitialLoading(false);
    }
    fetchMyWork();
  }, [cacheKey, fetchMyWork]);

  // Counts per RACI role computed locally
  const tabCounts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rTasks = tasks.filter((t) => t.myRoles?.includes('R'));
    const aTasks = tasks.filter((t) => t.myRoles?.includes('A'));
    const cTasks = tasks.filter((t) => t.myRoles?.includes('C'));
    const iTasks = tasks.filter((t) => t.myRoles?.includes('I'));
    const subtaskTasks = tasks.filter((t) => t.myRoles?.includes('S'));

    const overdueCount = tasks.filter((t) => {
      if (!t.due_date) return false;
      const isDone =
        t.task_statuses?.system_code === 'done' ||
        t.task_statuses?.name?.toLowerCase().includes('done');
      return !isDone && new Date(t.due_date) < today;
    }).length;

    const blockedCount = tasks.filter(
      (t) =>
        t.task_statuses?.system_code === 'blocked' ||
        t.task_statuses?.name?.toLowerCase().includes('blocked')
    ).length;

    return {
      R: rTasks.length,
      A: aTasks.length,
      C: cTasks.length,
      I: iTasks.length,
      S: subtaskTasks.length,
      all: tasks.length,
      overdue: overdueCount,
      blocked: blockedCount,
    };
  }, [tasks]);

  // Filtered tasks for active tab & controls (Pure In-Memory)
  const filteredTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return tasks.filter((t) => {
      if (activeTab !== 'all' && !t.myRoles?.includes(activeTab)) {
        return false;
      }

      if (filterOnlyOverdue) {
        const isDone =
          t.task_statuses?.system_code === 'done' ||
          t.task_statuses?.name?.toLowerCase().includes('done');
        if (isDone || !t.due_date || new Date(t.due_date) >= today) return false;
      }

      if (filterOnlyBlocked) {
        const isBlocked =
          t.task_statuses?.system_code === 'blocked' ||
          t.task_statuses?.name?.toLowerCase().includes('blocked');
        if (!isBlocked) return false;
      }

      if (filterPriority && t.priority !== filterPriority) {
        return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = t.title?.toLowerCase().includes(q);
        const matchProj = t.projects?.name?.toLowerCase().includes(q);
        const matchDesc = t.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchProj && !matchDesc) return false;
      }

      return true;
    });
  }, [activeTab, filterOnlyBlocked, filterOnlyOverdue, filterPriority, search, tasks]);

  const handleTaskSave = async (updatedTask) => {
    if (isReadOnly) return;
    try {
      const { error: saveErr } = await supabase
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

      if (saveErr) throw saveErr;
      await fetchMyWork({ silent: true });
      setSelectedTask(null);
    } catch (err) {
      console.error('Error saving task:', err);
    }
  };

  const handleTaskDelete = async (taskId) => {
    if (isReadOnly) return;
    try {
      const { error: delErr } = await supabase.from('tasks').delete().eq('id', taskId);
      if (delErr) throw delErr;
      await fetchMyWork({ silent: true });
      setSelectedTask(null);
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  const isPageLoading = userContextLoading || (initialLoading && tasks.length === 0);

  return (
    <div className={styles.container}>
      {/* Page Header (Always Rendered Immediately) */}
      <PageHeader
        title="My Work"
        subtitle="Operational inbox and tasks assigned to you across the organization"
        badge={
          <div className={styles.headerBadges}>
            {!isPageLoading && (
              <span className={styles.totalTasksPill}>
                <CheckSquare size={13} /> {tabCounts.all} Active Tasks
              </span>
            )}
            {refreshing && (
              <span className={styles.refreshingPill} title="Revalidating latest assignments...">
                <RefreshCw size={12} className={styles.spinIcon} /> Refreshing…
              </span>
            )}
          </div>
        }
      />

      {/* Highlights / Quick Action Banners */}
      {(tabCounts.overdue > 0 || tabCounts.blocked > 0) && (
        <div className={styles.highlightsRow}>
          {tabCounts.overdue > 0 && (
            <button
              type="button"
              className={`${styles.highlightPill} ${styles.highlightDanger} ${
                filterOnlyOverdue ? styles.highlightActive : ''
              }`}
              onClick={() => {
                setFilterOnlyOverdue(!filterOnlyOverdue);
                setFilterOnlyBlocked(false);
              }}
            >
              <Clock size={14} />
              <span>
                <strong>{tabCounts.overdue}</strong> Overdue Tasks
              </span>
            </button>
          )}

          {tabCounts.blocked > 0 && (
            <button
              type="button"
              className={`${styles.highlightPill} ${styles.highlightWarning} ${
                filterOnlyBlocked ? styles.highlightActive : ''
              }`}
              onClick={() => {
                setFilterOnlyBlocked(!filterOnlyBlocked);
                setFilterOnlyOverdue(false);
              }}
            >
              <ShieldAlert size={14} />
              <span>
                <strong>{tabCounts.blocked}</strong> Blocked Tasks
              </span>
            </button>
          )}
        </div>
      )}

      {/* RACI Perspective Tabs (Always Visible & Responsive) */}
      <div className={styles.tabsHeader}>
        <div className={styles.tabsList}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'R' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('R')}
          >
            <span className={styles.tabBadgeR}>R</span>
            <div className={styles.tabLabelWrap}>
              <strong>Assigned to Me</strong>
              <small>Assignee ({tabCounts.R})</small>
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
              <small>Owner ({tabCounts.A})</small>
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
            className={`${styles.tabBtn} ${activeTab === 'S' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('S')}
          >
            <span className={styles.tabBadgeAll}>✓</span>
            <div className={styles.tabLabelWrap}>
              <strong>My Subtasks</strong>
              <small>Assigned Subtasks ({tabCounts.S})</small>
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

      {/* Non-Blocking Error State if fetch failed with no cache */}
      {error && tasks.length === 0 && !initialLoading && (
        <div className={styles.errorNotice}>
          <AlertTriangle size={18} className={styles.errorIcon} />
          <div className={styles.errorMsg}>
            <strong>Could not load My Work</strong>
            <p>{error.message || 'Please check your connection and retry.'}</p>
          </div>
          <button type="button" className={styles.retryBtn} onClick={() => fetchMyWork()}>
            Retry
          </button>
        </div>
      )}

      {/* Task Content: Skeleton vs Empty vs Loaded */}
      {isPageLoading && tasks.length === 0 ? (
        viewMode === 'list' ? (
          <TaskRowSkeleton count={5} />
        ) : (
          <CardGridSkeleton count={4} />
        )
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            search || filterOnlyOverdue || filterOnlyBlocked || filterPriority
              ? 'No matching tasks'
              : activeTab === 'R'
              ? 'No action required right now'
              : activeTab === 'A'
              ? 'No tasks owned by you'
              : 'Inbox is clear'
          }
          description={
            search || filterOnlyOverdue || filterOnlyBlocked || filterPriority
              ? 'Try adjusting your filters or search terms.'
              : 'Tasks and Subtasks where you are an Owner, Assignee, Consulted, Informed, or direct participant will appear here automatically.'
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
                <th>Ownership & Assignment</th>
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
              <div
                className={styles.cardProjectTag}
                style={{ borderColor: t.projects?.color || 'var(--yellow)' }}
              >
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
          onWorkflowUpdated={() => fetchMyWork({ silent: true })}
          onSubtasksChange={() => fetchMyWork({ silent: true })}
          statuses={[]}
          members={[]}
          departments={departments}
          readOnly={isReadOnly}
        />
      )}
    </div>
  );
}
