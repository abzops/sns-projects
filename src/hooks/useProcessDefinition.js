import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isLinearProcessFlow } from '../utils/processVersionAccess';

function groupBy(items, key) {
  return (items || []).reduce((groups, item) => {
    const value = item[key];
    if (!groups[value]) groups[value] = [];
    groups[value].push(item);
    return groups;
  }, {});
}

export function useProcessDefinition(workspaceId, processId, versionId) {
  const [definition, setDefinition] = useState(null);
  const [loading, setLoading] = useState(Boolean(workspaceId && processId && versionId));
  const [error, setError] = useState(null);

  const loadDefinition = useCallback(async () => {
    if (!workspaceId || !processId || !versionId) {
      setDefinition(null);
      setLoading(false);
      setError('A workspace, process, and exact version are required.');
      return;
    }

    setLoading(true);
    setError(null);
    setDefinition(null);

    try {
      const [processResult, versionResult] = await Promise.all([
        supabase
          .from('defined_processes')
          .select('id, workspace_id, department_id, name, code, description, process_owner_id, is_active, created_by, created_at, updated_at')
          .eq('id', processId)
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        supabase
          .from('defined_process_versions')
          .select('id, defined_process_id, version_number, status, change_summary, published_by, published_at, created_by, created_at, updated_at')
          .eq('id', versionId)
          .eq('defined_process_id', processId)
          .maybeSingle(),
      ]);

      if (processResult.error) throw processResult.error;
      if (versionResult.error) throw versionResult.error;
      if (!processResult.data) throw new Error('Defined process not found or you do not have access.');
      if (!versionResult.data) throw new Error('The requested process version was not found or is not visible to you.');

      const process = processResult.data;
      const version = versionResult.data;

      const { data: stepsData, error: stepsError } = await supabase
        .from('defined_process_steps')
        .select('id, version_id, step_code, title, description, sequence_order, expected_duration_days, approval_required, consultation_required, evidence_required')
        .eq('version_id', versionId)
        .order('sequence_order', { ascending: true });

      if (stepsError) throw stepsError;

      const steps = stepsData || [];
      const stepIds = steps.map((step) => step.id);
      let dependencies = [];
      let raci = [];
      let evidenceDefinitions = [];

      if (stepIds.length > 0) {
        const [dependenciesResult, raciResult, evidenceResult] = await Promise.all([
          supabase
            .from('defined_process_step_dependencies')
            .select('id, version_id, step_id, depends_on_step_id')
            .eq('version_id', versionId),
          supabase
            .from('defined_process_step_raci')
            .select('*')
            .in('step_id', stepIds),
          supabase
            .from('defined_process_step_evidence_defs')
            .select('id, step_id, evidence_type, title, description, is_mandatory')
            .in('step_id', stepIds),
        ]);

        if (dependenciesResult.error) throw dependenciesResult.error;
        if (raciResult.error) throw raciResult.error;
        if (evidenceResult.error) throw evidenceResult.error;

        dependencies = dependenciesResult.data || [];
        raci = raciResult.data || [];
        evidenceDefinitions = evidenceResult.data || [];
      }

      const profileIds = [...new Set([
        process.process_owner_id,
        process.created_by,
        version.created_by,
        version.published_by,
        ...raci.map((assignment) => assignment.user_id),
      ].filter(Boolean))];
      const departmentIds = [...new Set([
        process.department_id,
        ...raci.map((assignment) => assignment.department_id),
      ].filter(Boolean))];

      const [profilesResult, departmentsResult] = await Promise.all([
        profileIds.length > 0
          ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', profileIds)
          : Promise.resolve({ data: [], error: null }),
        departmentIds.length > 0
          ? supabase.from('departments').select('id, name, code, color').in('id', departmentIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (departmentsResult.error) throw departmentsResult.error;

      const profilesById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const departmentsById = new Map((departmentsResult.data || []).map((department) => [department.id, department]));
      const raciByStep = groupBy(raci, 'step_id');
      const dependenciesByStep = groupBy(dependencies, 'step_id');
      const evidenceByStep = groupBy(evidenceDefinitions, 'step_id');

      const enrichedSteps = steps.map((step) => ({
        ...step,
        dependencies: (dependenciesByStep[step.id] || []).map((dependency) => ({
          ...dependency,
          predecessor: steps.find((candidate) => candidate.id === dependency.depends_on_step_id) || null,
        })),
        evidence_definitions: evidenceByStep[step.id] || [],
        raci: (raciByStep[step.id] || []).map((assignment) => ({
          ...assignment,
          profile: assignment.user_id ? profilesById.get(assignment.user_id) || null : null,
          department: assignment.department_id ? departmentsById.get(assignment.department_id) || null : null,
        })),
      }));

      setDefinition({
        process: {
          ...process,
          department: departmentsById.get(process.department_id) || null,
          owner: profilesById.get(process.process_owner_id) || null,
          creator: profilesById.get(process.created_by) || null,
        },
        version: {
          ...version,
          publisher: version.published_by ? profilesById.get(version.published_by) || null : null,
          creator: profilesById.get(version.created_by) || null,
        },
        steps: enrichedSteps,
        dependencies,
        isLinear: isLinearProcessFlow(steps, dependencies),
      });
    } catch (loadError) {
      console.error('[useProcessDefinition] Error loading exact version:', loadError);
      setDefinition(null);
      setError(loadError.message || 'Failed to load this process definition.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, processId, versionId]);

  useEffect(() => {
    loadDefinition();
  }, [loadDefinition]);

  return {
    definition,
    loading,
    error,
    refetch: loadDefinition,
  };
}
