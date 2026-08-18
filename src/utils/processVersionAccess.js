export function isDepartmentHeadForProcess(process, departmentMemberships = []) {
  return departmentMemberships.some((membership) => (
    membership?.is_active !== false &&
    membership?.role === 'head' &&
    membership?.departments?.id === process?.department_id
  ));
}

export function canManageProcessDraft(process, userContext = {}) {
  const {
    user,
    workspaceRole,
    canAdministerWorkspace,
    isProjectAdmin,
    isSystemAdmin,
    departmentMemberships = [],
  } = userContext;

  if (!user?.id || workspaceRole === 'viewer') return false;

  const hasAdminAuthority = canAdministerWorkspace || isProjectAdmin || isSystemAdmin;
  if (!process) {
    return hasAdminAuthority || departmentMemberships.some((membership) => (
      membership?.is_active !== false && membership?.role === 'head'
    ));
  }

  return Boolean(
    hasAdminAuthority ||
    process.process_owner_id === user.id ||
    isDepartmentHeadForProcess(process, departmentMemberships)
  );
}

export function canPublishProcessDraft(process, userContext = {}) {
  const {
    user,
    workspaceRole,
    canAdministerWorkspace,
    isProjectAdmin,
    isSystemAdmin,
    departmentMemberships = [],
  } = userContext;

  if (!user?.id || workspaceRole === 'viewer') return false;

  return Boolean(
    canAdministerWorkspace ||
    isProjectAdmin ||
    isSystemAdmin ||
    isDepartmentHeadForProcess(process, departmentMemberships)
  );
}

export function getProcessCardCapabilities(process, permissions = {}) {
  const publishedVersion = process?.published_version || null;
  const draftVersion = process?.draft_version || null;

  return {
    publishedVersion,
    draftVersion,
    hasPublished: Boolean(publishedVersion),
    hasDraft: Boolean(draftVersion),
    canViewPublished: Boolean(publishedVersion),
    canStart: Boolean(publishedVersion),
    canViewDraft: Boolean(draftVersion),
    canEditDraft: Boolean(draftVersion && permissions.canEditDraft),
    canPublishDraft: Boolean(draftVersion && permissions.canPublishDraft),
  };
}

export function getProcessDefinitionPath(workspaceId, processId, versionId) {
  return `/workspace/${workspaceId}/processes/${processId}/versions/${versionId}`;
}

export function isLinearProcessFlow(steps = [], dependencies = []) {
  if (steps.length <= 1) return dependencies.length === 0;
  if (dependencies.length !== steps.length - 1) return false;

  const stepsById = new Map(steps.map((step) => [step.id, step]));
  return dependencies.every((dependency) => {
    const step = stepsById.get(dependency.step_id);
    const predecessor = stepsById.get(dependency.depends_on_step_id);
    return step && predecessor && step.sequence_order === predecessor.sequence_order + 1;
  });
}
