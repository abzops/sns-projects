export const DASHBOARD_PERSONAS = Object.freeze({
  EXECUTIVE: 'executive',
  SYSTEM_ADMIN: 'system_admin',
  PROJECT_ADMIN: 'project_admin',
  WORKSPACE_OWNER: 'workspace_owner',
  WORKSPACE_ADMIN: 'workspace_admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
});

const DEFINITIONS = Object.freeze({
  [DASHBOARD_PERSONAS.EXECUTIVE]: Object.freeze({
    title: 'Executive Dashboard',
    scope: 'rls-broad',
    widgets: Object.freeze(['portfolio_health', 'requires_attention', 'operational_delivery', 'department_overview', 'my_responsibilities']),
  }),
  [DASHBOARD_PERSONAS.SYSTEM_ADMIN]: Object.freeze({
    title: 'System Administration',
    scope: 'rls-broad',
    widgets: Object.freeze(['user_access_overview', 'department_administration', 'administrative_quick_actions', 'operational_snapshot', 'my_work']),
  }),
  [DASHBOARD_PERSONAS.PROJECT_ADMIN]: Object.freeze({
    title: 'Project Administration',
    scope: 'rls-broad',
    widgets: Object.freeze(['project_portfolio', 'requires_attention', 'assignment_health', 'delivery_status', 'quick_actions']),
  }),
  [DASHBOARD_PERSONAS.WORKSPACE_OWNER]: Object.freeze({
    title: 'Workspace Operations',
    scope: 'rls-scoped',
    widgets: Object.freeze(['my_operational_scope', 'my_projects', 'requires_my_attention', 'my_work', 'workspace_administration']),
  }),
  [DASHBOARD_PERSONAS.WORKSPACE_ADMIN]: Object.freeze({
    title: 'Workspace Operations',
    scope: 'rls-scoped',
    widgets: Object.freeze(['my_projects', 'current_work', 'requires_my_attention', 'my_work', 'workspace_administration']),
  }),
  [DASHBOARD_PERSONAS.MEMBER]: Object.freeze({
    title: 'My Operations',
    scope: 'rls-scoped',
    widgets: Object.freeze(['my_current_work', 'my_projects', 'upcoming', 'requires_my_attention', 'my_processes']),
  }),
  [DASHBOARD_PERSONAS.VIEWER]: Object.freeze({
    title: 'My Operations',
    scope: 'rls-scoped',
    readOnly: true,
    widgets: Object.freeze(['visible_projects', 'current_work', 'relevant_status']),
  }),
});

export function resolveDashboardPersona({ systemRoles = [], workspaceRole = null } = {}) {
  const roles = new Set((systemRoles || []).map((role) => String(role).toLowerCase()));

  if (roles.has('ceo') || roles.has('cto')) return DASHBOARD_PERSONAS.EXECUTIVE;
  if (roles.has('system_admin')) return DASHBOARD_PERSONAS.SYSTEM_ADMIN;
  if (roles.has('project_admin')) return DASHBOARD_PERSONAS.PROJECT_ADMIN;

  switch (String(workspaceRole || '').toLowerCase()) {
    case 'owner':
      return DASHBOARD_PERSONAS.WORKSPACE_OWNER;
    case 'admin':
      return DASHBOARD_PERSONAS.WORKSPACE_ADMIN;
    case 'viewer':
      return DASHBOARD_PERSONAS.VIEWER;
    case 'member':
    default:
      return DASHBOARD_PERSONAS.MEMBER;
  }
}
export function getDashboardDefinition(persona) {
  return DEFINITIONS[persona] || DEFINITIONS[DASHBOARD_PERSONAS.MEMBER];
}

export function getDashboardBadgeRole(persona, systemRoles = [], workspaceRole = null) {
  const roles = new Set((systemRoles || []).map((role) => String(role).toLowerCase()));
  if (persona === DASHBOARD_PERSONAS.EXECUTIVE) return roles.has('ceo') ? 'ceo' : 'cto';
  if (persona === DASHBOARD_PERSONAS.SYSTEM_ADMIN) return 'system_admin';
  if (persona === DASHBOARD_PERSONAS.PROJECT_ADMIN) return 'project_admin';
  return workspaceRole || (persona === DASHBOARD_PERSONAS.VIEWER ? 'viewer' : 'member');
}
