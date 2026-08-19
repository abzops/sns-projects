import { supabase } from './supabase.js';

/**
 * Currency formatter for SNS Projects (INR / ₹)
 * @param {number|string} amount
 * @param {boolean} includeDecimals
 * @returns {string} Formatted string like "₹1,500.00"
 */
export function formatCurrency(amount, includeDecimals = true) {
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (isNaN(num)) return includeDecimals ? '₹0.00' : '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: includeDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Parses numeric input into a sanitized positive number or null if invalid
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseExpenseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (isNaN(num) || !isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Standard suggested expense categories
 */
export const EXPENSE_CATEGORIES = [
  'Hardware',
  'Software',
  'Materials',
  'Labor',
  'Services',
  'Equipment',
  'Travel',
  'Logistics',
  'Other',
];

/**
 * Validates the UI form state and normalizes it for PostgreSQL backend
 * @param {Object} form
 * @returns {{ isValid: boolean, error: string|null, payload: Object|null }}
 */
export function validateExpenseForm(form) {
  if (!form.hasExpense) {
    return { isValid: true, error: null, payload: null };
  }

  const dateStr = (form.expenseDate || '').trim();
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { isValid: false, error: 'Please enter a valid expense date (YYYY-MM-DD).', payload: null };
  }

  if (form.mode === 'single') {
    const amount = parseExpenseAmount(form.singleAmount);
    if (amount === null) {
      return {
        isValid: false,
        error: 'Expense amount must be a positive number greater than ₹0.00.',
        payload: null,
      };
    }

    const payload = {
      expense_date: dateStr,
      amount,
      category: form.singleCategory?.trim() || null,
      description: form.singleDescription?.trim() || null,
    };
    return { isValid: true, error: null, payload };
  }

  if (form.mode === 'itemized') {
    const items = form.items || [];
    if (items.length === 0) {
      return {
        isValid: false,
        error: 'Itemized expense must contain at least one line item.',
        payload: null,
      };
    }

    const normalizedItems = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const amount = parseExpenseAmount(item.amount);
      if (amount === null) {
        return {
          isValid: false,
          error: `Line ${i + 1} has an invalid amount. Each line must be greater than ₹0.00.`,
          payload: null,
        };
      }
      normalizedItems.push({
        line_number: i + 1,
        amount,
        category: item.category?.trim() || null,
        description: item.description?.trim() || null,
      });
    }

    const payload = {
      expense_date: dateStr,
      description: form.overallDescription?.trim() || null,
      items: normalizedItems,
    };
    return { isValid: true, error: null, payload };
  }

  return { isValid: false, error: 'Invalid expense mode.', payload: null };
}

/**
 * Calls backend RPC public.complete_task_with_expense
 * @param {string} taskId
 * @param {Object|null} expensePayload
 * @param {string|null} notes
 * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
 */
export async function completeTaskWithExpense(taskId, expensePayload = null, notes = null) {
  try {
    const { data, error } = await supabase.rpc('complete_task_with_expense', {
      p_task_id: taskId,
      p_expense_payload: expensePayload || null,
      p_notes: notes?.trim() || null,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('[expenseExecution] completeTaskWithExpense error:', err);
    return {
      success: false,
      error: err.message || 'Failed to complete task.',
    };
  }
}

/**
 * Calls backend RPC public.complete_responsible_step_with_expense
 * @param {string} taskId
 * @param {number} cycleNumber
 * @param {string|null} notes
 * @param {Object|null} expensePayload
 * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
 */
export async function completeResponsibleStepWithExpense(
  taskId,
  cycleNumber = 1,
  notes = null,
  expensePayload = null
) {
  try {
    const { data, error } = await supabase.rpc('complete_responsible_step_with_expense', {
      p_task_id: taskId,
      p_cycle_number: Number(cycleNumber) || 1,
      p_notes: notes?.trim() || null,
      p_expense_payload: expensePayload || null,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('[expenseExecution] completeResponsibleStepWithExpense error:', err);
    return {
      success: false,
      error: err.message || 'Failed to complete process step.',
    };
  }
}
