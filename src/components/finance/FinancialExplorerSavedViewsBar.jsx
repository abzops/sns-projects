import React, { useState } from 'react';
import {
  Bookmark,
  Save,
  Edit2,
  Trash2,
  AlertCircle,
  RefreshCw,
  X,
  Check,
} from 'lucide-react';
import styles from './FinancialExplorerSavedViewsBar.module.css';

export default function FinancialExplorerSavedViewsBar({
  savedViews = [],
  loading = false,
  error = null,
  actionError = null,
  activeSavedViewId = null,
  isDirty = false,
  isSaving = false,
  onSelectView,
  onSaveCurrentView,
  onUpdateCurrentView,
  onRenameView,
  onDeleteView,
  onRetryFetch,
}) {
  const [modalMode, setModalMode] = useState(null); // 'save' | 'rename' | 'delete' | null
  const [viewNameInput, setViewNameInput] = useState('');
  const [modalError, setModalError] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  const activeView = savedViews.find((v) => v.id === activeSavedViewId) || null;

  const handleSelect = (val) => {
    setUpdateError(null);
    onSelectView(val);
  };

  const handleOpenSaveModal = () => {
    setViewNameInput('');
    setModalError(null);
    setUpdateError(null);
    setModalMode('save');
  };

  const handleOpenRenameModal = () => {
    if (!activeView) return;
    setViewNameInput(activeView.name);
    setModalError(null);
    setUpdateError(null);
    setModalMode('rename');
  };

  const handleOpenDeleteModal = () => {
    if (!activeView) return;
    setModalError(null);
    setUpdateError(null);
    setModalMode('delete');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setViewNameInput('');
    setModalError(null);
  };

  const handleUpdateClick = async () => {
    if (!activeSavedViewId || !isDirty) return;
    setUpdateError(null);
    try {
      await onUpdateCurrentView(activeSavedViewId);
    } catch (err) {
      setUpdateError(err?.message || 'Failed to update view');
    }
  };

  const handleSaveSubmit = async (e) => {
    e.preventDefault();
    const trimmed = viewNameInput.trim();
    if (!trimmed) {
      setModalError('View name is required');
      return;
    }
    try {
      await onSaveCurrentView(trimmed);
      handleCloseModal();
    } catch (err) {
      setModalError(err.message || 'Failed to save view');
    }
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    const trimmed = viewNameInput.trim();
    if (!trimmed) {
      setModalError('View name is required');
      return;
    }
    if (trimmed === activeView?.name) {
      handleCloseModal();
      return;
    }
    try {
      await onRenameView(activeSavedViewId, trimmed);
      handleCloseModal();
    } catch (err) {
      setModalError(err.message || 'Failed to rename view');
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      await onDeleteView(activeSavedViewId);
      handleCloseModal();
    } catch (err) {
      setModalError(err.message || 'Failed to delete view');
    }
  };

  const displayedActionError = updateError || actionError;

  return (
    <div className={styles.container}>
      <div className={styles.leftGroup}>
        <Bookmark size={16} className={styles.icon} />
        <span className={styles.label}>Saved Views:</span>

        {loading ? (
          <select className={styles.viewSelect} disabled aria-label="Saved Views">
            <option>Loading saved views...</option>
          </select>
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <select className={styles.viewSelect} disabled aria-label="Saved Views">
              <option>Failed to load saved views</option>
            </select>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setUpdateError(null);
                onRetryFetch();
              }}
              title="Retry loading saved views"
              aria-label="Retry loading saved views"
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <select
            className={styles.viewSelect}
            value={activeSavedViewId || ''}
            onChange={(e) => handleSelect(e.target.value || null)}
            aria-label="Select a Saved View"
          >
            <option value="">
              {savedViews.length === 0 ? 'No Saved Views' : 'Custom / Unsaved View'}
            </option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        )}

        {activeSavedViewId && isDirty && (
          <span className={styles.dirtyBadge} title="Current configuration differs from the saved view">
            Unsaved changes
          </span>
        )}
      </div>

      <div className={styles.btnGroup}>
        <button
          type="button"
          className={`${styles.btn} ${!activeSavedViewId ? styles.btnPrimary : ''}`}
          onClick={handleOpenSaveModal}
          disabled={loading || isSaving}
          title="Save current filters, grouping and sorting as a new view"
        >
          <Save size={13} />
          <span>Save View</span>
        </button>

        {activeSavedViewId && (
          <>
            <button
              type="button"
              className={`${styles.btn} ${isDirty ? styles.btnPrimary : ''}`}
              onClick={handleUpdateClick}
              disabled={loading || isSaving || !isDirty}
              title={isDirty ? 'Update saved view with current configuration' : 'No unsaved changes'}
            >
              <Check size={13} />
              <span>Update</span>
            </button>

            <button
              type="button"
              className={styles.btn}
              onClick={handleOpenRenameModal}
              disabled={loading || isSaving}
              title="Rename active saved view"
            >
              <Edit2 size={13} />
              <span>Rename</span>
            </button>

            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={handleOpenDeleteModal}
              disabled={loading || isSaving}
              title="Delete active saved view"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          </>
        )}
      </div>

      {displayedActionError && (
        <div className={styles.errorMessage} role="alert">
          <AlertCircle size={13} />
          <span>Action failed: {displayedActionError}</span>
        </div>
      )}

      {/* Save View Modal */}
      {modalMode === 'save' && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div id="save-modal-title" className={styles.modalTitle}>Save Current View</div>
              <button
                type="button"
                className={styles.btn}
                onClick={handleCloseModal}
                disabled={isSaving}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleSaveSubmit}>
              <div className={styles.modalBody}>
                <label htmlFor="save-view-name-input" style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
                  View Name (max 100 characters):
                </label>
                <input
                  id="save-view-name-input"
                  type="text"
                  className={styles.modalInput}
                  value={viewNameInput}
                  onChange={(e) => setViewNameInput(e.target.value)}
                  placeholder="e.g. Q3 Active Over-Budget Projects"
                  maxLength={100}
                  autoFocus
                  disabled={isSaving}
                />
                {modalError && (
                  <div className={styles.modalError}>
                    <AlertCircle size={14} />
                    <span>{modalError}</span>
                  </div>
                )}
              </div>
              <div className={styles.modalFooter} style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleCloseModal}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={isSaving || !viewNameInput.trim()}
                >
                  {isSaving ? 'Saving...' : 'Save View'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename View Modal */}
      {modalMode === 'rename' && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="rename-modal-title">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div id="rename-modal-title" className={styles.modalTitle}>Rename Saved View</div>
              <button
                type="button"
                className={styles.btn}
                onClick={handleCloseModal}
                disabled={isSaving}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleRenameSubmit}>
              <div className={styles.modalBody}>
                <label htmlFor="rename-view-name-input" style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
                  New View Name:
                </label>
                <input
                  id="rename-view-name-input"
                  type="text"
                  className={styles.modalInput}
                  value={viewNameInput}
                  onChange={(e) => setViewNameInput(e.target.value)}
                  maxLength={100}
                  autoFocus
                  disabled={isSaving}
                />
                {modalError && (
                  <div className={styles.modalError}>
                    <AlertCircle size={14} />
                    <span>{modalError}</span>
                  </div>
                )}
              </div>
              <div className={styles.modalFooter} style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleCloseModal}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={isSaving || !viewNameInput.trim()}
                >
                  {isSaving ? 'Renaming...' : 'Rename View'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete View Confirmation Modal */}
      {modalMode === 'delete' && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div id="delete-modal-title" className={styles.modalTitle}>Delete Saved View</div>
              <button
                type="button"
                className={styles.btn}
                onClick={handleCloseModal}
                disabled={isSaving}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>
                Are you sure you want to delete <strong>&quot;{activeView?.name}&quot;</strong>?
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: 0 }}>
                Current Explorer filters and grouping will remain active. Only the saved preference will be deleted.
              </p>
              {modalError && (
                <div className={styles.modalError}>
                  <AlertCircle size={14} />
                  <span>{modalError}</span>
                </div>
              )}
            </div>
            <div className={styles.modalFooter} style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className={styles.btn}
                onClick={handleCloseModal}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={handleDeleteConfirm}
                disabled={isSaving}
              >
                {isSaving ? 'Deleting...' : 'Delete View'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
