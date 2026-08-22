import { useState, useEffect, useMemo, useCallback } from 'react';
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
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './ExpenseDetailModal.module.css';

/**
 * ExpenseDetailModal
 *
 * Detailed transaction inspection drawer / modal showing metadata, line items,
 * and immutable audit history.
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
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [copiedId, setCopiedId] = useState(false);

  const loadAudit = useCallback(async () => {
    if (!transaction?.id || !fetchTransactionAudit) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const logs = await fetchTransactionAudit(transaction.id);
      setAuditLogs(logs);
    } catch (err) {
      console.error('[ExpenseDetailModal] loadAudit error:', err);
      setAuditError(err.message || 'Failed to load transaction audit history.');
    } finally {
      setAuditLoading(false);
    }
  }, [transaction?.id, fetchTransactionAudit]);

  // Load audit history when modal opens or transaction shifts
  useEffect(() => {
    if (!isOpen || !transaction?.id) {
      setAuditLogs([]);
      setAuditLoading(false);
      setAuditError(null);
      setActiveTab('items');
      return;
    }

    loadAudit();
  }, [isOpen, transaction?.id, loadAudit]);

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
            <span className={styles.metaLabel}>Operational Task</span>
            <span className={styles.metaValue}>
              <CheckSquare size={14} color="var(--muted)" />
              <span title={transaction.tasks?.title || ''}>
                {transaction.tasks?.title || 'Unknown Task'}
              </span>
            </span>
          </div>

          {transaction.subtasks && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Subtask Context</span>
              <span className={styles.metaValue}>
                <span>{transaction.subtasks.title}</span>
              </span>
            </div>
          )}

          {transaction.tasks?.phases && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Phase</span>
              <span className={styles.metaValue}>
                <FolderKanban size={14} color="var(--muted)" />
                <span>{transaction.tasks.phases.name}</span>
              </span>
            </div>
          )}

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Created By</span>
            <span className={styles.metaValue}>
              <User size={14} color="var(--muted)" />
              <span>{transaction.profiles_created_by?.full_name || 'System / Member'}</span>
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Created At</span>
            <span className={styles.metaValue} style={{ fontSize: '0.75rem' }}>
              {new Date(transaction.created_at).toLocaleString()}
            </span>
          </div>

          {transaction.updated_at && transaction.updated_at !== transaction.created_at && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Last Modified</span>
              <span className={styles.metaValue} style={{ fontSize: '0.75rem' }}>
                {new Date(transaction.updated_at).toLocaleString()}
                {transaction.profiles_updated_by && ` (${transaction.profiles_updated_by.full_name})`}
              </span>
            </div>
          )}
        </div>

        {/* Transaction Description */}
        {transaction.description && (
          <div className={styles.descriptionBox}>
            <span className={styles.descriptionLabel}>Transaction Description</span>
            <p className={styles.descriptionText}>{transaction.description}</p>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className={styles.tabNav}>
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
            <span>Audit History {auditLogs.length > 0 && `(${auditLogs.length})`}</span>
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
            {auditLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '0.5rem', color: 'var(--muted)' }}>
                <Loader2 size={16} className="spinning" />
                <span>Loading immutable audit ledger...</span>
              </div>
            ) : auditError ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', gap: '0.75rem', textAlign: 'center' }}>
                <AlertTriangle size={24} color="var(--red)" />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>Audit History Unavailable</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{auditError}</div>
                </div>
                <button
                  type="button"
                  onClick={loadAudit}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.8125rem',
                    background: 'var(--panel-strong)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={13} />
                  <span>Retry</span>
                </button>
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

                    {/* Previous Status -> New Status */}
                    {(log.previous_status || log.new_status) && (
                      <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginTop: '0.375rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <span>Status:</span>
                        {log.previous_status && (
                          <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{log.previous_status}</span>
                        )}
                        {log.previous_status && log.new_status && <span>→</span>}
                        {log.new_status && (
                          <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--text)' }}>
                            {log.new_status}
                          </span>
                        )}
                      </div>
                    )}

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
                className={styles.btnVoid}
                onClick={() => {
                  onClose();
                  onOpenVoid(transaction);
                }}
                title="Void this transaction (sets effective contribution to ₹0.00)"
              >
                <Ban size={14} />
                <span>Void Expense</span>
              </button>
            )}

            {canViewWorkspaceFinance && !isVoided && (
              <button
                type="button"
                className={styles.btnCorrect}
                onClick={() => {
                  onClose();
                  onOpenCorrect(transaction);
                }}
                title="Correct line items, date, or description"
              >
                <Edit3 size={14} />
                <span>Correct Expense</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
