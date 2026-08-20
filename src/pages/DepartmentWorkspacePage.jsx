import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FolderKanban,
  CheckSquare,
  Clock,
  ShieldAlert,
  Search,
  Shield,
  ArrowRight,
} from 'lucide-react';
import { useDepartmentMembers } from '../hooks/useDepartmentMembers';
import { useDepartments } from '../hooks/useDepartments';
import { useUserContext } from '../hooks/useUserContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import MetricCard from '../components/MetricCard';
import TaskCard from '../components/TaskCard';
import TaskRow from '../components/TaskRow';
import TaskDetailPanel from '../components/TaskDetailPanel';
import Avatar from '../components/Avatar';
import RoleBadge from '../components/RoleBadge';
import { TaskRowSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { getMemberDisplayName } from '../lib/identity';
import styles from './DepartmentWorkspacePage.module.css';

export default function DepartmentWorkspacePage() {
  const { workspaceId, departmentId } = useParams();
  const { user } = useAuth();

  const { departments = [], loading: deptLoading } = useDepartments(workspaceId);
  const { members: deptMembers = [] } = useDepartmentMembers(departmentId);

  const currentDept = departments.find((d) => d.id === departmentId);

  const { canAdministerWorkspace, isReadOnly } = useUserContext(workspaceId);
  const canAdmin = canAdministerWorkspace;

  // View state
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'cards'
  const [filterType, setFilterType] = useState('all'); // 'all' | 'overdue' | 'blocked'
  const [search, setSearch] = useState('');
  const [deptTasks, setDeptTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);

  // Keep selectedTask synchronized with canonical refreshed deptTasks collection
  useEffect(() => {
    if (!selectedTask?.id || !deptTasks || deptTasks.length === 0) return;
    const refreshed = deptTasks.find((t) => t.id === selectedTask.id);
    if (refreshed && refreshed !== selectedTask) {
      setSelectedTask(refreshed);
    }
  }, [deptTasks, selectedTask]);

  // Fetch department tasks across all projects
  const fetchDeptTasks = useCallback(async () => {
    if (!departmentId || !workspaceId) {
      setDeptTasks([]);
      setTasksLoading(false);
      return;
    }

    try {
      setTasksLoading(true);

      // 1. Get task IDs associated with this department in RACI
      const { data: deptRaci, error: raciErr } = await supabase
        .from('task_raci_assignments')
        .select('task_id')
        .eq('department_id', departmentId);

      if (raciErr) throw raciErr;

      const raciTaskIds = (deptRaci || []).map((r) => r.task_id);

      // 2. Also get task IDs assigned to department members
      const memberUserIds = deptMembers.map((m) => m.user_id);
      let memberTaskIds = [];

      if (memberUserIds.length > 0) {
        const { data: mTasks } = await supabase
          .from('tasks')
          .select('id')
          .in('assignee_id', memberUserIds);

        memberTaskIds = (mTasks || []).map((t) => t.id);
      }

      // Combine unique task IDs
      const combinedTaskIds = Array.from(new Set([...raciTaskIds, ...memberTaskIds]));

      if (combinedTaskIds.length === 0) {
        setDeptTasks([]);
        setTasksLoading(false);
        return;
      }

      // 3. Fetch task details
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select(`
          id,
          project_id,
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
        .in('id', combinedTaskIds)
        .order('due_date', { ascending: true });

      if (tasksError) throw tasksError;

      // Filter tasks strictly belonging to this workspace
      const validWorkspaceTasks = (tasksData || []).filter(
        (t) => t.projects?.workspace_id === workspaceId
      );

      // Fetch RACI data for these tasks
      const validIds = validWorkspaceTasks.map((t) => t.id);
      let fullRaciMap = new Map();

      if (validIds.length > 0) {
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
          .in('task_id', validIds);

        if (allRaci) {
          for (const r of allRaci) {
            if (!fullRaciMap.has(r.task_id)) fullRaciMap.set(r.task_id, []);
            fullRaciMap.get(r.task_id).push(r);
          }
        }
      }

      const enriched = validWorkspaceTasks.map((t) => {
        const taskRaci = fullRaciMap.get(t.id) || [];
        const responsible = taskRaci.filter((r) => r.raci_role === 'R');
        const accountable = taskRaci.find((r) => r.raci_role === 'A') || null;
        const isComplete = responsible.length > 0 && !!accountable;

        return {
          ...t,
          raci: {
            all: taskRaci,
            responsible,
            accountable,
            isComplete,
          },
        };
      });

      setDeptTasks(enriched);
    } catch (err) {
      console.error('Error fetching department tasks:', err);
    } finally {
      setTasksLoading(false);
    }
  }, [departmentId, workspaceId, deptMembers]);

  useEffect(() => {
    fetchDeptTasks();
  }, [fetchDeptTasks]);

  // Identify touching projects
  const touchingProjects = useMemo(() => {
    const pMap = new Map();
    for (const t of deptTasks) {
      if (t.projects && !pMap.has(t.projects.id)) {
        pMap.set(t.projects.id, t.projects);
      }
    }
    return Array.from(pMap.values());
  }, [deptTasks]);

  // Metrics
  const metrics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const openTasks = deptTasks.filter((t) => {
      const isDone =
        t.task_statuses?.system_code === 'done' ||
        t.task_statuses?.name?.toLowerCase().includes('done');
      return !isDone;
    });

    const overdueTasks = openTasks.filter((t) => {
      if (!t.due_date) return false;
      return new Date(t.due_date) < today;
    });

    const blockedTasks = openTasks.filter(
      (t) =>
        t.task_statuses?.system_code === 'blocked' ||
        t.task_statuses?.name?.toLowerCase().includes('blocked')
    );

    return {
      total: deptTasks.length,
      open: openTasks.length,
      overdue: overdueTasks.length,
      blocked: blockedTasks.length,
      openTasks,
      overdueTasks,
      blockedTasks,
    };
  }, [deptTasks]);

  // Filtered tasks for active tab & search
  const filteredTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return deptTasks.filter((t) => {
      const isDone =
        t.task_statuses?.system_code === 'done' ||
        t.task_statuses?.name?.toLowerCase().includes('done');

      if (filterType === 'overdue') {
        if (isDone || !t.due_date || new Date(t.due_date) >= today) return false;
      }
      if (filterType === 'blocked') {
        const isBlocked =
          t.task_statuses?.system_code === 'blocked' ||
          t.task_statuses?.name?.toLowerCase().includes('blocked');
        if (!isBlocked) return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = t.title?.toLowerCase().includes(q);
        const matchProj = t.projects?.name?.toLowerCase().includes(q);
        if (!matchTitle && !matchProj) return false;
      }

      return true;
    });
  }, [deptTasks, filterType, search]);

  const departmentHead = deptMembers.find((m) => m.role === 'head');

  if (deptLoading && !currentDept) {
    return (
      <div className={styles.container}>
        <PageHeader
          title="Department Workspace"
          subtitle="Loading organizational department…"
        />
        <TaskRowSkeleton count={4} />
      </div>
    );
  }

  if (!currentDept) {
    return (
      <div className={styles.notFound}>
        <h2>Department not found</h2>
        <Link to={`/workspace/${workspaceId}/departments`} className={styles.backLink}>
          Back to Departments
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Page Header with Department Accent */}
      <PageHeader
        title={currentDept.name}
        subtitle={currentDept.description || 'Department Workspace & Operational Queue'}
        badge={
          <span className={styles.deptCodeBadge} style={{ background: currentDept.color || 'var(--yellow)' }}>
            {currentDept.code}
          </span>
        }
        backTo={`/workspace/${workspaceId}/departments`}
        actions={
          canAdmin && (
            <Link
              to={`/workspace/${workspaceId}/admin/departments`}
              className={styles.adminSettingsBtn}
            >
              <Shield size={16} /> Manage Members
            </Link>
          )
        }
      />

      {/* Department Team Bar */}
      <div className={styles.teamBar}>
        <div className={styles.headInfo}>
          <span className={styles.barLabel}>Head of Department:</span>
          {departmentHead ? (
            <div className={styles.headUser}>
              <Avatar
                name={getMemberDisplayName(departmentHead, user)}
                src={departmentHead.profile?.avatar_url || departmentHead.profiles?.avatar_url}
                size="sm"
              />
              <strong>{getMemberDisplayName(departmentHead, user)}</strong>
              <RoleBadge role="head" size="xs" />
            </div>
          ) : (
            <span className={styles.unassignedHead}>Not designated</span>
          )}
        </div>

        <div className={styles.membersSummary}>
          <span className={styles.barLabel}>Team Members ({deptMembers.length}):</span>
          <div className={styles.memberAvatars}>
            {deptMembers.slice(0, 6).map((m) => {
              const name = getMemberDisplayName(m, user);
              const avatarSrc = m.profile?.avatar_url || m.profiles?.avatar_url;
              return (
                <Avatar
                  key={m.id}
                  name={name}
                  src={avatarSrc}
                  size="sm"
                />
              );
            })}
            {deptMembers.length > 6 && (
              <span className={styles.overflowCount}>+{deptMembers.length - 6}</span>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        <MetricCard
          title="Active Tasks"
          value={metrics.open}
          subtitle={`Across ${touchingProjects.length} projects`}
          icon={CheckSquare}
          variant="accent"
        />
        <MetricCard
          title="Overdue Tasks"
          value={metrics.overdue}
          subtitle={metrics.overdue > 0 ? 'Require immediate follow-up' : 'No overdue tasks'}
          icon={Clock}
          variant={metrics.overdue > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          title="Blocked Tasks"
          value={metrics.blocked}
          subtitle={metrics.blocked > 0 ? 'Blocked on external inputs' : 'No blocked tasks'}
          icon={ShieldAlert}
          variant={metrics.blocked > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          title="Touching Projects"
          value={touchingProjects.length}
          subtitle="Projects with department work"
          icon={FolderKanban}
          variant="info"
        />
      </div>

      {/* Touching Projects Row */}
      {touchingProjects.length > 0 && (
        <div className={styles.touchingProjectsSection}>
          <span className={styles.touchingLabel}>Active Projects for {currentDept.name}:</span>
          <div className={styles.projPillsList}>
            {touchingProjects.map((p) => (
              <Link
                key={p.id}
                to={`/workspace/${workspaceId}/project/${p.id}`}
                className={styles.projPill}
              >
                <span className={styles.projDot} style={{ background: p.color || 'var(--yellow)' }} />
                <span>{p.name}</span>
                <ArrowRight size={12} className={styles.projArrow} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Filter and View Controls */}
      <div className={styles.controlsBar}>
        <div className={styles.filterTabs}>
          <button
            type="button"
            className={`${styles.filterBtn} ${filterType === 'all' ? styles.filterActive : ''}`}
            onClick={() => setFilterType('all')}
          >
            All Tasks ({metrics.total})
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${filterType === 'overdue' ? styles.filterActive : ''}`}
            onClick={() => setFilterType('overdue')}
          >
            Overdue ({metrics.overdue})
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${filterType === 'blocked' ? styles.filterActive : ''}`}
            onClick={() => setFilterType('blocked')}
          >
            Blocked ({metrics.blocked})
          </button>
        </div>

        <div className={styles.rightControls}>
          <div className={styles.searchBox}>
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search department tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${viewMode === 'list' ? styles.toggleActive : ''}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${viewMode === 'cards' ? styles.toggleActive : ''}`}
              onClick={() => setViewMode('cards')}
            >
              Cards
            </button>
          </div>
        </div>
      </div>

      {/* Task List / Cards View */}
      {tasksLoading && filteredTasks.length === 0 ? (
        <TaskRowSkeleton count={4} />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks in this view"
          description="Tasks assigned to this department or its members will appear here."
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
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.cardsGrid}>
          {filteredTasks.map((t) => (
            <div key={t.id} className={styles.cardWrapper}>
              <div className={styles.projTag}>
                <span>{t.projects?.name}</span>
              </div>
              <TaskCard
                task={t}
                onClick={() => setSelectedTask(t)}
                showStatus
              />
            </div>
          ))}
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={async (updatedTask) => {
            await supabase
              .from('tasks')
              .update({
                title: updatedTask.title,
                description: updatedTask.description,
                status_id: updatedTask.status_id,
                priority: updatedTask.priority,
                assignee_id: updatedTask.assignee_id,
                due_date: updatedTask.due_date,
              })
              .eq('id', updatedTask.id);
            await fetchDeptTasks();
            setSelectedTask(null);
          }}
          onDelete={async (taskId) => {
            await supabase.from('tasks').delete().eq('id', taskId);
            await fetchDeptTasks();
            setSelectedTask(null);
          }}
          onWorkflowUpdated={() => fetchDeptTasks()}
          onSubtasksChange={() => fetchDeptTasks()}
          statuses={[]}
          members={deptMembers}
          departments={departments}
          readOnly={isReadOnly}
        />
      )}
    </div>
  );
}
