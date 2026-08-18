import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  FolderKanban,
  CheckSquare,
  AlertTriangle,
  Clock,
  ShieldAlert,
  ChevronRight,
  ArrowUpRight,
  Plus,
  Activity,
  Sparkles,
} from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { useUserContext } from '../hooks/useUserContext';
import { useDepartments } from '../hooks/useDepartments';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { supabase } from '../lib/supabase';
import { useEffect } from 'react';
import PageHeader from '../components/PageHeader';
import MetricCard from '../components/MetricCard';
import RoleBadge from '../components/RoleBadge';
import Avatar from '../components/Avatar';
import { MetricCardsSkeleton, CardGridSkeleton } from '../components/Skeleton';
import TaskDetailPanel from '../components/TaskDetailPanel';
import styles from './DashboardPage.module.css';

function calculateProjectHealth(project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isDone = project.project_status === 'completed' || project.project_status === 'cancelled';
  if (isDone) return { status: 'completed', label: 'Completed', variant: 'success' };

  // 1. Critical
  if (project.target_end_date) {
    const targetDate = new Date(project.target_end_date);
    if (targetDate < today && !isDone) {
      return { status: 'critical', label: 'Critical (Overdue)', variant: 'danger' };
    }
  }
  if (project.project_priority === 'critical' && (project.overdue_count || 0) > 0) {
    return { status: 'critical', label: 'Critical (Overdue Tasks)', variant: 'danger' };
  }

  // 2. At Risk
  const totalTasks = project.task_count || 0;
  const overdueTasks = project.overdue_count || 0;
  if (totalTasks > 0 && (overdueTasks / totalTasks) >= 0.1) {
    return { status: 'at_risk', label: 'At Risk (≥10% Overdue)', variant: 'warning' };
  }

  if (project.target_end_date) {
    const targetDate = new Date(project.target_end_date);
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    if (targetDate <= in7Days && (project.progress || 0) < 70) {
      return { status: 'at_risk', label: 'At Risk (Due Soon)', variant: 'warning' };
    }
  }

  return { status: 'on_track', label: 'On Track', variant: 'success' };
}

// In-memory cache for dashboard tasks
const dashboardTasksCache = new Map();

export default function DashboardPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();

  const { projects = [], loading: projectsLoading } = useProjects(workspaceId);
  const { departments = [] } = useDepartments(workspaceId);
  const { workspaces = [] } = useWorkspaces();
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  const userContext = useUserContext(workspaceId);
  const {
    isOwner,
    isCEO,
    isCTO,
    isProjectAdmin,
    isSystemAdmin,
    canAdministerWorkspace,
    hasGlobalOperationalVisibility,
    workspaceRole,
  } = userContext;

  const cachedTasks = dashboardTasksCache.get(workspaceId) || null;
  const [allTasks, setAllTasks] = useState(() => cachedTasks || []);
  const [tasksLoading, setTasksLoading] = useState(() => !cachedTasks);
  const [selectedTask, setSelectedTask] = useState(null);

  // Fetch all tasks for the workspace across projects
  useEffect(() => {
    async function loadWorkspaceTasks() {
      if (!workspaceId || projects.length === 0) {
        if (!projectsLoading) {
          setAllTasks([]);
          setTasksLoading(false);
        }
        return;
      }

      try {
        if (!dashboardTasksCache.has(workspaceId)) {
          setTasksLoading(true);
        }
        const projectIds = projects.map((p) => p.id);

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
          .in('project_id', projectIds)
          .order('due_date', { ascending: true });

        if (tasksError) throw tasksError;

        const taskIds = (tasksData || []).map((t) => t.id);
        let raciRows = [];

        if (taskIds.length > 0) {
          const { data: raciData } = await supabase
            .from('task_raci_assignments')
            .select('task_id, raci_role, user_id, department_id')
            .in('task_id', taskIds);

          if (raciData) {
            raciRows = raciData;
          }
        }

        const raciByTaskId = new Map();
        for (const raci of raciRows) {
          if (!raciByTaskId.has(raci.task_id)) {
            raciByTaskId.set(raci.task_id, []);
          }
          raciByTaskId.get(raci.task_id).push(raci);
        }

        const enriched = (tasksData || []).map((t) => {
          const taskRaci = raciByTaskId.get(t.id) || [];
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

        dashboardTasksCache.set(workspaceId, enriched);
        setAllTasks(enriched);
      } catch (err) {
        console.error('Error loading dashboard tasks:', err);
      } finally {
        setTasksLoading(false);
      }
    }

    loadWorkspaceTasks();
  }, [workspaceId, projects, projectsLoading]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeProjects = projects.filter(
      (p) => p.project_status !== 'completed' && p.project_status !== 'cancelled'
    );

    const criticalProjects = projects.filter((p) => {
      const health = calculateProjectHealth(p);
      return health.status === 'critical';
    });

    const openTasks = allTasks.filter((t) => {
      const isDone =
        t.task_statuses?.system_code === 'done' ||
        t.task_statuses?.name?.toLowerCase().includes('done');
      return !isDone;
    });

    const overdueTasks = openTasks.filter((t) => {
      if (!t.due_date) return false;
      return new Date(t.due_date) < today;
    });

    const raciIncompleteTasks = openTasks.filter((t) => !t.raci?.isComplete);
    const unassignedTasks = openTasks.filter((t) => !t.assignee_id && !t.raci?.accountable);
    const blockedTasks = openTasks.filter(
      (t) =>
        t.task_statuses?.system_code === 'blocked' ||
        t.task_statuses?.name?.toLowerCase().includes('blocked')
    );

    return {
      activeProjectsCount: activeProjects.length,
      criticalProjectsCount: criticalProjects.length,
      totalOpenTasksCount: openTasks.length,
      overdueTasksCount: overdueTasks.length,
      raciIncompleteCount: raciIncompleteTasks.length,
      unassignedTasksCount: unassignedTasks.length,
      blockedTasksCount: blockedTasks.length,
      overdueTasks,
      blockedTasks,
      openTasks,
      criticalProjects,
    };
  }, [projects, allTasks]);

  // Attention Required Items
  const attentionItems = useMemo(() => {
    const items = [];

    // Overdue tasks
    metrics.overdueTasks.slice(0, 5).forEach((t) => {
      items.push({
        id: `overdue-${t.id}`,
        type: 'overdue_task',
        title: t.title,
        subtitle: `In project ${t.projects?.name || 'Unknown'} • Due ${t.due_date}`,
        badgeText: 'Overdue',
        badgeVariant: 'danger',
        task: t,
      });
    });

    // Blocked tasks
    metrics.blockedTasks.slice(0, 4).forEach((t) => {
      items.push({
        id: `blocked-${t.id}`,
        type: 'blocked_task',
        title: t.title,
        subtitle: `In project ${t.projects?.name || 'Unknown'} • Priority: ${t.priority}`,
        badgeText: 'Blocked',
        badgeVariant: 'warning',
        task: t,
      });
    });

    // Critical / Overdue Projects
    metrics.criticalProjects.slice(0, 3).forEach((p) => {
      items.push({
        id: `crit-proj-${p.id}`,
        type: 'critical_project',
        title: `Project: ${p.name}`,
        subtitle: `Target End: ${p.target_end_date || 'None'} • Progress: ${p.progress || 0}%`,
        badgeText: 'Project Critical',
        badgeVariant: 'danger',
        link: `/workspace/${workspaceId}/project/${p.id}`,
      });
    });

    return items;
  }, [metrics, workspaceId]);

  const isInitialLoading = (projectsLoading && projects.length === 0) || (tasksLoading && allTasks.length === 0);

  // Determine Persona Title & Badge
  let personaTitle = 'Project Administration';
  let personaRole = 'project_admin';

  if (isCEO) {
    personaTitle = 'Executive Portfolio Overview';
    personaRole = 'ceo';
  } else if (isCTO) {
    personaTitle = 'Technical Operations Command';
    personaRole = 'cto';
  } else if (isSystemAdmin) {
    personaTitle = 'System & Project Administration';
    personaRole = 'system_admin';
  } else if (isOwner) {
    personaTitle = 'Workspace Operations';
    personaRole = 'owner';
  } else if (!hasGlobalOperationalVisibility && !canAdministerWorkspace) {
    personaTitle = 'Team Operations';
    personaRole = workspaceRole || 'member';
  }

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <PageHeader
        title={personaTitle}
        subtitle={`Real-time operational health and project execution for ${currentWorkspace?.name || 'Workspace'}`}
        badge={<RoleBadge role={personaRole} size="md" />}
        actions={
          <div className={styles.headerActions}>
            <Link
              to={`/workspace/${workspaceId}/my-work`}
              className={styles.myWorkBtn}
            >
              <CheckSquare size={16} /> My Work
            </Link>
            {(canAdministerWorkspace || isProjectAdmin) && (
              <Link
                to={`/workspace/${workspaceId}/projects`}
                className={styles.newProjectBtn}
              >
                <Plus size={16} /> New Project
              </Link>
            )}
          </div>
        }
      />

      {/* Top Operational KPI Cards */}
      {isInitialLoading ? (
        <MetricCardsSkeleton count={6} />
      ) : (
        <div className={styles.kpiGrid}>
          <MetricCard
            title="Active Projects"
            value={metrics.activeProjectsCount}
            subtitle={`Across ${departments.length} departments`}
            icon={FolderKanban}
            variant="accent"
            onClick={() => navigate(`/workspace/${workspaceId}/projects`)}
          />
          <MetricCard
            title="Critical Projects"
            value={metrics.criticalProjectsCount}
            subtitle={metrics.criticalProjectsCount > 0 ? 'Require immediate review' : 'All projects healthy'}
            icon={AlertTriangle}
            variant={metrics.criticalProjectsCount > 0 ? 'danger' : 'success'}
          />
          <MetricCard
            title="Open Tasks"
            value={metrics.totalOpenTasksCount}
            subtitle="Currently in progress"
            icon={CheckSquare}
            variant="info"
          />
          <MetricCard
            title="Overdue Tasks"
            value={metrics.overdueTasksCount}
            subtitle={metrics.overdueTasksCount > 0 ? 'Exceeded scheduled due date' : 'No overdue tasks'}
            icon={Clock}
            variant={metrics.overdueTasksCount > 0 ? 'danger' : 'default'}
          />
          <MetricCard
            title="Assignments Incomplete"
            value={metrics.raciIncompleteCount}
            subtitle="Tasks missing an Owner or Assignee"
            icon={ShieldAlert}
            variant={metrics.raciIncompleteCount > 0 ? 'warning' : 'success'}
          />
          <MetricCard
            title="Blocked Tasks"
            value={metrics.blockedTasksCount}
            subtitle={metrics.blockedTasksCount > 0 ? 'Blocked dependencies / issues' : 'No blocked tasks'}
            icon={ShieldAlert}
            variant={metrics.blockedTasksCount > 0 ? 'warning' : 'default'}
          />
        </div>
      )}

      {/* Main Content Layout: Attention Required & Project Portfolio */}
      <div className={styles.mainGrid}>
        {/* Left / Top: Project Portfolio */}
        <section className={styles.portfolioSection}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <Activity size={18} className={styles.sectionIcon} />
              <h2 className={styles.sectionTitle}>Project Portfolio</h2>
              <span className={styles.countBadge}>{projects.length}</span>
            </div>
            <span className={styles.healthLabelNote}>Calculated UI Project Health</span>
          </div>

          {isInitialLoading ? (
            <CardGridSkeleton count={2} />
          ) : projects.length === 0 ? (
            <div className={styles.emptyCard}>
              <FolderKanban size={36} />
              <h3>No projects created yet</h3>
              <p>Create your first project to start tracking phases, ownership, assignments, and Kanban boards.</p>
              <Link to={`/workspace/${workspaceId}/projects`} className={styles.emptyActionBtn}>
                <Plus size={16} /> Create Project
              </Link>
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.portfolioTable}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Progress</th>
                    <th>Target End</th>
                    <th>Health</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((proj) => {
                    const health = calculateProjectHealth(proj);
                    return (
                      <tr
                        key={proj.id}
                        className={styles.portfolioRow}
                        onClick={() => navigate(`/workspace/${workspaceId}/project/${proj.id}`)}
                      >
                        <td className={styles.projNameCell}>
                          <div className={styles.projNameWrap}>
                            <span
                              className={styles.colorDot}
                              style={{ background: proj.color || 'var(--yellow)' }}
                            />
                            <strong>{proj.name}</strong>
                          </div>
                        </td>
                        <td>
                          {proj.owner ? (
                            <div className={styles.ownerWrap}>
                              <Avatar
                                name={proj.owner.full_name || 'Owner'}
                                src={proj.owner.avatar_url}
                                size="xs"
                              />
                              <span>{proj.owner.full_name}</span>
                            </div>
                          ) : (
                            <span className={styles.mutedText}>—</span>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.statusTag} ${styles[`status_${proj.project_status || 'active'}`]}`}>
                            {proj.project_status || 'active'}
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.priorityTag} ${styles[`priority_${proj.project_priority || 'medium'}`]}`}>
                            {proj.project_priority || 'medium'}
                          </span>
                        </td>
                        <td className={styles.progressCell}>
                          <div className={styles.progressWrap}>
                            <div className={styles.progressBar}>
                              <div
                                className={styles.progressFill}
                                style={{ width: `${proj.progress || 0}%` }}
                              />
                            </div>
                            <span className={styles.progressText}>{proj.progress || 0}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={styles.dateText}>
                            {proj.target_end_date ? (
                              proj.target_end_date
                            ) : (
                              <span className={styles.mutedText}>Not set</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.healthPill} ${styles[health.variant]}`}>
                            {health.label}
                          </span>
                        </td>
                        <td className={styles.arrowCell}>
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right / Sidebar: Attention Required Items */}
        <section className={styles.attentionSection}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <AlertTriangle size={18} className={styles.warnIcon} />
              <h2 className={styles.sectionTitle}>Attention Required</h2>
              <span className={styles.warnCountBadge}>{attentionItems.length}</span>
            </div>
          </div>

          {attentionItems.length === 0 ? (
            <div className={styles.cleanState}>
              <Sparkles size={28} className={styles.cleanIcon} />
              <h4>All clear</h4>
              <p>No overdue tasks, blocked items, or critical project risks detected.</p>
            </div>
          ) : (
            <div className={styles.attentionList}>
              {attentionItems.map((item) => (
                <div
                  key={item.id}
                  className={`${styles.attentionCard} ${styles[`card_${item.badgeVariant}`]}`}
                  onClick={() => {
                    if (item.task) setSelectedTask(item.task);
                    else if (item.link) navigate(item.link);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.attentionTop}>
                    <span className={`${styles.itemBadge} ${styles[item.badgeVariant]}`}>
                      {item.badgeText}
                    </span>
                    <ArrowUpRight size={14} className={styles.itemArrow} />
                  </div>
                  <h4 className={styles.itemTitle}>{item.title}</h4>
                  <p className={styles.itemSubtitle}>{item.subtitle}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          statuses={[]}
          members={[]}
          departments={departments}
        />
      )}
    </div>
  );
}
