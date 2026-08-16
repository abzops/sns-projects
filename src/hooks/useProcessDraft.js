import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeProcessDraftPayload } from '../utils/processDraftNormalization';

export function useProcessDraft(workspaceId, processId = null) {
  const [loading, setLoading] = useState(Boolean(processId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict'
  const [lastSaved, setLastSaved] = useState(null);
  const [isCustomFlow, setIsCustomFlow] = useState(false);

  const [currentProcessId, setCurrentProcessId] = useState(processId);
  const [versionId, setVersionId] = useState(null);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);

  const [processMeta, setProcessMeta] = useState({
    name: '',
    code: '',
    description: '',
    department_id: '',
    process_owner_id: '',
  });

  const [steps, setSteps] = useState([
    {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'step-1',
      step_code: 'STP-001',
      title: '',
      description: '',
      sequence_order: 1,
      expected_duration_days: 1,
      approval_required: false,
      consultation_required: false,
      evidence_required: false,
      raci: [],
    },
  ]);

  const initialSnapshotRef = useRef(null);

  // Helper to generate next unused step code
  const getNextStepCode = useCallback((currentSteps) => {
    let maxNum = 0;
    currentSteps.forEach((s) => {
      const match = (s.step_code || '').match(/STP-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    const nextNum = Math.max(maxNum + 1, currentSteps.length + 1);
    return `STP-${String(nextNum).padStart(3, '0')}`;
  }, []);

  // Fetch existing draft
  const loadDraft = useCallback(async () => {
    if (!processId || !workspaceId) return;

    try {
      setLoading(true);
      setError(null);

      // 1. Fetch process
      const { data: proc, error: procErr } = await supabase
        .from('defined_processes')
        .select('*')
        .eq('id', processId)
        .eq('workspace_id', workspaceId)
        .single();

      if (procErr) throw procErr;

      setProcessMeta({
        name: proc.name || '',
        code: proc.code || '',
        description: proc.description || '',
        department_id: proc.department_id || '',
        process_owner_id: proc.process_owner_id || '',
      });

      // 2. Fetch draft version (or latest draft)
      const { data: versions, error: verErr } = await supabase
        .from('defined_process_versions')
        .select('*')
        .eq('defined_process_id', processId)
        .eq('status', 'draft')
        .order('version_number', { ascending: false })
        .limit(1);

      if (verErr) throw verErr;

      let currentVer = versions && versions.length > 0 ? versions[0] : null;

      if (!currentVer) {
        // If no draft version exists, maybe process has only published versions
        throw new Error('No editable draft version found for this process.');
      }

      setVersionId(currentVer.id);
      setBaseUpdatedAt(currentVer.updated_at);

      // 3. Fetch steps
      const { data: stepsData, error: sErr } = await supabase
        .from('defined_process_steps')
        .select('*')
        .eq('version_id', currentVer.id)
        .order('sequence_order', { ascending: true });

      if (sErr) throw sErr;

      // 4. Fetch RACI for steps
      const stepIds = (stepsData || []).map((s) => s.id);
      let raciByStep = {};

      if (stepIds.length > 0) {
        const { data: raciData, error: rErr } = await supabase
          .from('defined_process_step_raci')
          .select('id, step_id, raci_role, actor_type, user_id, response_required')
          .in('step_id', stepIds);

        if (rErr) throw rErr;

        (raciData || []).forEach((r) => {
          if (!raciByStep[r.step_id]) raciByStep[r.step_id] = [];
          raciByStep[r.step_id].push({
            id: r.id,
            raci_role: r.raci_role,
            actor_type: r.actor_type || 'user',
            user_id: r.user_id,
            response_required: Boolean(r.response_required),
          });
        });
      }

      // 5. Fetch dependencies to check if Custom Flow
      const { data: depsData, error: dErr } = await supabase
        .from('defined_process_step_dependencies')
        .select('id, step_id, depends_on_step_id')
        .eq('version_id', currentVer.id);

      if (dErr) throw dErr;

      const stepCount = (stepsData || []).length;
      const edgeCount = (depsData || []).length;
      let isLinear = true;

      if (stepCount > 1) {
        if (edgeCount !== stepCount - 1) {
          isLinear = false;
        } else {
          // Check if every edge connects sequence N to sequence N-1
          const stepMap = new Map((stepsData || []).map((s) => [s.id, s]));
          for (const dep of depsData || []) {
            const step = stepMap.get(dep.step_id);
            const pred = stepMap.get(dep.depends_on_step_id);
            if (!step || !pred || step.sequence_order !== pred.sequence_order + 1) {
              isLinear = false;
              break;
            }
          }
        }
      }

      setIsCustomFlow(!isLinear);

      // Assemble full steps array
      const loadedSteps = (stepsData || []).map((s, idx) => ({
        id: s.id,
        step_code: s.step_code || `STP-${String(idx + 1).padStart(3, '0')}`,
        title: s.title || '',
        description: s.description || '',
        sequence_order: s.sequence_order || idx + 1,
        expected_duration_days: s.expected_duration_days || 1,
        approval_required: Boolean(s.approval_required),
        consultation_required: Boolean(s.consultation_required),
        evidence_required: Boolean(s.evidence_required),
        raci: raciByStep[s.id] || [],
      }));

      const finalSteps = loadedSteps.length > 0 ? loadedSteps : [
        {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'step-1',
          step_code: 'STP-001',
          title: '',
          description: '',
          sequence_order: 1,
          expected_duration_days: 1,
          approval_required: false,
          consultation_required: false,
          evidence_required: false,
          raci: [],
        },
      ];

      setSteps(finalSteps);

      // Set baseline snapshot
      initialSnapshotRef.current = JSON.stringify({
        process: {
          name: proc.name || '',
          code: proc.code || '',
          description: proc.description || '',
          department_id: proc.department_id || '',
          process_owner_id: proc.process_owner_id || '',
        },
        steps: finalSteps,
      });

      setSaveStatus('saved');
      setLastSaved(new Date());
    } catch (err) {
      console.error('[useProcessDraft] Error loading draft:', err);
      setError(err.message || 'Failed to load process draft.');
      setSaveStatus('error');
    } finally {
      setLoading(false);
    }
  }, [processId, workspaceId]);

  useEffect(() => {
    if (processId) {
      loadDraft();
    } else {
      // New process
      initialSnapshotRef.current = JSON.stringify({
        process: {
          name: '',
          code: '',
          description: '',
          department_id: '',
          process_owner_id: '',
        },
        steps: [
          {
            id: 'step-1',
            step_code: 'STP-001',
            title: '',
            description: '',
            sequence_order: 1,
            expected_duration_days: 1,
            approval_required: false,
            consultation_required: false,
            evidence_required: false,
            raci: [],
          },
        ],
      });
      setSaveStatus('saved');
    }
  }, [processId, loadDraft]);

  // Dirty detection
  const isDirty = (() => {
    if (!initialSnapshotRef.current) return false;
    const current = JSON.stringify({ process: processMeta, steps });
    return current !== initialSnapshotRef.current;
  })();

  // Mutators
  const updateProcessMeta = useCallback((updates) => {
    setProcessMeta((prev) => {
      const next = { ...prev, ...updates };
      setSaveStatus('unsaved');
      return next;
    });
  }, []);

  const addStep = useCallback((afterIndex = null) => {
    if (isCustomFlow) {
      setError('Cannot add steps to a custom dependency flow in V1-03A.');
      return;
    }

    setSteps((prev) => {
      const nextCode = getNextStepCode(prev);
      const newStep = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `step-${Date.now()}`,
        step_code: nextCode,
        title: '',
        description: '',
        sequence_order: prev.length + 1,
        expected_duration_days: 1,
        approval_required: false,
        consultation_required: false,
        evidence_required: false,
        raci: [],
      };

      let next;
      if (afterIndex === null || afterIndex >= prev.length - 1) {
        next = [...prev, newStep];
      } else {
        next = [...prev.slice(0, afterIndex + 1), newStep, ...prev.slice(afterIndex + 1)];
      }

      // Re-sequence
      const resequenced = next.map((s, idx) => ({
        ...s,
        sequence_order: idx + 1,
      }));

      setSaveStatus('unsaved');
      return resequenced;
    });
  }, [getNextStepCode, isCustomFlow]);

  const duplicateStep = useCallback((index) => {
    if (isCustomFlow) {
      setError('Cannot duplicate steps in a custom dependency flow in V1-03A.');
      return;
    }

    setSteps((prev) => {
      const source = prev[index];
      if (!source) return prev;

      const nextCode = getNextStepCode(prev);
      const cloned = {
        ...source,
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `step-${Date.now()}`,
        step_code: nextCode,
        title: source.title ? `${source.title} (Copy)` : '',
        sequence_order: index + 2,
        raci: (source.raci || []).map((r) => ({
          ...r,
          id: undefined, // Fresh RACI row
        })),
      };

      const next = [...prev.slice(0, index + 1), cloned, ...prev.slice(index + 1)];
      const resequenced = next.map((s, idx) => ({
        ...s,
        sequence_order: idx + 1,
      }));

      setSaveStatus('unsaved');
      return resequenced;
    });
  }, [getNextStepCode, isCustomFlow]);

  const deleteStep = useCallback((index) => {
    if (isCustomFlow) {
      setError('Cannot delete steps from a custom dependency flow in V1-03A.');
      return;
    }

    setSteps((prev) => {
      if (prev.length <= 1) {
        // Keep at least 1 step
        return prev;
      }
      const next = prev.filter((_, idx) => idx !== index);
      const resequenced = next.map((s, idx) => ({
        ...s,
        sequence_order: idx + 1,
      }));

      setSaveStatus('unsaved');
      return resequenced;
    });
  }, [isCustomFlow]);

  const reorderSteps = useCallback((oldIndex, newIndex) => {
    if (isCustomFlow) {
      setError('Cannot reorder steps in a custom dependency flow in V1-03A.');
      return;
    }
    if (oldIndex === newIndex) return;

    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);

      // Re-sequence without rewriting user-entered step_code
      const resequenced = next.map((s, idx) => ({
        ...s,
        sequence_order: idx + 1,
      }));

      setSaveStatus('unsaved');
      return resequenced;
    });
  }, [isCustomFlow]);

  const updateStep = useCallback((index, updates) => {
    setSteps((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], ...updates };
      setSaveStatus('unsaved');
      return next;
    });
  }, []);

  const updateStepRaci = useCallback((index, raciRole, newRoleAssignments) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = next[index];
      if (!step) return prev;

      // Keep assignments for OTHER roles, replace assignments for this role
      const otherRoles = (step.raci || []).filter((r) => r.raci_role !== raciRole);
      const updatedRaci = [...otherRoles, ...newRoleAssignments];

      next[index] = { ...step, raci: updatedRaci };
      setSaveStatus('unsaved');
      return next;
    });
  }, []);

  // Save Draft via Edge Function
  const saveDraft = useCallback(async () => {
    if (saving) return { success: false, error: 'Save already in progress' };

    setSaving(true);
    setSaveStatus('saving');
    setError(null);

    try {
      const payload = normalizeProcessDraftPayload({
        workspaceId,
        processId: currentProcessId,
        versionId,
        baseUpdatedAt,
        process: processMeta,
        steps,
      });

      const { data, error: edgeErr } = await supabase.functions.invoke(
        'manage-defined-process-draft',
        {
          body: payload,
        }
      );

      if (edgeErr) {
        let errMessage = edgeErr.message || 'Failed to save process draft.';
        if (edgeErr.context && edgeErr.context.json) {
          try {
            const parsed = await edgeErr.context.json();
            if (parsed?.error) errMessage = parsed.error;
          } catch {
            // keep errMessage
          }
        }
        throw new Error(errMessage);
      }

      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to save draft.');
      }

      // Update state with returned authoritative tokens
      if (data.process_id) setCurrentProcessId(data.process_id);
      if (data.version_id) setVersionId(data.version_id);
      if (data.updated_at) setBaseUpdatedAt(data.updated_at);

      // Snapshot updated state
      initialSnapshotRef.current = JSON.stringify({
        process: processMeta,
        steps,
      });

      setSaveStatus('saved');
      setLastSaved(new Date());

      return {
        success: true,
        processId: data.process_id,
        versionId: data.version_id,
        updatedAt: data.updated_at,
      };
    } catch (err) {
      console.error('[useProcessDraft] Save failed:', err);
      const isConflict = err.message?.includes('This draft changed since you opened it');
      setSaveStatus(isConflict ? 'conflict' : 'error');
      setError(err.message || 'Failed to save process draft.');
      return { success: false, error: err.message };
    } finally {
      setSaving(false);
    }
  }, [saving, workspaceId, currentProcessId, versionId, baseUpdatedAt, processMeta, steps]);

  return {
    loading,
    saving,
    error,
    saveStatus,
    lastSaved,
    isDirty,
    isCustomFlow,
    currentProcessId,
    versionId,
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
    refetch: loadDraft,
  };
}
