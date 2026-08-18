import { AlertTriangle, CheckSquare, Clock, FolderKanban, ShieldAlert } from 'lucide-react';
import {
  AssignmentHealth,
  AttentionList,
  DashboardGrid,
  DashboardKpis,
  DeliveryStatus,
  ProjectPortfolio,
  QuickActions,
} from './DashboardWidgets';

export default function ProjectAdminDashboard({ workspaceId, projects, metrics, canMutate }) {
  return (
    <>
      <DashboardKpis items={[
        { title: 'Active Projects', value: metrics.activeProjects.length, subtitle: 'RLS-visible portfolio', icon: FolderKanban, variant: 'accent' },
        { title: 'Critical / At-Risk', value: metrics.criticalProjects.length + metrics.atRiskProjects.length, subtitle: 'Projects requiring review', icon: AlertTriangle, variant: metrics.criticalProjects.length + metrics.atRiskProjects.length ? 'warning' : 'success' },
        { title: 'Open Tasks', value: metrics.openTasks.length, subtitle: 'Current delivery workload', icon: CheckSquare, variant: 'info' },
        { title: 'Overdue Tasks', value: metrics.overdueTasks.length, subtitle: 'Past their due date', icon: Clock, variant: metrics.overdueTasks.length ? 'danger' : 'default' },
        { title: 'Blocked Tasks', value: metrics.blockedTasks.length, subtitle: 'Blocked delivery items', icon: ShieldAlert, variant: metrics.blockedTasks.length ? 'warning' : 'default' },
        { title: 'Assignment Gaps', value: metrics.assignmentGapTasks.length, subtitle: 'Missing Owner or Assignee', icon: CheckSquare, variant: metrics.assignmentGapTasks.length ? 'warning' : 'success' },
      ]} />
      <DashboardGrid>
        <ProjectPortfolio workspaceId={workspaceId} projects={projects} projectHealth={metrics.projectHealth} />
        <AttentionList workspaceId={workspaceId} metrics={metrics} />
        <AssignmentHealth metrics={metrics} />
        <DeliveryStatus statusDistribution={metrics.statusDistribution} />
        <QuickActions workspaceId={workspaceId} canMutate={canMutate} />
      </DashboardGrid>
    </>
  );
}
