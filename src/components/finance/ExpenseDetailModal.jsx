import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy,
  Check,
  History,
  List,
  Calendar,
  User,
  FolderKanban,
  CheckSquare,
  Trash2,
  Ban,
  Edit3,
  Loader2,
} from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './ExpenseDetailModal.module.css';

/**
 * ExpenseDetailModal
 *
 * Detailed inspection drawer/modal for a single expense transaction.
 * Surfaces line items, attribution, full immutable audit timeline, and action dispatchers.
 */
export default function ExpenseDetailModal({
  isOpen,
  onClose,
  transaction,
  workspaceId,
  canManageBudgets,
  canViewWorkspaceFinance,
  fetchTransactionAudit,
  onOpenCorrect,
  onOpenVoid,
  onOpenHardDelete,
}) {
  const [activeTab, setActiveTab] = useState('items'); // 'items' | 'audit'
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (!isOpen || !transaction?.id) {
      setAuditLogs([]);
      setActiveTab('items');
      return;
    }

    let isMounted = true;
    setLoadingAudit(true);
    fetchTransactionAudit(transaction.id)
      .then((logs) => {
        if (isMounted) setAuditLogs(logs);
      })
      .catch((err) => {
        console.error('Failed to load transaction audit:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingAudit(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, transaction?.id, fetchTransactionAudit]);

  const handleCopyId = () => {
    if (!transaction?.id) return;
    navigator.clipboard?.writeText(transaction.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const totalAmount = useMemo(() => {
    if (!transaction?.expense_items) return 0;
    return transaction.expense_items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }, [transaction]);

  if (!transaction) return null;

  const isVoided = transaction.status === 'voided';
  const isCorrected = transaction.status === 'corrected';

  // Determine Source badge
  const sourceLabel = transaction.subtask_id
    ? 'Subtask'
    : transaction.tasks?.process_step_id || transaction.tasks?.process_instance_id
    ? `Process Step${transaction.cycle_number ? ` (Cycle ${transaction.cycle_number})` : ''}`
    : transaction.tasks?.parent_task_id
    ? 'Child Task'
    : 'Task';

  const sourceBadgeClass = transaction.subtask_id
    ? styles.sourceSubtask
    : transaction.tasks?.process_step_id || transaction.tasks?.process_instance_id
    ? styles.sourceProcess
    : transaction.tasks?.parent_task_id
    ? styles.sourceChild
    : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Expense Transaction Details"
      maxWidth="720px"
    >
      <div className={styles.modalBody}>
        {/* Header Section: ID & Status */}
        <div className={styles.headerRow}>
          <div className={styles.idSection}>
            <span className={styles.idLabel}>Transaction ID:</span>
            <code className={styles.idValue}>{transaction.id}</code>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopyId}
              title="Copy UUID"
              aria-label="Copy Transaction ID"
            >
              {copiedId ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
            </button>
          </div>

          <div className={styles.statusSection}>
            <span
              className={`${styles.statusBadge} ${
                isVoided ? styles.statusVoided : isCorrected ? styles.statusCorrected : styles.statusActive
              }`}
            >
              {transaction.status}
            </span>
            <span className={`${styles.sourceBadge} ${sourceBadgeClass}`}>
              {sourceLabel}
            </span>
          </div>
        </div>

        {/* Core Financial & Attribution Grid */}
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Expense Date</span>
            <span className={styles.metaValue}>
              <Calendar size={14} color="var(--muted)" />
              {transaction.expense_date}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Total Amount</span>
            <span
              className={`${styles.metaValue} ${styles.totalAmountValue} ${
                isVoided ? styles.totalAmountVoided : ''
              }`}
            >
              {formatCurrency(totalAmount)}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Project</span>
            <span className={styles.metaValue}>
              {transaction.tasks?.projects ? (
                <Link
                  to={`/workspace/${workspaceId}/project/${transaction.tasks.projects.id}`}
                  className={styles.projectLink}
                >
                  <span
                    className={styles.projectDot}
                    style={{ background: transaction.tasks.projects.color || 'var(--yellow)' }}
                  />
                  <span>{transaction.tasks.projects.name}</span>
                </Link>
              ) : (
                <span style={{ color: 'var(--muted)' }}>Standalone / Unassigned</span>
              )}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Task / Subtask</span>
            <span className={styles.metaValue}>
              <CheckSquare size={14} color="var(--muted)" />
              <span>
                {transaction.subtasks?.title
                  ? `${transaction.subtasks.title} (${transaction.tasks?.title || 'Parent Task'})`
                  : transaction.tasks?.title || 'Unknown Task'}
              </span>
            </span>
          </div>

          {transaction.tasks?.phases?.name && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Phase</span>
              <span className={styles.metaValue}>
                <FolderKanban size={14} color="var(--muted)" />
                <span>{transaction.tasks.phases.name}</span>
              </span>
            </div>
          )}

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Recorded By</span>
            <span className={styles.metaValue}>
              <User size={14} color="var(--muted)" />
              <span>{transaction.profiles_created_by?.full_name || 'System / Member'}</span>
            </span>
          </div>
        </div>

        {transaction.description && (
          <div className={styles.metaItem} style={{ background: 'var(--panel-soft)', padding: '0.75rem', borderRadius: 'var(--radius-xs)', border: '1px solid var(--line-soft)' }}>
            <span className={styles.metaLabel}>Transaction Description</span>
            <span style={{ color: 'var(--text)', marginTop: '0.25rem' }}>{transaction.description}</span>
          </div>
        )}

        {/* Tab Navigation: Line Items vs Audit History */}
        <div className={styles.tabsContainer}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'items' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('items')}
          >
            <List size={14} />
            <span>Line Items ({transaction.expense_items?.length || 0})</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'audit' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            <History size={14} />
            <span>Audit History ({auditLogs.length})</span>
          </button>
        </div>

        {/* Tab 1: Line Items Table */}
        {activeTab === 'items' && (
          <div className={styles.itemsTableContainer}>
            <table className={styles.itemsTable}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {transaction.expense_items && transaction.expense_items.length > 0 ? (
                  transaction.expense_items.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td style={{ color: 'var(--muted)' }}>{item.line_number || idx + 1}</td>
                      <td>
                        {item.category ? (
                          <span className={styles.categoryTag}>{item.category}</span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td>{item.description || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td className={styles.amountCol}>{formatCurrency(item.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1rem' }}>
                      No line items recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Audit History Timeline */}
        {activeTab === 'audit' && (
          <div className={styles.auditContainer}>
            {loadingAudit ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '0.5rem', color: 'var(--muted)' }}>
                <Loader2 size={16} className="spinning" />
                <span>Loading immutable audit ledger...</span>
              </div>
            ) : auditLogs.length > 0 ? (
              auditLogs.map((log) => {
                const actionClass =
                  log.action === 'created'
                    ? styles.actionCreated
                    : log.action === 'corrected'
                    ? styles.actionCorrected
                    : log.action === 'voided'
                    ? styles.actionVoided
                    : styles.actionHardDeleted;

                return (
                  <div key={log.id} className={styles.auditCard}>
                    <div className={styles.auditHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className={`${styles.auditActionBadge} ${actionClass}`}>
                          {log.action}
                        </span>
                        <span className={styles.auditActor}>
                          by <strong>{log.actor?.full_name || 'System / Admin'}</strong>
                        </span>
                      </div>
                      <span className={styles.auditTimestamp}>
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>

                    {log.reason && (
                      <div className={styles.auditReason}>
                        <strong>Reason:</strong> {log.reason}
                      </div>
                    )}

                    <div className={styles.auditAmounts}>
                      {log.previous_total_amount !== null && (
                        <span>
                          Previous: {formatCurrency(log.previous_total_amount)}
                        </span>
                      )}
                      {log.previous_total_amount !== null && log.new_total_amount !== null && <span>→</span>}
                      {log.new_total_amount !== null && (
                        <span>
                          New: <strong>{formatCurrency(log.new_total_amount)}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className={styles.auditEmpty}>
                No audit entries recorded for this transaction.
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className={styles.actionsFooter}>
          <div className={styles.leftActions}>
            {canManageBudgets && (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={() => {
                  onClose();
                  onOpenHardDelete(transaction);
                }}
                title="Permanently remove transaction and retain tombstone (Admin/Executive only)"
              >
                <Trash2 size={14} />
                <span>Hard Delete</span>
              </button>
            )}
          </div>

          <div className={styles.rightActions}>
            {canViewWorkspaceFinance && !isVoided && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  onClose();
                  onOpenVoid(transaction);
                }}
                title="Mark transaction voided (₹0 spend contribution)"
              >
                <Ban size={14} />
                <span>Void Expense</span>
              </button>
            )}

            {canViewWorkspaceFinance && !isVoided && (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => {
                  onClose();
                  onOpenCorrect(transaction);
                }}
                title="Revise line items and amounts with mandatory audit reason"
              >
                <Edit3 size={14} />
                <span>Correct Expense</span>
              </button>
            )}

            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
