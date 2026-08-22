import { useState } from 'react';
import { Copy, Check, Calendar, FileText, ShieldAlert } from 'lucide-react';
import Modal from '../Modal.jsx';
import { formatCurrency } from '../../lib/expenseExecution.js';
import styles from './ExpenseDetailModal.module.css';

/**
 * TombstoneDetailModal
 *
 * Read-only modal displaying permanent snapshot evidence for a hard-deleted expense transaction.
 */
export default function TombstoneDetailModal({
  isOpen,
  onClose,
  tombstone,
}) {
  const [copiedId, setCopiedId] = useState(false);

  if (!tombstone) return null;

  const snapshot = tombstone.metadata?.snapshot || {};
  const tx = snapshot.transaction || {};
  const items = snapshot.items || [];
  const origId = tombstone.original_transaction_id || tx.id;

  const handleCopyId = () => {
    if (!origId) return;
    navigator.clipboard?.writeText(origId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Audit Tombstone Snapshot Evidence"
      maxWidth="680px"
    >
      <div className={styles.modalBody}>
        {/* Banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: 'var(--radius-xs)',
          fontSize: '0.8125rem',
          color: 'var(--text)',
        }}>
          <ShieldAlert size={20} color="var(--red)" style={{ flexShrink: 0 }} />
          <div>
            <strong>Permanent Audit Tombstone:</strong> This record provides immutable evidence of an expense transaction that was permanently hard-deleted by an authorized administrator.
          </div>
        </div>

        {/* Transaction ID & Status */}
        <div className={styles.headerRow} style={{ marginTop: '0.75rem' }}>
          <div className={styles.idSection}>
            <span className={styles.idLabel}>Original ID:</span>
            <code className={styles.idValue}>{origId}</code>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopyId}
              title="Copy UUID"
              aria-label="Copy Original Transaction ID"
            >
              {copiedId ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
            </button>
          </div>

          <div className={styles.statusSection}>
            <span className={`${styles.statusBadge} ${styles.statusVoided}`}>
              Hard Deleted
            </span>
          </div>
        </div>

        {/* Core Attribution Grid */}
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Original Expense Date</span>
            <span className={styles.metaValue}>
              <Calendar size={14} color="var(--muted)" />
              {tx.expense_date || '—'}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Previous Total Amount</span>
            <span className={`${styles.metaValue} ${styles.totalAmountValue}`} style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>
              {formatCurrency(tombstone.previous_total_amount)}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Task ID</span>
            <span className={styles.metaValue}>
              <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {tx.task_id || tombstone.metadata?.task_id || '—'}
              </code>
            </span>
          </div>

          {(tx.subtask_id || tombstone.subtask_id) && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Subtask ID</span>
              <span className={styles.metaValue}>
                <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {tx.subtask_id || tombstone.subtask_id}
                </code>
              </span>
            </div>
          )}

          {tx.cycle_number && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Process Cycle</span>
              <span className={styles.metaValue}>Cycle {tx.cycle_number}</span>
            </div>
          )}

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Deleted By</span>
            <span className={styles.metaValue}>
              {tombstone.actor?.full_name || 'Administrator'}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Deleted At</span>
            <span className={styles.metaValue} style={{ fontSize: '0.75rem' }}>
              {new Date(tombstone.created_at).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Mandatory Reason */}
        <div className={styles.descriptionBox}>
          <span className={styles.descriptionLabel}>Mandatory Hard-Delete Reason</span>
          <p className={styles.descriptionText} style={{ color: 'var(--text)' }}>
            {tombstone.reason || '—'}
          </p>
        </div>

        {/* Historical Description if existed */}
        {tx.description && (
          <div className={styles.descriptionBox}>
            <span className={styles.descriptionLabel}>Historical Note / Description</span>
            <p className={styles.descriptionText}>{tx.description}</p>
          </div>
        )}

        {/* Snapshot Items Table */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <FileText size={14} color="var(--muted)" />
            <span>Preserved Line Items ({items.length})</span>
          </div>

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
                {items.length > 0 ? (
                  items.map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td style={{ color: 'var(--muted)' }}>{it.line_number || idx + 1}</td>
                      <td>
                        {it.category ? (
                          <span className={styles.categoryTag}>{it.category}</span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td>{it.description || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td className={styles.amountCol} style={{ textDecoration: 'line-through' }}>
                        {formatCurrency(it.amount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1rem' }}>
                      No line items recorded in snapshot.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Close Button */}
        <div className={styles.modalActions} style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            style={{ width: '100%' }}
          >
            Close Snapshot
          </button>
        </div>
      </div>
    </Modal>
  );
}
