import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckSquare, Plus, RefreshCw } from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { useUserContext } from '../hooks/useUserContext';
import { useDepartments } from '../hooks/useDepartments';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  DASHBOARD_PERSONAS,
  getDashboardBadgeRole,
  getDashboardDefinition,
  resolveDashboardPersona,
} from '../dashboard/dashboardPersona';
import { buildDashboardMetrics } from '../dashboard/dashboardMetrics';
import PageHeader from '../components/PageHeader';
import RoleBadge from '../components/RoleBadge';
import EmptyState from '../components/EmptyState';
import { MetricCardsSkeleton, CardGridSkeleton } from '../components/Skeleton';
import ExecutiveDashboard from '../components/dashboard/ExecutiveDashboard';
import ProjectAdminDashboard from '../components/dashboard/ProjectAdminDashboard';
import SystemAdminDashboard from '../components/dashboard/SystemAdminDashboard';
import ScopedOperationsDashboard from '../components/dashboard/ScopedOperationsDashboard';
import styles from './DashboardPage.module.css';

export default function DashboardPage() {
  const { workspaceId } = useParams();
  const userContext = useUserContext(workspaceId);
  const {
    user,
    systemRoles,
    workspaceRole,
    departmentMemberships,
    hasGlobalOperationalVisibility,
    canAdministerWorkspace,
    canMutateOperationalData,
    authorizationScopeKey,
  } = userContext;

  const persona = resolveDashboardPersona({ systemRoles, workspaceRole });
  const definition = getDashboardDefinition(persona);
  const badgeRole = getDashboardBadgeRole(persona, systemRoles, workspaceRole);
  const { projects = [], loading: projectsLoading } = useProjects(workspaceId, authorizationScopeKey);
  const { departments = [] } = useDepartments(workspaceId);
  const { workspaces = [] } = useWorkspaces();
  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const departmentIds = useMemo(
    () => departmentMemberships.map((membership) => membership.departments?.id).filter(Boolean),
    [departmentMemberships]
  );

  const dashboardData = useDashboardData({
    workspaceId,
    authorizationScopeKey,
    projects,
    projectsLoading,
    includeAdministration: persona === DASHBOARD_PERSONAS.SYSTEM_ADMIN,
  });
  const dashboardCacheKey = dashboardData.cacheKey;
  const metrics = useMemo(() => buildDashboardMetrics({
    projects,
    tasks: dashboardData.tasks,
    raciRows: dashboardData.raciRows,
    subtasks: dashboardData.subtasks,
    processInstances: dashboardData.processInstances,
    departments,
    userId: user?.id,
    departmentIds,
    admin: dashboardData.admin,
    scopedOperational: !hasGlobalOperationalVisibility,
  }), [dashboardData, departmentIds, departments, hasGlobalOperationalVisibility, projects, user?.id]);

  const initialLoading =
    !authorizationScopeKey ||
    (projectsLoading && projects.length === 0) ||
    (dashboardData.loading && dashboardData.tasks.length === 0);
  const scopeLabel = hasGlobalOperationalVisibility
    ? 'RLS-authorized workspace operations'
    : 'Within your visible scope';

  const sharedProps = {
    workspaceId,
    projects,
    metrics,
    canMutate: canMutateOperationalData,
    canAdminister: canAdministerWorkspace,
  };

  let dashboard = <ScopedOperationsDashboard {...sharedProps} persona={persona} />;
  if (persona === DASHBOARD_PERSONAS.EXECUTIVE) dashboard = <ExecutiveDashboard {...sharedProps} />;
  if (persona === DASHBOARD_PERSONAS.PROJECT_ADMIN) dashboard = <ProjectAdminDashboard {...sharedProps} />;
  if (persona === DASHBOARD_PERSONAS.SYSTEM_ADMIN) dashboard = <SystemAdminDashboard {...sharedProps} />;

  return (
    <div className={styles.container} data-dashboard-persona={persona} data-dashboard-cache-key={dashboardCacheKey}>
      <PageHeader
        title={definition.title}
        subtitle={`${scopeLabel} for ${currentWorkspace?.name || 'this workspace'}`}
        badge={
          <div className={styles.badgeRow}>
            <RoleBadge role={badgeRole} size="md" />
            {dashboardData.refreshing && (
              <span className={styles.refreshingPill} title="Refreshing authorized dashboard data">
                <RefreshCw size={12} aria-hidden="true" /> Refreshing
              </span>
            )}
          </div>
        }
        actions={
          <div className={styles.headerActions}>
            <Link to={`/workspace/${workspaceId}/my-work`} className={styles.secondaryAction}>
              <CheckSquare size={16} /> My Work
            </Link>
            {canMutateOperationalData && (
              <Link to={`/workspace/${workspaceId}/projects`} className={styles.primaryAction}>
                <Plus size={16} /> New Project
              </Link>
            )}
          </div>
        }
      />

      {dashboardData.error && (
        <EmptyState
          title="Dashboard data is temporarily unavailable"
          description="Your access remains unchanged. Retry from this page after checking the connection."
          actionLabel="Retry"
          onAction={() => dashboardData.refetch()}
        />
      )}

      {initialLoading ? (
        <div className={styles.loadingStack}>
          <MetricCardsSkeleton count={6} />
          <CardGridSkeleton count={3} />
        </div>
      ) : dashboard}
    </div>
  );
}
