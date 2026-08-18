import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  FolderKanban,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react';
import Avatar from '../Avatar';
import MetricCard from '../MetricCard';
import styles from './DashboardEngine.module.css';

const STATUS_LABELS = {
  todo: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
};

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function DashboardKpis({ items }) {
  return (
    <div className={styles.kpiGrid} data-dashboard-kpis>
      {items.map((item) => <MetricCard key={item.title} {...item} />)}
    </div>
  );
}

export function DashboardSection({ title, icon: Icon = Activity, count = null, action = null, children, className = '' }) {
  return (
    <section className={`${styles.section} ${className}`}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitleRow}>
          <Icon size={18} aria-hidden="true" />
          <h2>{title}</h2>
          {count !== null && <span className={styles.countBadge}>{count}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DashboardGrid({ children }) {
  return <div className={styles.dashboardGrid}>{children}</div>;
}

export function ProjectPortfolio({ workspaceId, projects, projectHealth, title = 'Project Portfolio', scoped = false }) {
  return (
    <DashboardSection
      title={title}
      icon={FolderKanban}
      count={projects.length}
      className={styles.wideSection}
      action={<span className={styles.scopeNote}>{scoped ? 'Your authorized scope' : 'RLS-visible portfolio'}</span>}
    >
      {projects.length === 0 ? (
        <DashboardEmpty
          icon={FolderKanban}
          title={scoped ? 'No projects in your operational scope' : 'No visible projects'}
          description={scoped ? 'Projects you own or participate in will appear here.' : 'No project records are currently available.'}
        />
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
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const health = projectHealth.get(project.id);
                return (
                  <tr key={project.id}>
                    <td>
                      <Link className={styles.projectLink} to={`/workspace/${workspaceId}/project/${project.id}`}>
                        <span className={styles.colorDot} style={{ background: project.color || 'var(--yellow)' }} />
                        <span>{project.name}</span>
                      </Link>
                    </td>
                    <td>
                      {project.owner ? (
                        <span className={styles.ownerCell}>
                          <Avatar name={project.owner.full_name || 'Owner'} src={project.owner.avatar_url} size="xs" />
                          <span>{project.owner.full_name || 'Owner'}</span>
                        </span>
                      ) : <span className={styles.muted}>Not assigned</span>}
                    </td>
                    <td><span className={styles.statePill}>{project.project_status || 'active'}</span></td>
                    <td><span className={styles.statePill}>{project.project_priority || 'medium'}</span></td>
                    <td>
                      <span className={styles.progressCell}>
                        <span className={styles.progressTrack}><span style={{ width: `${project.progress || 0}%` }} /></span>
                        <span>{project.progress || 0}%</span>
                      </span>
                    </td>
                    <td>{formatDate(project.target_end_date)}</td>
                    <td><span className={styles.healthPill} data-variant={health?.variant}>{health?.label || 'On Track'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardSection>
  );
}

function getAttentionRows(metrics, personal) {
  const source = personal ? metrics.personal : metrics;
  const rows = [];
  for (const task of source.overdueTasks || []) {
    rows.push({ id: `overdue-${task.id}`, task, label: 'Overdue', variant: 'danger', detail: `Due ${formatDate(task.due_date)}` });
  }
  for (const task of source.blockedTasks || []) {
    rows.push({ id: `blocked-${task.id}`, task, label: 'Blocked', variant: 'warning', detail: 'Delivery is blocked' });
  }
  if (!personal) {
    for (const project of [...metrics.criticalProjects, ...metrics.atRiskProjects]) {
      rows.push({ id: `project-${project.id}`, project, label: 'Project Risk', variant: 'danger', detail: `${project.progress || 0}% complete` });
    }
    for (const task of metrics.assignmentGapTasks || []) {
      rows.push({ id: `gap-${task.id}`, task, label: 'Assignment Gap', variant: 'warning', detail: 'Owner or Assignee needed' });
    }
  }
  return rows.slice(0, 8);
}

export function AttentionList({ workspaceId, metrics, personal = false, title = 'Requires Attention' }) {
  const rows = getAttentionRows(metrics, personal);
  return (
    <DashboardSection title={title} icon={AlertTriangle} count={rows.length}>
      {rows.length === 0 ? (
        <DashboardEmpty icon={Sparkles} title="All clear" description="No overdue, blocked, or urgent items are visible in this scope." compact />
      ) : (
        <div className={styles.attentionList}>
          {rows.map((row) => {
            const project = row.project || row.task?.projects;
            const href = project?.id ? `/workspace/${workspaceId}/project/${project.id}` : `/workspace/${workspaceId}/my-work`;
            return (
              <Link key={row.id} className={styles.attentionItem} data-variant={row.variant} to={href}>
                <span className={styles.attentionBody}>
                  <span className={styles.attentionBadge}>{row.label}</span>
                  <strong>{row.project?.name || row.task?.title || 'Operational item'}</strong>
                  <span>{project?.name && row.task ? `${project.name} · ` : ''}{row.detail}</span>
                </span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </DashboardSection>
  );
}

export function DeliveryStatus({ statusDistribution, title = 'Delivery Status' }) {
  const max = Math.max(1, ...statusDistribution.map((item) => item.count));
  return (
    <DashboardSection title={title} icon={Activity}>
      <div className={styles.barList}>
        {statusDistribution.map((item) => (
          <div className={styles.barRow} key={item.code}>
            <span>{STATUS_LABELS[item.code] || item.code}</span>
            <span className={styles.barTrack}><span style={{ width: `${Math.round((item.count / max) * 100)}%` }} /></span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
    </DashboardSection>
  );
}

export function AssignmentHealth({ metrics }) {
  const rows = [
    ['Tasks missing Owner', metrics.missingOwnerTasks.length, 'warning'],
    ['Tasks missing Assignee', metrics.missingAssigneeTasks.length, 'warning'],
    ['Complete Owner + Assignee', metrics.completeAssignmentTasks.length, 'success'],
  ];
  return (
    <DashboardSection title="Assignment Health" icon={ShieldCheck}>
      <div className={styles.summaryList}>
        {rows.map(([label, value, variant]) => (
          <div className={styles.summaryRow} key={label}>
            <span>{label}</span>
            <strong data-variant={variant}>{value}</strong>
          </div>
        ))}
      </div>
    </DashboardSection>
  );
}

export function PersonalWork({ workspaceId, personal, title = 'My Work' }) {
  const tasks = personal.openTasks.slice(0, 6);
  return (
    <DashboardSection
      title={title}
      icon={CheckCircle2}
      count={personal.openTasks.length + personal.assignedSubtasks.length}
      action={<Link className={styles.sectionLink} to={`/workspace/${workspaceId}/my-work`}>Open My Work <ArrowUpRight size={13} /></Link>}
    >
      {tasks.length === 0 && personal.assignedSubtasks.length === 0 ? (
        <DashboardEmpty icon={CheckCircle2} title="No current work" description="No active assignments are visible for you." compact />
      ) : (
        <div className={styles.workList}>
          {tasks.map((task) => (
            <Link className={styles.workItem} key={task.id} to={`/workspace/${workspaceId}/project/${task.project_id}`}>
              <span>
                <strong>{task.title}</strong>
                <small>{task.projects?.name || 'Visible project'} · {task.myRoles.map((role) => ({ A: 'Owner', R: 'Assignee', C: 'Consulted', I: 'Informed' })[role]).filter(Boolean).join(', ') || 'Subtask context'}</small>
              </span>
              <span className={styles.dueDate}>{formatDate(task.due_date)}</span>
            </Link>
          ))}
          {personal.assignedSubtasks.slice(0, Math.max(0, 6 - tasks.length)).map((subtask) => (
            <Link className={styles.workItem} key={subtask.id} to={`/workspace/${workspaceId}/my-work`}>
              <span><strong>{subtask.title}</strong><small>Assigned Subtask</small></span>
              <span className={styles.dueDate}>{formatDate(subtask.due_date)}</span>
            </Link>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

export function DepartmentOverview({ departments }) {
  return (
    <DashboardSection title="Department Overview" icon={Building2} count={departments.length}>
      {departments.length === 0 ? (
        <DashboardEmpty icon={Building2} title="No attributable work" description="No visible Tasks currently have department-targeted assignments." compact />
      ) : (
        <div className={styles.summaryList}>
          {departments.slice(0, 8).map((department) => (
            <div className={styles.summaryRow} key={department.id}>
              <span className={styles.departmentName}><i style={{ background: department.color || 'var(--yellow)' }} />{department.name}</span>
              <strong>{department.taskCount}</strong>
            </div>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

export function AdminOverview({ admin }) {
  return (
    <DashboardSection title="User & Access Overview" icon={Users}>
      <div className={styles.adminStats}>
        <span><strong>{admin.activeUsers}</strong> Active Users</span>
        <span><strong>{admin.pendingUsers}</strong> Pending Users</span>
        <span><strong>{admin.workspaceMembers}</strong> Workspace Members</span>
        <span><strong>{admin.systemRoleAssignments}</strong> System Role Assignments</span>
      </div>
    </DashboardSection>
  );
}

export function QuickActions({ workspaceId, administration = false, canMutate = false, canAdminister = false }) {
  const actions = administration
    ? [
        canAdminister && ['Manage Users', `/workspace/${workspaceId}/admin/users`, UserCog],
        canAdminister && ['Manage Departments', `/workspace/${workspaceId}/admin/departments`, Building2],
        canAdminister && ['Workspace Settings', `/workspace/${workspaceId}/settings`, Settings],
      ].filter(Boolean)
    : [
        canMutate && ['New Project', `/workspace/${workspaceId}/projects`, FolderKanban],
        ['Projects', `/workspace/${workspaceId}/projects`, FolderKanban],
        ['My Work', `/workspace/${workspaceId}/my-work`, CheckCircle2],
        ['Processes', `/workspace/${workspaceId}/processes`, Workflow],
      ].filter(Boolean);

  if (actions.length === 0) return null;
  return (
    <DashboardSection title={administration ? 'Administrative Quick Actions' : 'Quick Actions'} icon={administration ? UserCog : Activity}>
      <div className={styles.quickGrid}>
        {actions.map(([label, href, Icon]) => (
          <Link className={styles.quickAction} to={href} key={label}><Icon size={17} /><span>{label}</span></Link>
        ))}
      </div>
    </DashboardSection>
  );
}

export function ProcessSummary({ workspaceId, processes }) {
  return (
    <DashboardSection
      title="My Processes"
      icon={Workflow}
      count={processes.length}
      action={<Link className={styles.sectionLink} to={`/workspace/${workspaceId}/processes`}>Process Catalog <ArrowUpRight size={13} /></Link>}
    >
      {processes.length === 0 ? (
        <DashboardEmpty icon={Workflow} title="No active Process involvement" description="Processes you own, start, or participate in will appear here." compact />
      ) : (
        <div className={styles.workList}>
          {processes.slice(0, 6).map((process) => (
            <div className={styles.workItem} key={process.id}>
              <span><strong>{process.instance_name}</strong><small>{process.defined_processes?.name || 'Defined Process'}</small></span>
              <span className={styles.statePill}>{process.status}</span>
            </div>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

export function DashboardEmpty({ icon: Icon, title, description, compact = false }) {
  return (
    <div className={`${styles.empty} ${compact ? styles.emptyCompact : ''}`}>
      <Icon size={compact ? 24 : 32} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
