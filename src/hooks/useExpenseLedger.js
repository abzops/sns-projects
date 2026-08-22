import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { clearFinanceOverviewCache } from './useFinanceOverview.js';

const expenseLedgerCache = new Map(); // cacheKey -> { transactions: [], tombstones: [] }

export function clearExpenseLedgerCache() {
  expenseLedgerCache.clear();
}

/**
 * Hook to manage workspace expense ledger data and administration RPC operations.
 *
 * Enforces fail-closed RLS:
 * - Read access governed by private.can_view_expense_transaction
 * - Mutations governed strictly by public RPCs (correct_expense_transaction, void_expense_transaction, hard_delete_expense_transaction)
 */
export function useExpenseLedger(workspaceId, { enabled = true } = {}) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const cacheKey = `${userId || 'anon'}:${workspaceId || 'none'}`;

  const [transactions, setTransactions] = useState(() => (workspaceId ? expenseLedgerCache.get(cacheKey)?.transactions || [] : []));
  const [tombstones, setTombstones] = useState(() => (workspaceId ? expenseLedgerCache.get(cacheKey)?.tombstones || [] : []));
  const [loading, setLoading] = useState(() => (enabled && workspaceId ? !expenseLedgerCache.has(cacheKey) : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const activeFetchIdRef = useRef(0);

  const fetchLedger = useCallback(
    async (options = {}) => {
      const isSilent = options?.silent ?? false;
      if (!workspaceId || !userId || !enabled) {
        setTransactions([]);
        setTombstones([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const fetchId = ++activeFetchIdRef.current;

      try {
        if (!isSilent && !expenseLedgerCache.has(cacheKey)) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);

        // Fetch active/corrected/voided transactions with relational joins
        const txPromise = supabase
          .from('expense_transactions')
          .select(`
            id,
            workspace_id,
            task_id,
            subtask_id,
            expense_date,
            description,
            status,
            created_by,
            updated_by,
            cycle_number,
            created_at,
            updated_at,
            tasks (
              id,
              title,
              project_id,
              phase_id,
              parent_task_id,
              process_step_id,
              process_instance_id,
              projects (
                id,
                name,
                color
              ),
              phases (
                id,
                name
              )
            ),
            subtasks (
              id,
              title
            ),
            profiles_created_by:profiles!expense_transactions_created_by_fkey (
              id,
              full_name
            ),
            profiles_updated_by:profiles!expense_transactions_updated_by_fkey (
              id,
              full_name
            ),
            expense_items (
              id,
              line_number,
              amount,
              category,
              description
            )
          `)
          .eq('workspace_id', workspaceId)
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false });

        // Fetch audit tombstones for hard-deleted records
        const tombstonePromise = supabase
          .from('expense_audit_logs')
          .select(`
            id,
            workspace_id,
            transaction_id,
            original_transaction_id,
            subtask_id,
            action,
            previous_status,
            new_status,
            previous_total_amount,
            new_total_amount,
            reason,
            actor_id,
            metadata,
            created_at,
            actor:profiles!expense_audit_logs_actor_id_fkey (
              id,
              full_name
            )
          `)
          .eq('workspace_id', workspaceId)
          .eq('action', 'hard_deleted')
          .order('created_at', { ascending: false });

        const [txRes, tombstoneRes] = await Promise.all([txPromise, tombstonePromise]);

        if (fetchId !== activeFetchIdRef.current) return;

        if (txRes.error) {
          throw txRes.error;
        }

        const txList = txRes.data || [];
        const tombList = tombstoneRes.data || [];

        expenseLedgerCache.set(cacheKey, { transactions: txList, tombstones: tombList });
        setTransactions(txList);
        setTombstones(tombList);
      } catch (err) {
        if (fetchId !== activeFetchIdRef.current) return;
        console.error('[useExpenseLedger] fetchLedger error:', err);
        setError(err.message || 'Failed to load expense ledger.');
      } finally {
        if (fetchId === activeFetchIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [workspaceId, userId, enabled, cacheKey]
  );

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  /**
   * Fetch immutable audit logs for a specific transaction
   */
  const fetchTransactionAudit = useCallback(
    async (transactionId) => {
      if (!transactionId || !workspaceId) return [];

      try {
        const { data, error: auditErr } = await supabase
          .from('expense_audit_logs')
          .select(`
            id,
            workspace_id,
            transaction_id,
            original_transaction_id,
            subtask_id,
            action,
            previous_status,
            new_status,
            previous_total_amount,
            new_total_amount,
            reason,
            actor_id,
            metadata,
            created_at,
            actor:profiles!expense_audit_logs_actor_id_fkey (
              id,
              full_name
            )
          `)
          .eq('workspace_id', workspaceId)
          .or(`original_transaction_id.eq.${transactionId},transaction_id.eq.${transactionId}`)
          .order('created_at', { ascending: false });

        if (auditErr) throw auditErr;
        return data || [];
      } catch (err) {
        console.error('[useExpenseLedger] fetchTransactionAudit error:', err);
        return [];
      }
    },
    [workspaceId]
  );

  /**
   * Correct an existing expense transaction via public.correct_expense_transaction
   */
  const correctExpense = useCallback(
    async ({ transactionId, items, reason, description = null, expenseDate = null }) => {
      if (!transactionId) throw new Error('Transaction ID is required.');
      if (!reason || !reason.trim()) throw new Error('A correction reason is required.');
      if (!items || !items.length) throw new Error('At least one line item is required.');

      const { data, error: rpcErr } = await supabase.rpc('correct_expense_transaction', {
        p_transaction_id: transactionId,
        p_items: items,
        p_reason: reason.trim(),
        p_description: description ? description.trim() : null,
        p_expense_date: expenseDate || null,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || 'Failed to correct expense.');
      }

      // Invalidate caches and refetch silently
      clearFinanceOverviewCache();
      await fetchLedger({ silent: true });
      return data;
    },
    [fetchLedger]
  );

  /**
   * Void an existing expense transaction via public.void_expense_transaction
   */
  const voidExpense = useCallback(
    async ({ transactionId, reason }) => {
      if (!transactionId) throw new Error('Transaction ID is required.');
      if (!reason || !reason.trim()) throw new Error('A void reason is required.');

      const { data, error: rpcErr } = await supabase.rpc('void_expense_transaction', {
        p_transaction_id: transactionId,
        p_reason: reason.trim(),
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || 'Failed to void expense.');
      }

      // Invalidate caches and refetch silently
      clearFinanceOverviewCache();
      await fetchLedger({ silent: true });
      return data;
    },
    [fetchLedger]
  );

  /**
   * Hard-delete an expense transaction via public.hard_delete_expense_transaction
   */
  const hardDeleteExpense = useCallback(
    async ({ transactionId, reason }) => {
      if (!transactionId) throw new Error('Transaction ID is required.');
      if (!reason || !reason.trim()) throw new Error('A hard-delete reason is required.');

      const { data, error: rpcErr } = await supabase.rpc('hard_delete_expense_transaction', {
        p_transaction_id: transactionId,
        p_reason: reason.trim(),
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || 'Failed to hard-delete expense.');
      }

      // Invalidate caches and refetch silently
      clearFinanceOverviewCache();
      await fetchLedger({ silent: true });
      return data;
    },
    [fetchLedger]
  );

  return {
    transactions,
    tombstones,
    loading,
    refreshing,
    error,
    refetch: fetchLedger,
    fetchTransactionAudit,
    correctExpense,
    voidExpense,
    hardDeleteExpense,
  };
}
