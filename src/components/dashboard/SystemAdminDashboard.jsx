import { AlertTriangle, Building2, FolderKanban, ShieldAlert, UserPlus, Users } from 'lucide-react';
import {
  AdminOverview,
  DashboardGrid,
  DashboardKpis,
  DashboardSection,
  PersonalWork,
  QuickActions,
} from './DashboardWidgets';
import styles from './DashboardEngine.module.css';

export default function SystemAdminDashboard({ workspaceId, metrics, canAdminister }) {
  const operationalRows = [
    ['Active Projects', metrics.activeProjects.length],
    ['Overdue Tasks', metrics.overdueTasks.length],
    ['Blocked Tasks', metrics.blockedTasks.length],
    ['Assignment Gaps', metrics.assignmentGapTasks.length],
  ];

  return (
    <>
      <DashboardKpis items={[
        { title: 'Active Users', value: metrics.admin.activeUsers, subtitle: 'Active workspace members', icon: Users, variant: 'accent' },
        { title: 'Pending Users', value: metrics.admin.pendingUsers, subtitle: 'Awaiting activation', icon: UserPlus, variant: metrics.admin.pendingUsers ? 'warning' : 'default' },
        { title: 'Departments', value: metrics.admin.departments, subtitle: 'Configured workspace departments', icon: Building2, variant: 'info' },
        { title: 'System Role Assignments', value: metrics.admin.systemRoleAssignments, subtitle: 'Global operational authorities', icon: ShieldAlert, variant: 'default' },
        { title: 'Workspace Members', value: metrics.admin.workspaceMembers, subtitle: 'All membership states', icon: Users, variant: 'default' },
        { title: 'Visible Active Projects', value: metrics.activeProjects.length, subtitle: 'Compact operational overview', icon: FolderKanban, variant: 'default' },
      ]} />
      <DashboardGrid>
        <AdminOverview admin={metrics.admin} />
        <DashboardSection title="Department Administration" icon={Building2} count={metrics.admin.departments}>
          <p className={styles.sectionCopy}>Review department structure and membership using the established administration surface.</p>
        </DashboardSection>
        <QuickActions workspaceId={workspaceId} administration canAdminister={canAdminister} />
        <DashboardSection title="Operational Snapshot" icon={AlertTriangle}>
          <div className={styles.summaryList}>
            {operationalRows.map(([label, value]) => <div className={styles.summaryRow} key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
        </DashboardSection>
        <PersonalWork workspaceId={workspaceId} personal={metrics.personal} />
      </DashboardGrid>
    </>
  );
}
