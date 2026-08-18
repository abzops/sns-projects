import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Save,
  Check,
  AlertCircle,
  Clock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useDepartments } from '../hooks/useDepartments';
import { useMembers } from '../hooks/useMembers';
import { useUserContext } from '../hooks/useUserContext';
import { useProcessDraft } from '../hooks/useProcessDraft';
import { validateProcessDraft } from '../utils/processDraftValidation';
import { canManageProcessDraft } from '../utils/processVersionAccess';
import ProcessDetailsSection from '../components/process-builder/ProcessDetailsSection';
import RaciMatrix from '../components/process-builder/RaciMatrix';
import ProcessValidationPanel from '../components/process-builder/ProcessValidationPanel';
import Spinner from '../components/Spinner';
import styles from './ProcessBuilderPage.module.css';

export default function ProcessBuilderPage() {
  const { workspaceId, processId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { departments = [] } = useDepartments(workspaceId);
  const { members = [] } = useMembers(workspaceId);
  const userContext = useUserContext(workspaceId);

  const {
    loading,
    saving,
    error: draftError,
    saveStatus,
    lastSaved,
    isDirty,
    isCustomFlow,
    currentProcessId,
    processMeta,
    steps,
    updateProcessMeta,
    addStep,
    duplicateStep,
    deleteStep,
    reorderSteps,
    updateStep,
    updateStepRaci,
    saveDraft,
    refetch,
  } = useProcessDraft(workspaceId, processId);

  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // Active workspace members only
  const activeMembers = members.filter((m) => m.status === 'active');

  const handleValidate = () => {
    const result = validateProcessDraft(
      {
        process: processMeta,
        steps,
      },
      activeMembers
    );
    setValidationResult(result);
    setValidationModalOpen(true);
  };

  const handleSaveDraft = async () => {
    const res = await saveDraft();
    if (res.success) {
      showToast('Process draft saved successfully!', 'success');
      // If this was a new process, navigate to its builder URL so refresh retains identity
      if (!processId && res.processId) {
        navigate(`/workspace/${workspaceId}/processes/${res.processId}/builder`, {
          replace: true,
        });
      }
    } else {
      showToast(res.error || 'Failed to save draft.', 'error');
    }
  };

  if (loading || userContext.loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size="lg" />
        <p className={styles.loadingText}>Loading Process Builder...</p>
      </div>
    );
  }

  const isReadOnly = !canManageProcessDraft(
    processId ? {
      department_id: processMeta.department_id,
      process_owner_id: processMeta.process_owner_id,
    } : null,
    userContext
  );

  return (
    <div className={styles.page}>
      {/* Top Header Bar */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Link
            to={`/workspace/${workspaceId}/processes`}
            className={styles.backLink}
          >
            <ArrowLeft size={16} />
            <span>Defined Processes</span>
          </Link>

          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              {processMeta.name || (processId ? 'Edit Process Draft' : 'New Defined Process')}
            </h1>

            {/* Save Status Badge */}
            <div className={styles.statusGroup}>
              <span
                className={`${styles.statusPill} ${
                  saveStatus === 'saving'
                    ? styles.pillSaving
                    : saveStatus === 'unsaved'
                    ? styles.pillUnsaved
                    : saveStatus === 'conflict'
                    ? styles.pillConflict
                    : styles.pillSaved
                }`}
              >
                {saveStatus === 'saving' && <Spinner size="xs" />}
                {saveStatus === 'saved' && <Check size={12} />}
                {saveStatus === 'unsaved' && <span className={styles.dotUnsaved} />}
                {saveStatus === 'conflict' && <AlertCircle size={12} />}
                <span>
                  {saveStatus === 'saving'
                    ? 'Saving...'
                    : saveStatus === 'unsaved'
                    ? 'Unsaved changes'
                    : saveStatus === 'conflict'
                    ? 'Conflict: Reload required'
                    : 'Draft Saved'}
                </span>
              </span>

              {lastSaved && saveStatus === 'saved' && (
                <span className={styles.lastSavedText}>
                  <Clock size={11} />
                  <span>
                    Saved {new Date(lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.validateBtn}
            onClick={handleValidate}
          >
            <CheckCircle2 size={16} />
            <span>Validate Matrix</span>
          </button>

          {!isReadOnly && (
            <button
              type="button"
              className={styles.saveDraftBtn}
              onClick={handleSaveDraft}
              disabled={saving}
            >
              <Save size={16} />
              <span>{saving ? 'Saving...' : 'Save Draft'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Error or Conflict Alert Banner */}
      {draftError && (
        <div className={styles.errorBanner}>
          <AlertCircle size={18} />
          <div className={styles.errorText}>
            <strong>Save Error:</strong> {draftError}
          </div>
          {saveStatus === 'conflict' && (
            <button
              type="button"
              className={styles.reloadBtn}
              onClick={refetch}
            >
              <RefreshCw size={13} />
              <span>Reload Draft</span>
            </button>
          )}
        </div>
      )}

      {/* Main Builder Content */}
      <div className={styles.content}>
        {/* Section 1: Process Details */}
        <ProcessDetailsSection
          processMeta={processMeta}
          onChange={updateProcessMeta}
          departments={departments}
          activeMembers={activeMembers}
          readonly={isReadOnly}
        />

        {/* Section 2: Dynamic RACI Matrix */}
        <RaciMatrix
          steps={steps}
          activeMembers={activeMembers}
          onAddStep={addStep}
          onDuplicateStep={duplicateStep}
          onDeleteStep={deleteStep}
          onReorderSteps={reorderSteps}
          onUpdateStep={updateStep}
          onUpdateStepRaci={updateStepRaci}
          readonly={isReadOnly}
          isCustomFlow={isCustomFlow}
        />
      </div>

      {/* Validation Modal Panel */}
      {validationModalOpen && validationResult && (
        <ProcessValidationPanel
          isOpen={validationModalOpen}
          onClose={() => setValidationModalOpen(false)}
          validationResult={validationResult}
        />
      )}
    </div>
  );
}
