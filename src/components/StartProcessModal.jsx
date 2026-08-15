import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useProjects } from '../hooks/useProjects';
import { useMilestones } from '../hooks/useMilestones';
import { useToast } from './Toast';
import styles from './StartProcessModal.module.css';

export default function StartProcessModal({
  isOpen,
  onClose,
  workspaceId,
  processes = [],
  initialProcessId = null,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [selectedProcessId, setSelectedProcessId] = useState(initialProcessId || '');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedMilestoneId, setSelectedMilestoneId] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [starting, setStarting] = useState(false);

  // Root step checking state
  const [rootCheckLoading, setRootCheckLoading] = useState(false);
  const [rootStepInfo, setRootStepInfo] = useState(null);
  const [isUserRootResponsible, setIsUserRootResponsible] = useState(false);

  // Fetch projects in workspace
  const { projects = [] } = useProjects(workspaceId);

  // Fetch milestones for selected project
  const { milestones = [] } = useMilestones(selectedProjectId);

  // Reset form when modal opens or initialProcessId changes
  useEffect(() => {
    if (isOpen) {
      const defaultProc = initialProcessId
        ? processes.find((p) => p.id === initialProcessId)
        : processes.find((p) => p.published_version) || processes[0] || null;

      setSelectedProcessId(defaultProc?.id || '');
      setSelectedProjectId(projects[0]?.id || '');
      setInstanceName('');
    }
  }, [isOpen, initialProcessId, processes, projects]);

  // Set default milestone when project changes
  useEffect(() => {
    if (milestones.length > 0) {
      setSelectedMilestoneId(milestones[0].id);
    } else {
      setSelectedMilestoneId('');
    }
  }, [milestones, selectedProjectId]);

  const selectedProcess = useMemo(() => {
    return processes.find((p) => p.id === selectedProcessId) || null;
  }, [processes, selectedProcessId]);

  const publishedVersion = selectedProcess?.published_version || null;

  // Check root step Responsible for the published version
  useEffect(() => {
    let active = true;

    async function checkRootRaci() {
      if (!publishedVersion?.id || !user?.id) {
        setRootStepInfo(null);
        setIsUserRootResponsible(false);
        return;
      }

      setRootCheckLoading(true);
      try {
        // Find root step (0 dependencies)
        const { data: steps, error: sErr } = await supabase
          .from('defined_process_steps')
          .select(`
            id,
            step_code,
            title,
            sequence_order,
            expected_duration_days
          `)
          .eq('version_id', publishedVersion.id)
          .order('sequence_order', { ascending: true });

        if (sErr) throw sErr;

        const { data: deps } = await supabase
          .from('defined_process_step_dependencies')
          .select('step_id')
          .eq('version_id', publishedVersion.id);

        const depStepIds = new Set((deps || []).map((d) => d.step_id));
        const rootStep = (steps || []).find((s) => !depStepIds.has(s.id)) || steps?.[0] || null;

        if (!rootStep) {
          if (active) {
            setRootStepInfo(null);
            setIsUserRootResponsible(false);
          }
          return;
        }

        // Fetch RACI for root step
        const { data: rootRaci, error: rErr } = await supabase
          .from('defined_process_step_raci')
          .select(`
            id,
            raci_role,
            user_id,
            profiles:user_id (
              id,
              full_name
            )
          `)
          .eq('step_id', rootStep.id);

        if (rErr) throw rErr;

        const isResp = (rootRaci || []).some(
          (r) => r.raci_role === 'R' && r.user_id === user.id
        );

        if (active) {
          setRootStepInfo({
            step: rootStep,
            raci: rootRaci || [],
          });
          setIsUserRootResponsible(isResp);
        }
      } catch (err) {
        console.error('[StartProcessModal] Root check error:', err);
        if (active) {
          setIsUserRootResponsible(false);
        }
      } finally {
        if (active) setRootCheckLoading(false);
      }
    }

    checkRootRaci();

    return () => {
      active = false;
    };
  }, [publishedVersion?.id, user?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!publishedVersion?.id || !selectedProjectId || !selectedMilestoneId || !instanceName.trim()) {
      showToast('Please fill all required fields.', 'error');
      return;
    }

    if (!isUserRootResponsible) {
      showToast('Only a Responsible user on the first step can start this process.', 'error');
      return;
    }

    setStarting(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('start_defined_process', {
        p_version_id: publishedVersion.id,
        p_project_id: selectedProjectId,
        p_milestone_id: selectedMilestoneId,
        p_instance_name: instanceName.trim(),
        p_raci_overrides: null,
      });

      if (rpcErr) throw rpcErr;

      showToast(`Process "${instanceName.trim()}" started successfully!`, 'success');
      onClose();

      // Navigate to the newly created process instance
      if (data?.task_list_id) {
        navigate(`/workspace/${workspaceId}/project/${selectedProjectId}/process/${data.task_list_id}`);
      }
    } catch (err) {
      console.error('[StartProcessModal] start_defined_process error:', err);
      showToast(err.message || 'Failed to start process.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const isFormValid =
    !!publishedVersion &&
    !!selectedProjectId &&
    !!selectedMilestoneId &&
    instanceName.trim().length > 0 &&
    isUserRootResponsible &&
    !rootCheckLoading;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start Defined Process" size="md">
      <form onSubmit={handleSubmit} className={styles.form}>
        {/* Process Selection */}
        <div className={styles.field}>
          <label className={styles.label}>Defined Process</label>
          <select
            className={styles.select}
            value={selectedProcessId}
            onChange={(e) => setSelectedProcessId(e.target.value)}
            required
          >
            {processes.map((proc) => (
              <option key={proc.id} value={proc.id} disabled={!proc.published_version}>
                {proc.name} ({proc.code}) {!proc.published_version ? '— [Draft Only]' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Published Version Info */}
        {selectedProcess && (
          <div className={styles.processMetaBox}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Published Version:</span>
              {publishedVersion ? (
                <span className={styles.versionBadge}>
                  v{publishedVersion.version_number} (Published)
                </span>
              ) : (
                <span className={styles.draftBadge}>No published version available</span>
              )}
            </div>
            {selectedProcess.code === 'INTERNAL-MVP-DEMO' && (
              <div className={styles.demoBadgeBanner}>
                <Sparkles size={14} />
                <span>Internal QA Smoke Demo Process</span>
              </div>
            )}
          </div>
        )}

        {/* Project Target */}
        <div className={styles.field}>
          <label className={styles.label}>Target Project</label>
          <select
            className={styles.select}
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            required
          >
            {projects.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name}
              </option>
            ))}
          </select>
        </div>

        {/* Milestone Target */}
        <div className={styles.field}>
          <label className={styles.label}>Target Milestone</label>
          <select
            className={styles.select}
            value={selectedMilestoneId}
            onChange={(e) => setSelectedMilestoneId(e.target.value)}
            required
            disabled={milestones.length === 0}
          >
            {milestones.length === 0 ? (
              <option value="">No milestones in project</option>
            ) : (
              milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Instance Name */}
        <div className={styles.field}>
          <label className={styles.label}>
            Instance Name <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Procurement Order PO-2026-001 or Demo Run 001"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            required
          />
        </div>

        {/* Root Responsible Authority Check Banner */}
        {publishedVersion && (
          <div
            className={`${styles.authorityBanner} ${
              isUserRootResponsible ? styles.authorityPass : styles.authorityFail
            }`}
          >
            {rootCheckLoading ? (
              <div className={styles.checkingText}>Verifying root step authority...</div>
            ) : isUserRootResponsible ? (
              <div className={styles.authRow}>
                <CheckCircle2 size={16} className={styles.passIcon} />
                <span>
                  You are assigned as <strong>Responsible (R)</strong> on root step{' '}
                  <code>{rootStepInfo?.step?.step_code}</code> ({rootStepInfo?.step?.title}). You may start this process.
                </span>
              </div>
            ) : (
              <div className={styles.authRow}>
                <ShieldAlert size={16} className={styles.failIcon} />
                <span>
                  Only a <strong>Responsible (R)</strong> user on the first step can start this process.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className={styles.modalActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={starting}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!isFormValid || starting}
          >
            {starting ? (
              'Starting Process...'
            ) : (
              <>
                <Play size={16} /> Start Process
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
