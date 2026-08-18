import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Clock3,
  FileCheck2,
  GitBranch,
  MessageSquareText,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Avatar from '../Avatar';
import styles from './ProcessDefinitionWorkflow.module.css';

const roleLabels = {
  A: 'Accountable',
  R: 'Responsible',
  C: 'Consulted',
  I: 'Informed',
};

function ActorChip({ assignment }) {
  const isStarter = assignment.actor_type === 'process_starter';
  const name = isStarter
    ? 'Process Starter'
    : assignment.profile?.full_name || assignment.department?.name || 'Unavailable actor';
  const detail = assignment.department?.code || (isStarter ? 'Resolved when started' : null);

  return (
    <span className={styles.actorChip} title={name}>
      {isStarter ? (
        <span className={styles.starterAvatar}>PS</span>
      ) : assignment.department ? (
        <span
          className={styles.departmentAvatar}
          style={{ backgroundColor: assignment.department.color || 'var(--yellow)' }}
        >
          {assignment.department.code || 'DEPT'}
        </span>
      ) : (
        <Avatar name={name} src={assignment.profile?.avatar_url} size="xs" />
      )}
      <span className={styles.actorText}>
        <span className={styles.actorName}>{name}</span>
        {detail && <span className={styles.actorDetail}>{detail}</span>}
      </span>
      {assignment.response_required && (
        <span className={styles.responseBadge}>Response required</span>
      )}
    </span>
  );
}

function RaciGroup({ role, assignments }) {
  return (
    <div className={styles.raciGroup}>
      <div className={styles.raciLabel}>
        <span className={`${styles.raciPill} ${styles[`role${role}`]}`}>{role}</span>
        <span>{roleLabels[role]}</span>
      </div>
      <div className={styles.actorList}>
        {assignments.length > 0 ? (
          assignments.map((assignment) => (
            <ActorChip key={assignment.id} assignment={assignment} />
          ))
        ) : (
          <span className={styles.emptyRole}>None assigned</span>
        )}
      </div>
    </div>
  );
}

function RequirementBadge({ active, icon: Icon, children }) {
  return (
    <span className={`${styles.requirementBadge} ${active ? styles.requirementActive : ''}`}>
      <Icon size={13} /> {children}: {active ? 'Required' : 'Not required'}
    </span>
  );
}

export default function ProcessDefinitionWorkflow({ steps = [], isLinear = true }) {
  return (
    <section className={styles.section} aria-labelledby="workflow-definition-title">
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.eyebrow}>Workflow</div>
          <h2 id="workflow-definition-title" className={styles.sectionTitle}>Execution steps and RACI</h2>
        </div>
        <span className={`${styles.flowBadge} ${isLinear ? styles.linearFlow : styles.customFlow}`}>
          {isLinear ? <ArrowDown size={14} /> : <GitBranch size={14} />}
          {isLinear ? 'Linear sequence' : 'Custom dependency flow'}
        </span>
      </div>

      {!isLinear && (
        <div className={styles.flowNotice}>
          <AlertTriangle size={16} />
          <span>This definition uses a dependency graph. Each step lists its exact predecessors; sequence numbers are display order, not a claim of simple linear execution.</span>
        </div>
      )}

      {steps.length === 0 ? (
        <div className={styles.emptyWorkflow}>This version contains no visible steps.</div>
      ) : (
        <div className={styles.steps}>
          {steps.map((step, index) => {
            const raciByRole = Object.fromEntries(
              Object.keys(roleLabels).map((role) => [
                role,
                (step.raci || []).filter((assignment) => assignment.raci_role === role),
              ])
            );
            const predecessorLabels = (step.dependencies || [])
              .map((dependency) => dependency.predecessor)
              .filter(Boolean)
              .map((predecessor) => `${predecessor.step_code} — ${predecessor.title}`);

            return (
              <article key={step.id} className={styles.stepCard}>
                <div className={styles.stepHeader}>
                  <span className={styles.sequenceBadge}>{index + 1}</span>
                  <div className={styles.stepTitleGroup}>
                    <span className={styles.stepCode}>{step.step_code}</span>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                  </div>
                  <span className={styles.durationBadge}>
                    <Clock3 size={13} /> {step.expected_duration_days} working {step.expected_duration_days === 1 ? 'day' : 'days'}
                  </span>
                </div>

                <p className={styles.stepDescription}>{step.description || 'No step description provided.'}</p>

                <div className={styles.dependencyRow}>
                  <GitBranch size={14} />
                  <strong>{predecessorLabels.length === 0 ? 'Entry step' : 'Depends on'}</strong>
                  {predecessorLabels.length > 0 && (
                    <span>{predecessorLabels.join(', ')}</span>
                  )}
                </div>

                <div className={styles.requirements}>
                  <RequirementBadge active={step.approval_required} icon={ShieldCheck}>Approval</RequirementBadge>
                  <RequirementBadge active={step.consultation_required} icon={MessageSquareText}>Consultation</RequirementBadge>
                  <RequirementBadge active={step.evidence_required} icon={FileCheck2}>Evidence</RequirementBadge>
                </div>

                {step.evidence_definitions?.length > 0 && (
                  <div className={styles.evidenceList}>
                    <FileCheck2 size={14} />
                    <span>
                      {step.evidence_definitions.map((item) => (
                        `${item.title} (${item.evidence_type}${item.is_mandatory ? ', mandatory' : ''})`
                      )).join(' · ')}
                    </span>
                  </div>
                )}

                <div className={styles.raciHeader}>
                  <Users size={15} /> Step responsibility matrix
                  <CheckCircle2 size={13} className={styles.snapshotIcon} />
                  <span className={styles.snapshotText}>Snapshot assignments</span>
                </div>
                <div className={styles.raciGrid}>
                  {Object.keys(roleLabels).map((role) => (
                    <RaciGroup key={role} role={role} assignments={raciByRole[role]} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
