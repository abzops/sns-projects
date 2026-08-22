import { useUserContext } from './useUserContext.js';

/**
 * Hook to derive workspace Finance Overview access rights
 *
 * Broad Finance Overview is accessible only to:
 * - Active Workspace Owner
 * - Active Workspace Admin
 * - Active CEO (with active workspace membership)
 * - Active CTO (with active workspace membership)
 * - Active Finance Operator (active workspace tenancy + active FIN department membership)
 *
 * Project Admin only, System Admin only, normal Member, Viewer, or CEO/CTO without
 * active workspace membership are NOT granted broad workspace Finance Overview access.
 *
 * Note: Backend RPCs remain the ultimate authorization boundary.
 */
export function useFinanceAccess(workspaceId) {
  const userContext = useUserContext(workspaceId);
  const {
    workspaceRole,
    isOwner,
    isWorkspaceAdmin,
    isCEO,
    isCTO,
    departmentMemberships = [],
    loading,
    error,
  } = userContext;

  const hasActiveWorkspaceMembership = Boolean(workspaceRole);

  const isFinanceOperator =
    hasActiveWorkspaceMembership &&
    departmentMemberships.some(
      (dm) =>
        dm.is_active &&
        (dm.departments?.code?.toUpperCase() === 'FIN' || dm.departments?.code === 'FIN')
    );

  const canManageBudgets =
    hasActiveWorkspaceMembership &&
    (isOwner || isWorkspaceAdmin || isCEO || isCTO);

  const canViewWorkspaceFinance = canManageBudgets || isFinanceOperator;

  return {
    ...userContext,
    hasActiveWorkspaceMembership,
    isFinanceOperator,
    canManageBudgets,
    canViewWorkspaceFinance,
    financeAccessLoading: loading,
    financeAccessError: error,
  };
}
