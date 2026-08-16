/**
 * SNS Projects — V1-03A Process Draft Normalization
 * Converts local builder state (or future V1-03B Excel imported records)
 * into the standardized draft payload required by the backend Edge Function / RPC.
 */

export function normalizeProcessDraftPayload({
  workspaceId,
  processId = null,
  versionId = null,
  baseUpdatedAt = null,
  process = {},
  steps = [],
}) {
  const normalizedSteps = (steps || []).map((step, idx) => {
    const seqOrder = idx + 1;
    const stepCode = (step.step_code || '').trim() || `STP-${String(seqOrder).padStart(3, '0')}`;
    const stepTitle = (step.title || '').trim();
    const duration = Math.max(1, parseInt(step.expected_duration_days, 10) || 1);

    // Normalize RACI assignments
    const raci = (step.raci || [])
      .filter((item) => item && (item.actor_type === 'process_starter' || item.user_id))
      .map((item) => ({
        raci_role: item.raci_role,
        actor_type: item.actor_type === 'process_starter' ? 'process_starter' : 'user',
        user_id: item.actor_type === 'process_starter' ? null : item.user_id,
        response_required: item.raci_role === 'C' ? Boolean(item.response_required) : false,
      }));

    return {
      id: step.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined),
      step_code: stepCode,
      title: stepTitle,
      description: step.description ? String(step.description).trim() : null,
      sequence_order: seqOrder,
      expected_duration_days: duration,
      approval_required: Boolean(step.approval_required),
      consultation_required: Boolean(step.consultation_required),
      evidence_required: Boolean(step.evidence_required),
      raci,
    };
  });

  return {
    action: 'save_draft',
    workspace_id: workspaceId,
    process_id: processId || null,
    version_id: versionId || null,
    base_updated_at: baseUpdatedAt || null,
    process: {
      name: (process.name || '').trim(),
      code: (process.code || '').trim(),
      description: process.description ? String(process.description).trim() : null,
      department_id: process.department_id || null,
      process_owner_id: process.process_owner_id || null,
    },
    steps: normalizedSteps,
  };
}
