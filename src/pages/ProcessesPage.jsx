import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Workflow,
  Plus,
  Play,
  Clock,
  Sparkles,
  Layers,
  ShieldCheck,
  Edit3,
  AlertCircle,
  Eye,
  Radio,
  FileClock,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StartProcessModal from '../components/StartProcessModal';
import { CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Avatar from '../components/Avatar';
import { useDefinedProcesses } from '../hooks/useDefinedProcesses';
import { useUserContext } from '../hooks/useUserContext';
import { useToast } from '../components/Toast';
import {
  canManageProcessDraft,
  canPublishProcessDraft,
  getProcessCardCapabilities,
  getProcessDefinitionPath,
} from '../utils/processVersionAccess';
import styles from './ProcessesPage.module.css';

export default function ProcessesPage() {
  const { workspaceId } = useParams();
  const { showToast } = useToast();
  const userContext = useUserContext(workspaceId);
  const {
    processes = [],
    loading,
    error,
    publishVersion,
  } = useDefinedProcesses(workspaceId, userContext.authorizationScopeKey);
  const canCreateProcess = canManageProcessDraft(null, userContext);
  const canStartProcesses = !userContext.isReadOnly;
  const hasStartableProcess = canStartProcesses && processes.some((process) => Boolean(process.published_version));

  const [startModalOpen, setStartModalOpen] = useState(false);
  const [selectedProcessId, setSelectedProcessId] = useState(null);
  const [publishingId, setPublishingId] = useState(null);

  const handleStartProcess = (procId) => {
    setSelectedProcessId(procId);
    setStartModalOpen(true);
  };

  const handlePublish = async (versionId, procName) => {
    setPublishingId(versionId);
    try {
      const res = await publishVersion(versionId);
      if (res.success) {
        showToast(`Process version for "${procName}" published successfully!`, 'success');
      } else {
        showToast(res.error || 'Failed to publish version.', 'error');
      }
    } finally {
      setPublishingId(null);
    }
  };

  const isInitialLoading = userContext.loading || (loading && processes.length === 0);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Defined Processes"
        subtitle="Standardized, repeatable business workflows with clear ownership and assignments"
        badge={!isInitialLoading && processes.length > 0 ? `${processes.length} Defined` : null}
        actions={
          <div className={styles.headerActions}>
            {canCreateProcess && (
              <Link
                to={`/workspace/${workspaceId}/processes/new`}
                className={styles.newProcessBtn}
              >
                <Plus size={16} />
                <span>New Process</span>
              </Link>
            )}
            {canStartProcesses && <button
              type="button"
              className={styles.startBtn}
              onClick={() => handleStartProcess(null)}
              disabled={!hasStartableProcess}
            >
              <Play size={16} />
              <span>Start Process</span>
            </button>}
          </div>
        }
      />

      {isInitialLoading ? (
        <CardGridSkeleton count={3} />
      ) : error && processes.length === 0 ? (
        <EmptyState
          icon={AlertCircle}
          title="Unable to load defined processes"
          description={typeof error === 'string' ? error : error.message || 'Please check your access and connection, then retry.'}
        />
      ) : processes.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No Defined Processes"
          description="There are currently no defined process templates in this workspace."
        />
      ) : (
        <div className={styles.grid}>
          {processes.map((proc) => {
            const isDemo = proc.code === 'INTERNAL-MVP-DEMO';
            const publishedVer = proc.published_version;
            const draftVer = proc.draft_version;
            const ownerName = proc.profiles?.full_name || 'Unassigned';
            const capabilities = getProcessCardCapabilities(proc, {
              canEditDraft: canManageProcessDraft(proc, userContext),
              canPublishDraft: canPublishProcessDraft(proc, userContext),
              canStart: canStartProcesses,
            });

            return (
              <div key={proc.id} className={`${styles.card} ${isDemo ? styles.demoCard : ''}`}>
                {/* Top Badge Row */}
                <div className={styles.cardHeader}>
                  <div className={styles.badgeGroup}>
                    {isDemo && (
                      <span className={styles.demoBadge}>
                        <Sparkles size={12} /> Internal Demo
                      </span>
                    )}
                    {proc.departments && (
                      <span
                        className={styles.deptBadge}
                        style={{ borderColor: proc.departments.color || 'var(--yellow)' }}
                      >
                        <span
                          className={styles.deptDot}
                          style={{ background: proc.departments.color || 'var(--yellow)' }}
                        />
                        {proc.departments.code}
                      </span>
                    )}
                  </div>
                  <span className={styles.codePill}>{proc.code}</span>
                </div>

                {/* Process Info */}
                <h3 className={styles.procName}>{proc.name}</h3>
                <p className={styles.procDesc}>{proc.description || 'Standardized workflow template.'}</p>

                {/* Process Stats */}
                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <Layers size={14} className={styles.statIcon} />
                    <span>{proc.versions.length} {proc.versions.length === 1 ? 'Version' : 'Versions'}</span>
                  </div>
                  <div className={styles.statItem}>
                    <Clock size={14} className={styles.statIcon} />
                    <span>
                      {publishedVer && draftVer ? 'Live + Draft' : publishedVer ? 'Live' : draftVer ? 'Draft Only' : 'No Version'}
                    </span>
                  </div>
                </div>

                <div className={styles.versionSummary}>
                  {publishedVer && (
                    <div className={styles.versionRow}>
                      <span className={`${styles.versionStateIcon} ${styles.liveIcon}`}><Radio size={13} /></span>
                      <div className={styles.versionText}>
                        <strong>Live v{publishedVer.version_number}</strong>
                        <span>{publishedVer.step_count} {publishedVer.step_count === 1 ? 'step' : 'steps'} · Published snapshot</span>
                      </div>
                    </div>
                  )}
                  {draftVer && (
                    <div className={styles.versionRow}>
                      <span className={`${styles.versionStateIcon} ${styles.draftIcon}`}><FileClock size={13} /></span>
                      <div className={styles.versionText}>
                        <strong>Draft v{draftVer.version_number}</strong>
                        <span>{draftVer.step_count} {draftVer.step_count === 1 ? 'step' : 'steps'} · Work in progress</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Owner Info */}
                <div className={styles.ownerRow}>
                  <Avatar name={ownerName} size="sm" src={proc.profiles?.avatar_url} />
                  <div className={styles.ownerText}>
                    <span className={styles.ownerLabel}>Owner</span>
                    <span className={styles.ownerName}>{ownerName}</span>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className={styles.cardFooter}>
                  {capabilities.hasPublished && (
                    <div className={styles.versionActionGroup}>
                      <span className={styles.actionGroupLabel}>Live v{publishedVer.version_number}</span>
                      <div className={styles.actionRow}>
                        <Link
                          to={getProcessDefinitionPath(workspaceId, proc.id, publishedVer.id)}
                          className={styles.viewDefinitionBtn}
                        >
                          <Eye size={14} /> {capabilities.hasDraft ? 'View Live Definition' : 'View Definition'}
                        </Link>
                        {capabilities.canStart && <button
                          type="button"
                          className={styles.primaryActionBtn}
                          onClick={() => handleStartProcess(proc.id)}
                        >
                          <Play size={14} /> Start Process
                        </button>}
                      </div>
                    </div>
                  )}

                  {capabilities.hasDraft && (
                    <div className={styles.versionActionGroup}>
                      <span className={styles.actionGroupLabel}>Draft v{draftVer.version_number}</span>
                      <div className={styles.actionRow}>
                        <Link
                          to={getProcessDefinitionPath(workspaceId, proc.id, draftVer.id)}
                          className={styles.viewDefinitionBtn}
                        >
                          <Eye size={14} /> View Draft
                        </Link>
                        {capabilities.canEditDraft && (
                          <Link
                            to={`/workspace/${workspaceId}/processes/${proc.id}/builder`}
                            className={styles.editDraftBtn}
                          >
                            <Edit3 size={14} /> Edit Draft
                          </Link>
                        )}
                        {capabilities.canPublishDraft && (
                          <button
                            type="button"
                            className={styles.publishBtn}
                            onClick={() => handlePublish(draftVer.id, proc.name)}
                            disabled={publishingId === draftVer.id}
                          >
                            <ShieldCheck size={14} />
                            {publishingId === draftVer.id ? 'Publishing...' : 'Publish Draft'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {!capabilities.hasPublished && !capabilities.hasDraft && (
                    <span className={styles.unavailLabel}>No visible process version</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Start Process Modal */}
      {startModalOpen && (
        <StartProcessModal
          isOpen={startModalOpen}
          onClose={() => setStartModalOpen(false)}
          workspaceId={workspaceId}
          processes={processes}
          initialProcessId={selectedProcessId}
        />
      )}
    </div>
  );
}
