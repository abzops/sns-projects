import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  FileSearch,
  History,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import EmptyState from '../components/EmptyState';
import ProcessDetailsSection from '../components/process-builder/ProcessDetailsSection';
import ProcessDefinitionWorkflow from '../components/process-builder/ProcessDefinitionWorkflow';
import { useProcessDefinition } from '../hooks/useProcessDefinition';
import styles from './ProcessDefinitionPage.module.css';

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function DefinitionSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading process definition">
      <div className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
      <div className={styles.skeletonMeta} />
      <div className={styles.skeletonPanel} />
      <div className={styles.skeletonPanel} />
      <div className={styles.skeletonPanel} />
    </div>
  );
}

export default function ProcessDefinitionPage() {
  const { workspaceId, processId, versionId } = useParams();
  const { definition, loading, error, refetch } = useProcessDefinition(workspaceId, processId, versionId);
  const catalogPath = `/workspace/${workspaceId}/processes`;

  if (loading) {
    return (
      <div className={styles.page}>
        <Link to={catalogPath} className={styles.backLink}>
          <ArrowLeft size={16} /> Defined Processes
        </Link>
        <DefinitionSkeleton />
      </div>
    );
  }

  if (error || !definition) {
    return (
      <div className={styles.page}>
        <Link to={catalogPath} className={styles.backLink}>
          <ArrowLeft size={16} /> Defined Processes
        </Link>
        <EmptyState
          icon={FileSearch}
          title="Unable to load process definition"
          description="The requested process definition is unavailable or you do not have access."
          actionLabel="Retry"
          onAction={refetch}
        />
      </div>
    );
  }

  const { process, version, steps, isLinear } = definition;
  const isPublished = version.status === 'published';
  const statusLabel = isPublished ? 'Published' : version.status === 'draft' ? 'Draft' : 'Archived';
  const ownerName = process.owner?.full_name || 'Unassigned';
  const publisherName = version.publisher?.full_name || null;

  return (
    <div className={styles.page}>
      <Link to={catalogPath} className={styles.backLink}>
        <ArrowLeft size={16} /> Defined Processes
      </Link>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.readOnlyBadge}>
            <ShieldCheck size={14} /> Read-only definition snapshot
          </div>
          <h1 className={styles.title}>{process.name}</h1>
          <p className={styles.subtitle}>
            Inspect the exact workflow, responsibilities, and dependencies for this version. No changes can be made here.
          </p>
        </div>
        <div className={styles.versionPanel}>
          <span className={`${styles.statusPill} ${isPublished ? styles.published : styles.draft}`}>
            {statusLabel}
          </span>
          <strong>Version {version.version_number}</strong>
          <span>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
        </div>
      </header>

      <section className={styles.versionInfo} aria-labelledby="version-information-title">
        <div className={styles.sectionHeading}>
          <History size={16} />
          <h2 id="version-information-title">Version information</h2>
        </div>
        <div className={styles.versionGrid}>
          <div className={styles.infoItem}>
            <span>Status</span>
            <strong>{statusLabel}</strong>
          </div>
          <div className={styles.infoItem}>
            <span>Version</span>
            <strong>v{version.version_number}</strong>
          </div>
          <div className={styles.infoItem}>
            <span><UserRound size={13} /> Process owner</span>
            <strong title={ownerName}>{ownerName}</strong>
          </div>
          <div className={styles.infoItem}>
            <span><CalendarDays size={13} /> {isPublished ? 'Published' : 'Created'}</span>
            <strong>{formatDate(isPublished ? version.published_at : version.created_at) || 'Not recorded'}</strong>
          </div>
          {isPublished && publisherName && (
            <div className={styles.infoItem}>
              <span>Published by</span>
              <strong title={publisherName}>{publisherName}</strong>
            </div>
          )}
          <div className={`${styles.infoItem} ${styles.summaryItem}`}>
            <span>Change summary</span>
            <strong>{version.change_summary || 'No change summary provided.'}</strong>
          </div>
        </div>
      </section>

      <section aria-labelledby="process-information-title">
        <div className={styles.sectionHeading}>
          <FileSearch size={16} />
          <h2 id="process-information-title">Process information</h2>
        </div>
        <ProcessDetailsSection
          processMeta={process}
          onChange={() => {}}
          departments={process.department ? [process.department] : []}
          activeMembers={process.owner ? [{ user_id: process.owner.id, ...process.owner }] : []}
          readonly
        />
      </section>

      <ProcessDefinitionWorkflow steps={steps} isLinear={isLinear} />
    </div>
  );
}
