import { AlertTriangle, CheckSquare, Clock, FolderKanban, ShieldAlert } from 'lucide-react';
import {
  AttentionList,
  DashboardGrid,
  DashboardKpis,
  DeliveryStatus,
  DepartmentOverview,
  PersonalWork,
  ProjectPortfolio,
} from './DashboardWidgets';

export default function ExecutiveDashboard({ workspaceId, projects, metrics }) {
  return (
    <>
      <DashboardKpis items={[
        { title: 'Active Projects', value: metrics.activeProjects.length, subtitle: 'Workspace-wide RLS-visible portfolio', icon: FolderKanban, variant: 'accent' },
        { title: 'Critical Projects', value: metrics.criticalProjects.length, subtitle: 'Immediate executive review', icon: AlertTriangle, variant: metrics.criticalProjects.length ? 'danger' : 'success' },
        { title: 'At-Risk Projects', value: metrics.atRiskProjects.length, subtitle: 'Delivery risk detected', icon: AlertTriangle, variant: metrics.atRiskProjects.length ? 'warning' : 'default' },
        { title: 'Overdue Tasks', value: metrics.overdueTasks.length, subtitle: 'Across visible operations', icon: Clock, variant: metrics.overdueTasks.length ? 'danger' : 'default' },
        { title: 'Blocked Tasks', value: metrics.blockedTasks.length, subtitle: 'Blocked delivery items', icon: ShieldAlert, variant: metrics.blockedTasks.length ? 'warning' : 'default' },
        { title: 'Assignment Gaps', value: metrics.assignmentGapTasks.length, subtitle: 'Tasks missing an Owner or Assignee', icon: CheckSquare, variant: metrics.assignmentGapTasks.length ? 'warning' : 'success' },
      ]} />
      <DashboardGrid>
        <ProjectPortfolio workspaceId={workspaceId} projects={projects} projectHealth={metrics.projectHealth} title="Portfolio Health" />
        <AttentionList workspaceId={workspaceId} metrics={metrics} />
        <DeliveryStatus statusDistribution={metrics.statusDistribution} title="Operational Delivery" />
        <DepartmentOverview departments={metrics.departmentOverview} />
        <PersonalWork workspaceId={workspaceId} personal={metrics.personal} title="My Responsibilities" />
      </DashboardGrid>
    </>
  );
}
