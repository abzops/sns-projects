/**
 * Shared Finance Domain Utilities
 *
 * Provides presentation normalization and canonical contract mapping for Finance entities.
 * Note: Zero financial decision logic or threshold recalculation belongs in the frontend;
 * all business calculations are strictly performed by PostgreSQL database engines.
 */

/**
 * Normalizes backend financial summary JSON object into numeric presentation values
 * while preserving exact backend business fields and risk band.
 * @param {Object|null} raw
 * @returns {Object|null}
 */
export function normalizeFinancialSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    entity_type: raw.entity_type || null,
    entity_id: raw.entity_id || null,
    is_budgeted: Boolean(raw.is_budgeted),
    budget_source_type: raw.budget_source_type || null,
    budget_source_id: raw.budget_source_id || null,
    base_budget: Number(raw.base_budget) || 0,
    safety_buffer: Number(raw.safety_buffer) || 0,
    total_ceiling: Number(raw.total_ceiling) || 0,
    actual_spend: Number(raw.actual_spend) || 0,
    remaining_base: Number(raw.remaining_base) || 0,
    buffer_used: Number(raw.buffer_used) || 0,
    buffer_remaining: Number(raw.buffer_remaining) || 0,
    overrun: Number(raw.overrun) || 0,
    utilization_pct: Number(raw.utilization_pct) || 0,
    risk_band: raw.risk_band || 'GREEN',
    allocated_to_children: Number(raw.allocated_to_children) || 0,
    unallocated_base: Number(raw.unallocated_base) || 0,
    project_spend: Number(raw.project_spend) || 0,
    standalone_spend: Number(raw.standalone_spend) || 0,
  };
}

/**
 * Determines whether a financial summary has an active effective budget
 * (either owning its own budget row or inheriting an ancestor budget).
 * @param {Object|null} summary
 * @returns {boolean}
 */
export function hasEffectiveBudget(summary) {
  if (!summary || typeof summary !== 'object') return false;
  return summary.is_budgeted === true || Boolean(summary.budget_source_id);
}

