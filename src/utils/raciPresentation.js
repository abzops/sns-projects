export const RACI_ROLE_LABELS = Object.freeze({
  A: 'Owner',
  R: 'Assignee',
  C: 'Consulted',
  I: 'Informed',
});

export const RACI_ROLE_GROUP_LABELS = Object.freeze({
  A: 'Owner',
  R: 'Assignees',
  C: 'Consulted',
  I: 'Informed',
});

export function getRaciRoleLabel(role, { group = false } = {}) {
  const labels = group ? RACI_ROLE_GROUP_LABELS : RACI_ROLE_LABELS;
  return labels[role] || role;
}
