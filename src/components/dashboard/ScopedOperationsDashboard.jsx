import { AlertTriangle, CheckSquare, Clock, Eye, FolderKanban, Info, ShieldAlert, UserCheck } from 'lucide-react';
import { DASHBOARD_PERSONAS } from '../../dashboard/dashboardPersona';
import {
  AttentionList,
  DashboardGrid,
  DashboardKpis,
  PersonalWork,
  ProcessSummary,
  ProjectPortfolio,
  QuickActions,
} from './DashboardWidgets';

function scopedKpis(persona, metrics) {
  const personal = metrics.personal;
  if (persona === DASHBOARD_PERSONAS.VIEWER) {
    return [
      { title: 'Visible Projects', value: metrics.activeProjects.length, subtitle: 'Your authorized read scope', icon: Eye, variant: 'accent' },
      { title: 'Open Work', value: metrics.openTasks.length, subtitle: 'Visible current work', icon: CheckSquare, variant: 'info' },
      { title: 'Due Soon', value: metrics.dueSoonTasks.length, subtitle: 'Due within seven days', icon: Clock, variant: 'default' },
      { title: 'Overdue', value: metrics.overdueTasks.length, subtitle: 'Past due in your scope', icon: AlertTriangle, variant: metrics.overdueTasks.length ? 'danger' : 'default' },
      { title: 'For My Info', value: personal.informedTasks.length, subtitle: 'Read-only information', icon: Info, variant: 'default' },
    ];
  }

  if (persona === DASHBOARD_PERSONAS.MEMBER) {
    return [
      { title: 'Assigned to Me', value: personal.assignedCount, subtitle: 'Tasks and Subtasks', icon: UserCheck, variant: 'accent' },
      { title: 'I Own', value: personal.ownedTasks.length, subtitle: 'Owner responsibility', icon: ShieldAlert, variant: 'info' },
      { title: 'Needs My Input', value: personal.consultedTasks.length, subtitle: 'Consultation requested', icon: CheckSquare, variant: 'default' },
      { title: 'For My Info', value: personal.informedTasks.length, subtitle: 'Information visibility', icon: Info, variant: 'default' },
      { title: 'Overdue', value: personal.overdueCount, subtitle: 'Past due in your work', icon: AlertTriangle, variant: personal.overdueCount ? 'danger' : 'default' },
      { title: 'Due Soon', value: personal.dueSoonCount, subtitle: 'Due within seven days', icon: Clock, variant: 'default' },
    ];
  }

  return [
    { title: 'My Visible Projects', value: metrics.activeProjects.length, subtitle: 'Owned or involved scope only', icon: FolderKanban, variant: 'accent' },
    { title: 'Assigned to Me', value: personal.assignedCount, subtitle: 'Tasks and Subtasks', icon: UserCheck, variant: 'info' },
    { title: 'I Own', value: personal.ownedTasks.length, subtitle: 'Owner responsibility', icon: ShieldAlert, variant: 'default' },
    { title: 'Needs My Input', value: personal.consultedTasks.length, subtitle: 'Consultation requested', icon: CheckSquare, variant: 'default' },
    { title: 'Overdue in My Scope', value: metrics.overdueTasks.length, subtitle: 'Past due work', icon: AlertTriangle, variant: metrics.overdueTasks.length ? 'danger' : 'default' },
    { title: 'Blocked in My Scope', value: metrics.blockedTasks.length, subtitle: 'Blocked work', icon: ShieldAlert, variant: metrics.blockedTasks.length ? 'warning' : 'default' },
  ];
}

export default function ScopedOperationsDashboard({
  persona,
  workspaceId,
  projects,
  metrics,
  canAdminister,
}) {
  const isMember = persona === DASHBOARD_PERSONAS.MEMBER;
  const isViewer = persona === DASHBOARD_PERSONAS.VIEWER;
  const projectTitle = isMember ? 'My Projects' : isViewer ? 'Visible Projects' : 'My Operational Scope';

  return (
    <>
      <DashboardKpis items={scopedKpis(persona, metrics)} />
      <DashboardGrid>
        <ProjectPortfolio workspaceId={workspaceId} projects={projects} projectHealth={metrics.projectHealth} title={projectTitle} scoped />
        <AttentionList workspaceId={workspaceId} metrics={metrics} personal title={isViewer ? 'Relevant Status' : 'Requires My Attention'} />
        <PersonalWork workspaceId={workspaceId} personal={metrics.personal} title={isMember ? 'My Current Work' : 'Current Work'} />
        {!isViewer && <ProcessSummary workspaceId={workspaceId} processes={metrics.personal.processes} />}
        {canAdminister && <QuickActions workspaceId={workspaceId} administration canAdminister />}
      </DashboardGrid>
    </>
  );
}
