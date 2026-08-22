import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Receipt,
  Search,
  RefreshCw,
  Sliders,
  ShieldAlert,
  AlertTriangle,
  Edit3,
  Ban,
  Eye,
  History,
  FileText,
} from 'lucide-react';
import { useFinanceAccess } from '../hooks/useFinanceAccess.js';
import { useExpenseLedger } from '../hooks/useExpenseLedger.js';
import { useProjects } from '../hooks/useProjects.js';
import { useToast } from '../components/Toast.jsx';
import { formatCurrency } from '../lib/expenseExecution.js';
import PageHeader from '../components/PageHeader.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { MetricCardsSkeleton, Skeleton } from '../components/Skeleton.jsx';
import ExpenseDetailModal from '../components/finance/ExpenseDetailModal.jsx';
import ExpenseCorrectionModal from '../components/finance/ExpenseCorrectionModal.jsx';
import ExpenseVoidModal from '../components/finance/ExpenseVoidModal.jsx';
import ExpenseHardDeleteModal from '../components/finance/ExpenseHardDeleteModal.jsx';
import TombstoneDetailModal from '../components/finance/TombstoneDetailModal.jsx';
import styles from './ExpenseLedgerPage.module.css';

function ExpenseLedgerSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
      <MetricCardsSkeleton count={3} />
      <Skeleton height="56px" radius="var(--radius-xs)" />
      <Skeleton height="320px" radius="var(--radius-xs)" />
    </div>
  );
}

export default function ExpenseLedgerPage() {
  const { workspaceId } = useParams();
  const { showToast } = useToast();

  const financeAccess = useFinanceAccess(workspaceId);
  const {
    canViewWorkspaceFinance,
    canManageBudgets,
    isFinanceOperator,
    financeAccessLoading,
    financeAccessError,
    authorizationScopeKey,
  } = financeAccess;

  const { projects = [] } = useProjects(workspaceId, authorizationScopeKey);

  const {
    transactions,
    tombstones,
    loading: ledgerLoading,
    refreshing,
    error: ledgerError,
    refetch,
    fetchTransactionAudit,
    correctExpense,
    voidExpense,
    hardDeleteExpense,
  } = useExpenseLedger(workspaceId, authorizationScopeKey, {
    enabled: canViewWorkspaceFinance && !financeAccessError,
  });

  // Local Filter & UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeView, setActiveView] = useState('ledger'); // 'ledger' | 'tombstones'

  // Modals state
  const [selectedTxForDetail, setSelectedTxForDetail] = useState(null);
  const [selectedTxForCorrect, setSelectedTxForCorrect] = useState(null);
  const [selectedTxForVoid, setSelectedTxForVoid] = useState(null);
  const [selectedTxForHardDelete, setSelectedTxForHardDelete] = useState(null);
  const [selectedTombstoneForDetail, setSelectedTombstoneForDetail] = useState(null);

  // Clear local state on workspace switch
  useEffect(() => {
    setSearchQuery('');
    setSelectedProject('all');
    setSelectedStatus('all');
    setDateFrom('');
    setDateTo('');
    setActiveView('ledger');
    setSelectedTxForDetail(null);
    setSelectedTxForCorrect(null);
    setSelectedTxForVoid(null);
    setSelectedTxForHardDelete(null);
    setSelectedTombstoneForDetail(null);
  }, [workspaceId]);

  // Keep detail modal transaction in sync when transactions update
  useEffect(() => {
    if (selectedTxForDetail) {
      const updated = transactions.find((t) => t.id === selectedTxForDetail.id);
      if (updated) {
        setSelectedTxForDetail(updated);
      }
    }
  }, [transactions, selectedTxForDetail]);

  // Client-side filtering across transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // 1. Project filter
      if (selectedProject !== 'all') {
        const txProjectId = tx.tasks?.project_id || tx.tasks?.projects?.id;
        if (txProjectId !== selectedProject) return false;
      }

      // 2. Status filter
      if (selectedStatus !== 'all') {
        if (tx.status !== selectedStatus) return false;
      }

      // 3. Date range filter
      if (dateFrom && tx.expense_date < dateFrom) return false;
      if (dateTo && tx.expense_date > dateTo) return false;

      // 4. Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const taskTitle = (tx.tasks?.title || '').toLowerCase();
        const subtaskTitle = (tx.subtasks?.title || '').toLowerCase();
        const projectName = (tx.tasks?.projects?.name || '').toLowerCase();
        const txDesc = (tx.description || '').toLowerCase();
        const itemMatches = (tx.expense_items || []).some(
          (it) =>
            (it.category || '').toLowerCase().includes(q) ||
            (it.description || '').toLowerCase().includes(q)
        );

        if (
          !taskTitle.includes(q) &&
          !subtaskTitle.includes(q) &&
          !projectName.includes(q) &&
          !txDesc.includes(q) &&
          !itemMatches
        ) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, selectedProject, selectedStatus, dateFrom, dateTo, searchQuery]);

  // Client-side filtering across tombstones
  const filteredTombstones = useMemo(() => {
    return tombstones.filter((tb) => {
      if (dateFrom && tb.created_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && tb.created_at.slice(0, 10) > dateTo) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const reason = (tb.reason || '').toLowerCase();
        const actorName = (tb.actor?.full_name || '').toLowerCase();
        const origId = (tb.original_transaction_id || '').toLowerCase();
        if (!reason.includes(q) && !actorName.includes(q) && !origId.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [tombstones, dateFrom, dateTo, searchQuery]);

  // Presentation stats
  const stats = useMemo(() => {
    let totalActiveSpend = 0;
    let activeCount = 0;
    let correctedCount = 0;
    let voidedCount = 0;

    for (const tx of filteredTransactions) {
      const itemsSum = (tx.expense_items || []).reduce(
        (sum, it) => sum + (Number(it.amount) || 0),
        0
      );
      if (tx.status === 'active') {
        activeCount++;
        totalActiveSpend += itemsSum;
      } else if (tx.status === 'corrected') {
        correctedCount++;
        totalActiveSpend += itemsSum;
      } else if (tx.status === 'voided') {
        voidedCount++;
      }
    }

    return {
      totalActiveSpend,
      activeCount,
      correctedCount,
      voidedCount,
      totalCount: filteredTransactions.length,
    };
  }, [filteredTransactions]);

  // Handlers for RPC mutations
  const handleCorrectExpense = async (payload) => {
    try {
      await correctExpense(payload);
      showToast('Expense transaction corrected successfully.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to correct expense.', 'error');
      throw err;
    }
  };

  const handleVoidExpense = async (payload) => {
    try {
      await voidExpense(payload);
      showToast('Expense transaction voided successfully.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to void expense.', 'error');
      throw err;
    }
  };

  const handleHardDeleteExpense = async (payload) => {
    try {
      await hardDeleteExpense(payload);
      showToast('Expense permanently hard-deleted and tombstone recorded.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to hard-delete expense.', 'error');
      throw err;
    }
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedProject !== 'all' ||
    selectedStatus !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '';

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedProject('all');
    setSelectedStatus('all');
    setDateFrom('');
    setDateTo('');
  };

  // 1. Loading State (Cold Load / Access Resolution)
  if (financeAccessLoading || (ledgerLoading && transactions.length === 0 && !ledgerError)) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Expense Ledger"
          subtitle="Detailed financial transactions & audit ledger"
        />
        <ExpenseLedgerSkeleton />
      </div>
    );
  }

  // 2. Authorization Error (Fail-Closed)
  if (financeAccessError) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Expense Ledger"
          subtitle="Detailed financial transactions & audit ledger"
        />
        <EmptyState
          icon={ShieldAlert}
          title="Authorization Context Error"
          description="Failed to resolve your workspace financial authorization. Access is restricted."
        />
      </div>
    );
  }

  // 3. Unauthorized / Access Restricted (Fail-Closed)
  if (!canViewWorkspaceFinance) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Expense Ledger"
          subtitle="Detailed financial transactions & audit ledger"
        />
        <EmptyState
          icon={ShieldAlert}
          title="Access Restricted"
          description="You do not have authorization to view the Workspace Expense Ledger. Access is restricted to active Workspace Owners, Workspace Admins, Executives, and Finance Operators."
        />
      </div>
    );
  }

  // 4. Error State with Retry
  if (ledgerError && transactions.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Expense Ledger"
          subtitle="Detailed financial transactions & audit ledger"
        />
        <div className={styles.errorContainer} role="alert">
          <AlertTriangle size={32} className={styles.errorIcon} />
          <div className={styles.errorTitle}>Failed to Load Expense Ledger</div>
          <div className={styles.errorDesc}>{ledgerError}</div>
          <button type="button" className={styles.retryBtn} onClick={() => refetch()}>
            <RefreshCw size={14} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  const headerBadge = canManageBudgets ? (
    <RoleBadge role="owner" customLabel="Budget Manager" size="sm" />
  ) : isFinanceOperator ? (
    <RoleBadge role="head" customLabel="Finance Operator" size="sm" />
  ) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Expense Ledger"
        subtitle="Detailed financial transactions & audit ledger"
        badge={headerBadge}
        actions={
          <div className={styles.headerActions}>
            <Link
              to={`/workspace/${workspaceId}/finance`}
              className={styles.overviewLinkBtn}
              aria-label="Back to Finance Overview"
            >
              <Sliders size={14} />
              <span>Finance Overview</span>
            </Link>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => refetch()}
              disabled={refreshing}
              aria-label="Refresh expense ledger"
            >
              <RefreshCw size={14} className={refreshing ? styles.spinning : ''} />
              <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
            </button>
          </div>
        }
      />

      {/* Filter & View Toolbar */}
      <div className={styles.toolbarContainer}>
        <div className={styles.topFilterRow}>
          <div className={styles.searchBox}>
            <Search size={16} color="var(--muted)" />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by task, subtask, project, category, description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className={styles.viewModeTabs}>
            <button
              type="button"
              className={`${styles.viewTabBtn} ${activeView === 'ledger' ? styles.viewTabActive : ''}`}
              onClick={() => setActiveView('ledger')}
            >
              <Receipt size={13} />
              <span>Active Ledger ({transactions.length})</span>
            </button>
            <button
              type="button"
              className={`${styles.viewTabBtn} ${activeView === 'tombstones' ? styles.viewTabActive : ''}`}
              onClick={() => setActiveView('tombstones')}
            >
              <History size={13} />
              <span>Audit Tombstones ({tombstones.length})</span>
            </button>
          </div>
        </div>

        {activeView === 'ledger' && (
          <div className={styles.bottomFilterRow}>
            {/* Project Filter */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Project:</span>
              <select
                className={styles.filterSelect}
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Status:</span>
              <select
                className={styles.filterSelect}
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="corrected">Corrected</option>
                <option value="voided">Voided</option>
              </select>
            </div>

            {/* Date From */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>From:</span>
              <input
                type="date"
                className={styles.filterInput}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            {/* Date To */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>To:</span>
              <input
                type="date"
                className={styles.filterInput}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className={styles.clearFiltersBtn}
                onClick={handleClearFilters}
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Active Ledger View */}
      {activeView === 'ledger' && (
        <>
          {/* Summary Stats Bar */}
          <div className={styles.summaryStatsBar}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Transactions:</span>
              <span className={styles.statValue}>{stats.totalCount}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Effective Net Spend:</span>
              <span className={styles.statValue} style={{ color: 'var(--yellow)' }}>
                {formatCurrency(stats.totalActiveSpend)}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Active:</span>
              <span className={styles.statValue} style={{ color: 'var(--green)' }}>
                {stats.activeCount}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Corrected:</span>
              <span className={styles.statValue} style={{ color: 'var(--yellow)' }}>
                {stats.correctedCount}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Voided:</span>
              <span className={styles.statValue} style={{ color: 'var(--red)' }}>
                {stats.voidedCount}
              </span>
            </div>
          </div>

          {/* Transactions Desktop Table */}
          {filteredTransactions.length > 0 ? (
            <>
              <div className={styles.tableContainer}>
                <table className={styles.ledgerTable}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Project</th>
                      <th>Task</th>
                      <th>Source</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th>Created By</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((tx) => {
                      const totalAmt = (tx.expense_items || []).reduce(
                        (sum, it) => sum + (Number(it.amount) || 0),
                        0
                      );
                      const isVoided = tx.status === 'voided';
                      const isCorrected = tx.status === 'corrected';

                      const sourceLabel = tx.subtask_id
                        ? 'Subtask'
                        : tx.tasks?.process_step_id || tx.tasks?.process_instance_id
                        ? `Process Step${tx.cycle_number ? ` (C${tx.cycle_number})` : ''}`
                        : tx.tasks?.parent_task_id
                        ? 'Child Task'
                        : 'Task';

                      const sourceClass = tx.subtask_id
                        ? styles.sourceSubtask
                        : tx.tasks?.process_step_id || tx.tasks?.process_instance_id
                        ? styles.sourceProcess
                        : tx.tasks?.parent_task_id
                        ? styles.sourceChild
                        : '';

                      return (
                        <tr
                          key={tx.id}
                          className={styles.ledgerRow}
                          onClick={() => setSelectedTxForDetail(tx)}
                        >
                          <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {tx.expense_date}
                          </td>
                          <td>
                            <div className={styles.projectCell}>
                              <span
                                className={styles.projectDot}
                                style={{
                                  background: tx.tasks?.projects?.color || 'var(--yellow)',
                                }}
                              />
                              <span>{tx.tasks?.projects?.name || 'Standalone'}</span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.taskTitle} title={tx.tasks?.title || ''}>
                              {tx.subtasks?.title
                                ? `${tx.subtasks.title} (${tx.tasks?.title})`
                                : tx.tasks?.title || 'Unknown Task'}
                            </div>
                          </td>
                          <td>
                            <span className={`${styles.sourceBadge} ${sourceClass}`}>
                              {sourceLabel}
                            </span>
                          </td>
                          <td>
                            <div
                              className={styles.descriptionCell}
                              title={tx.description || ''}
                            >
                              {tx.description ||
                                tx.expense_items?.[0]?.description ||
                                tx.expense_items?.[0]?.category ||
                                '—'}
                            </div>
                          </td>
                          <td
                            className={`${styles.amountCell} ${
                              isVoided ? styles.amountVoided : ''
                            }`}
                            style={{ textAlign: 'right' }}
                          >
                            {formatCurrency(totalAmt)}
                          </td>
                          <td>
                            <span
                              className={`${styles.statusBadge} ${
                                isVoided
                                  ? styles.statusVoided
                                  : isCorrected
                                  ? styles.statusCorrected
                                  : styles.statusActive
                              }`}
                            >
                              {tx.status}
                            </span>
                          </td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                            {tx.profiles_created_by?.full_name || 'System / Member'}
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.rowActions} style={{ justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className={styles.actionIconBtn}
                                onClick={() => setSelectedTxForDetail(tx)}
                                title="View Details"
                              >
                                <Eye size={13} />
                              </button>

                              {!isVoided && (
                                <button
                                  type="button"
                                  className={styles.actionIconBtn}
                                  onClick={() => setSelectedTxForCorrect(tx)}
                                  title="Correct Expense"
                                >
                                  <Edit3 size={13} />
                                </button>
                              )}

                              {!isVoided && (
                                <button
                                  type="button"
                                  className={styles.actionIconBtn}
                                  onClick={() => setSelectedTxForVoid(tx)}
                                  title="Void Expense"
                                >
                                  <Ban size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Card View */}
              <div className={styles.mobileCardsContainer}>
                {filteredTransactions.map((tx) => {
                  const totalAmt = (tx.expense_items || []).reduce(
                    (sum, it) => sum + (Number(it.amount) || 0),
                    0
                  );
                  const isVoided = tx.status === 'voided';
                  const isCorrected = tx.status === 'corrected';

                  return (
                    <div
                      key={tx.id}
                      className={styles.mobileCard}
                      onClick={() => setSelectedTxForDetail(tx)}
                    >
                      <div className={styles.mobileCardHeader}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            {tx.expense_date} · {tx.tasks?.projects?.name || 'Standalone'}
                          </div>
                          <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>
                            {tx.tasks?.title || 'Unknown Task'}
                          </div>
                        </div>
                        <span
                          className={`${styles.statusBadge} ${
                            isVoided
                              ? styles.statusVoided
                              : isCorrected
                              ? styles.statusCorrected
                              : styles.statusActive
                          }`}
                        >
                          {tx.status}
                        </span>
                      </div>

                      <div className={styles.mobileCardBody}>
                        {tx.description && (
                          <div style={{ color: 'var(--muted)' }}>{tx.description}</div>
                        )}
                        <div
                          style={{
                            fontSize: '1rem',
                            fontWeight: 700,
                            color: isVoided ? 'var(--muted)' : 'var(--text)',
                            textDecoration: isVoided ? 'line-through' : 'none',
                          }}
                        >
                          {formatCurrency(totalAmt)}
                        </div>
                      </div>

                      <div className={styles.mobileCardFooter}>
                        <span>By {tx.profiles_created_by?.full_name || 'Member'}</span>
                        <span>{tx.expense_items?.length || 0} line item(s)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState
              icon={Receipt}
              title={hasActiveFilters ? 'No Matching Expenses' : 'No Expense Records'}
              description={
                hasActiveFilters
                  ? 'No expense transactions match your active filters.'
                  : 'No expense transactions have been recorded in this workspace yet.'
              }
              actionLabel={hasActiveFilters ? 'Clear Filters' : undefined}
              onAction={hasActiveFilters ? handleClearFilters : undefined}
            />
          )}
        </>
      )}

      {/* Audit Tombstones View */}
      {activeView === 'tombstones' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className={styles.tombstoneNotice}>
            <History size={18} color="var(--red)" style={{ flexShrink: 0 }} />
            <div>
              <strong>Immutable Hard-Deleted Audit Ledger:</strong> These records preserve historical snapshot evidence for transactions that were permanently hard-deleted by workspace administrators.
            </div>
          </div>

          {filteredTombstones.length > 0 ? (
            <div className={styles.tableContainer}>
              <table className={styles.ledgerTable}>
                <thead>
                  <tr>
                    <th>Deleted At</th>
                    <th>Original Transaction ID</th>
                    <th>Previous Total</th>
                    <th>Deleted By</th>
                    <th>Mandatory Reason</th>
                    <th style={{ textAlign: 'right' }}>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTombstones.map((tb) => (
                    <tr key={tb.id} className={styles.ledgerRow} onClick={() => setSelectedTombstoneForDetail(tb)}>
                      <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(tb.created_at).toLocaleString()}
                      </td>
                      <td>
                        <code style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                          {tb.original_transaction_id}
                        </code>
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--muted)', textDecoration: 'line-through' }}>
                        {formatCurrency(tb.previous_total_amount)}
                      </td>
                      <td>{tb.actor?.full_name || 'Admin / Executive'}</td>
                      <td style={{ color: 'var(--text)' }}>{tb.reason || '—'}</td>
                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.actionIconBtn}
                          onClick={() => setSelectedTombstoneForDetail(tb)}
                          title="Inspect Hard-Delete Snapshot Evidence"
                        >
                          <FileText size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={History}
              title="No Audit Tombstones"
              description="No hard-deleted expense tombstones have been recorded in this workspace."
            />
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedTxForDetail && (
        <ExpenseDetailModal
          isOpen={Boolean(selectedTxForDetail)}
          onClose={() => setSelectedTxForDetail(null)}
          transaction={selectedTxForDetail}
          workspaceId={workspaceId}
          canManageBudgets={canManageBudgets}
          canViewWorkspaceFinance={canViewWorkspaceFinance}
          fetchTransactionAudit={fetchTransactionAudit}
          onOpenCorrect={(tx) => setSelectedTxForCorrect(tx)}
          onOpenVoid={(tx) => setSelectedTxForVoid(tx)}
          onOpenHardDelete={(tx) => setSelectedTxForHardDelete(tx)}
        />
      )}

      {/* Correction Modal */}
      {selectedTxForCorrect && (
        <ExpenseCorrectionModal
          isOpen={Boolean(selectedTxForCorrect)}
          onClose={() => setSelectedTxForCorrect(null)}
          transaction={selectedTxForCorrect}
          onSave={handleCorrectExpense}
        />
      )}

      {/* Void Modal */}
      {selectedTxForVoid && (
        <ExpenseVoidModal
          isOpen={Boolean(selectedTxForVoid)}
          onClose={() => setSelectedTxForVoid(null)}
          transaction={selectedTxForVoid}
          onVoid={handleVoidExpense}
        />
      )}

      {/* Hard Delete Modal */}
      {selectedTxForHardDelete && (
        <ExpenseHardDeleteModal
          isOpen={Boolean(selectedTxForHardDelete)}
          onClose={() => setSelectedTxForHardDelete(null)}
          transaction={selectedTxForHardDelete}
          onHardDelete={handleHardDeleteExpense}
        />
      )}

      {/* Tombstone Snapshot Evidence Modal */}
      {selectedTombstoneForDetail && (
        <TombstoneDetailModal
          isOpen={Boolean(selectedTombstoneForDetail)}
          onClose={() => setSelectedTombstoneForDetail(null)}
          tombstone={selectedTombstoneForDetail}
        />
      )}
    </div>
  );
}
