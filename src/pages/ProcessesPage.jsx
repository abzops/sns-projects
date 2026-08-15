import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Workflow,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  Sparkles,
  Building,
  User,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StartProcessModal from '../components/StartProcessModal';
import { CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Avatar from '../components/Avatar';
import { useDefinedProcesses } from '../hooks/useDefinedProcesses';
import { useUserContext } from '../hooks/useUserContext';
import { useToast } from '../components/Toast';
import styles from './ProcessesPage.module.css';

export default function ProcessesPage() {
  const { workspaceId } = useParams();
  const { showToast } = useToast();
  const {
    processes = [],
    loading,
    refreshing,
    publishVersion,
  } = useDefinedProcesses(workspaceId);

  const { isOwner, isAdmin, isProjectAdmin, isSystemAdmin } = useUserContext(workspaceId);
  const canPublish = isOwner || isAdmin || isProjectAdmin || isSystemAdmin;

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

  return (
    <div className={styles.page}>
      <PageHeader
        title="Defined Processes"
        subtitle="Standardized, repeatable business workflows with multi-step RACI governance"
        badge={processes.length > 0 ? `${processes.length} Defined` : null}
        actions={
          <button
            type="button"
            className={styles.startBtn}
            onClick={() => handleStartProcess(null)}
            disabled={processes.length === 0}
          >
            <Play size={16} />
            <span>Start Process</span>
          </button>
        }
      />

      {loading && processes.length === 0 ? (
        <CardGridSkeleton count={3} />
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
                    <span>{proc.step_count} {proc.step_count === 1 ? 'Step' : 'Steps'}</span>
                  </div>
                  <div className={styles.statItem}>
                    <Clock size={14} className={styles.statIcon} />
                    <span>
                      {publishedVer ? `v${publishedVer.version_number} (Live)` : draftVer ? 'Draft Only' : 'No Version'}
                    </span>
                  </div>
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
                  {publishedVer ? (
                    <button
                      type="button"
                      className={styles.primaryActionBtn}
                      onClick={() => handleStartProcess(proc.id)}
                    >
                      <Play size={14} /> Start Process
                    </button>
                  ) : draftVer && canPublish ? (
                    <button
                      type="button"
                      className={styles.publishBtn}
                      onClick={() => handlePublish(draftVer.id, proc.name)}
                      disabled={publishingId === draftVer.id}
                    >
                      <ShieldCheck size={14} />
                      {publishingId === draftVer.id ? 'Publishing...' : 'Publish Version'}
                    </button>
                  ) : (
                    <span className={styles.unavailLabel}>Draft under review</span>
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
