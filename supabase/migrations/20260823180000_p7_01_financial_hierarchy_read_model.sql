-- ==============================================================================
-- Package 7 / P7-01: Financial Hierarchy Read Model & Security Contract
--
-- Delivers the canonical, secure, and performant project-scoped Financial
-- Hierarchy Read Model (public.get_project_financial_hierarchy).
--
-- Key Architectural Invariants:
-- 1. Bounded single-request read model: loads complete project financial
--    hierarchy (Project summary, Phase summaries, Task List summaries, Task
--    direct/rollup spend, and inherited budget sources) in a single RPC.
-- 2. Strict Operational Visibility & Finance Authorization Intersection:
--    - Project must be operationally visible under OV1-A rules (returns NULL
--      if inaccessible).
--    - Operationally hidden Phases, Task Lists, Tasks, and Process Steps are
--      completely omitted from returned maps (never leaking UUID keys).
--    - Container financial summaries (Project, Phase, Task List) are exposed
--      strictly to authorized personas (Budget Managers, Finance Operators,
--      Project Owners, and Phase Owners for their respective scopes).
-- 3. Task Rollup Invariant:
--    - Tasks never own budgets.
--    - visible_rollup_spend sums direct spend of the task itself and only
--      caller-visible descendant Child Tasks and host-task-attached Process
--      Step Tasks, guaranteeing zero leakage or inference of hidden work.
--    - Cycle protection & recursion depth limit enforced.
-- 4. Financial Calculations & Security Baseline:
--    - Reuses canonical private.compute_financial_summary for container math.
--    - Public RPC is SECURITY INVOKER with SET search_path = ''.
--    - Private engine is SECURITY DEFINER in private schema, strictly bound
--      to auth.uid() without caller impersonation surface.
--    - 0 new public SECURITY DEFINER functions added.
-- ==============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Private Engine: private.get_project_financial_hierarchy_internal
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.get_project_financial_hierarchy_internal(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id               uuid := auth.uid();
  v_project               record;
  v_workspace_id          uuid;
  v_can_manage_budgets    boolean := false;
  v_is_finance_operator   boolean := false;
  v_is_project_owner      boolean := false;
  v_has_full_finance      boolean := false;
  v_financial_visibility  text := 'none';
  v_project_summary       jsonb := NULL;
  v_phase_summaries       jsonb := '{}'::jsonb;
  v_task_list_summaries   jsonb := '{}'::jsonb;
  v_tasks_map             jsonb := '{}'::jsonb;
  v_ph                    record;
  v_tl                    record;
BEGIN
  -- 1. Authentication guard
  IF v_user_id IS NULL OR p_project_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Project existence & workspace tenancy resolution
  SELECT p.id, p.workspace_id, p.owner_id
  INTO v_project
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_workspace_id := v_project.workspace_id;

  -- 3. Active workspace tenancy verification
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RETURN NULL;
  END IF;

  -- 4. Operational V1 project visibility gate (strict fail-closed)
  IF NOT (private.can_view_operational_project(p_project_id) OR private.has_owned_project_visibility(p_project_id)) THEN
    RETURN NULL;
  END IF;

  -- 5. Financial authority evaluation
  v_can_manage_budgets   := private.can_manage_budgets(v_workspace_id, v_user_id);
  v_is_finance_operator  := private.is_finance_operator(v_workspace_id, v_user_id);
  v_is_project_owner     := (v_project.owner_id = v_user_id);
  v_has_full_finance     := (v_can_manage_budgets OR v_is_finance_operator OR v_is_project_owner);

  -- 6. Project Container Financial Summary
  IF v_has_full_finance THEN
    v_project_summary := private.compute_financial_summary(v_workspace_id, p_project_id, NULL, NULL);
  ELSE
    v_project_summary := NULL;
  END IF;

  -- 7. Phase Container Financial Summaries (Only operationally visible AND finance-authorized phases)
  FOR v_ph IN
    SELECT ph.id, ph.owner_id
    FROM public.phases ph
    WHERE ph.project_id = p_project_id
    ORDER BY ph.position, ph.created_at
  LOOP
    -- Must be operationally visible to caller
    IF (private.can_view_operational_phase(v_ph.id) OR v_is_project_owner) THEN
      -- Must be finance authorized (Full manager/operator/project owner OR phase owner)
      IF v_has_full_finance OR (v_ph.owner_id = v_user_id) THEN
        v_phase_summaries := v_phase_summaries || jsonb_build_object(
          v_ph.id::text,
          private.compute_financial_summary(v_workspace_id, p_project_id, v_ph.id, NULL)
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. Task List Container Financial Summaries (Only operationally visible AND finance-authorized task lists)
  FOR v_tl IN
    SELECT tl.id, tl.phase_id, ph.owner_id AS phase_owner_id
    FROM public.task_lists tl
    LEFT JOIN public.phases ph ON ph.id = tl.phase_id
    WHERE tl.project_id = p_project_id
    ORDER BY tl.position, tl.created_at
  LOOP
    -- Must be operationally visible to caller
    IF (private.can_view_operational_task_list(v_tl.id) OR v_is_project_owner) THEN
      -- Must be finance authorized (Full manager/operator/project owner OR parent phase owner)
      IF v_has_full_finance OR (v_tl.phase_owner_id IS NOT NULL AND v_tl.phase_owner_id = v_user_id) THEN
        v_task_list_summaries := v_task_list_summaries || jsonb_build_object(
          v_tl.id::text,
          private.compute_financial_summary(v_workspace_id, p_project_id, v_tl.phase_id, v_tl.id)
        );
      END IF;
    END IF;
  END LOOP;

  -- 9. Task Financial Read Model & Rollup CTE
  -- Discover all tasks in project hierarchy that are operationally visible to caller
  WITH RECURSIVE project_budgets AS (
    SELECT id, entity_type, project_id, phase_id, task_list_id
    FROM public.budgets
    WHERE workspace_id = v_workspace_id
      AND project_id = p_project_id
  ),
  raw_project_tasks AS (
    SELECT
      t.id,
      t.project_id,
      COALESCE(t.phase_id, tl.phase_id, pi.phase_id) AS effective_phase_id,
      COALESCE(t.task_list_id, pi.task_list_id) AS effective_task_list_id,
      t.parent_task_id,
      t.process_instance_id,
      pi.parent_task_id AS host_task_id
    FROM public.tasks t
    LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
    LEFT JOIN public.process_instances pi ON pi.id = t.process_instance_id
    WHERE (
      t.project_id = p_project_id
      OR pi.project_id = p_project_id
      OR pi.parent_task_id IN (SELECT id FROM public.tasks WHERE project_id = p_project_id)
    )
  ),
  visible_tasks AS (
    SELECT
      rpt.id,
      rpt.project_id,
      rpt.effective_phase_id,
      rpt.effective_task_list_id,
      rpt.parent_task_id,
      rpt.process_instance_id,
      rpt.host_task_id,
      -- Direct spend: sum of leaf items for active/corrected transactions on this task
      -- Note: Subtask expenses recorded on subtasks of this task have et.task_id = rpt.id
      COALESCE((
        SELECT SUM(ei.amount)
        FROM public.expense_transactions et
        JOIN public.expense_items ei ON ei.transaction_id = et.id
        WHERE et.task_id = rpt.id
          AND et.status IN ('active', 'corrected')
      ), 0.00) AS direct_spend
    FROM raw_project_tasks rpt
    WHERE (
      private.can_view_operational_task(rpt.id)
      OR private.has_owned_project_visibility_for_task(rpt.id)
    )
  ),
  task_descendant_closure AS (
    -- Base case: each visible task is a descendant of itself (depth 0)
    SELECT
      vt.id AS root_task_id,
      vt.id AS descendant_task_id,
      0 AS depth,
      ARRAY[vt.id] AS path
    FROM visible_tasks vt

    UNION ALL

    -- Recursive case: child tasks (parent_task_id) and host-task process step tasks (host_task_id)
    SELECT
      tdc.root_task_id,
      child.id AS descendant_task_id,
      tdc.depth + 1,
      tdc.path || child.id
    FROM task_descendant_closure tdc
    JOIN visible_tasks child ON (
      child.parent_task_id = tdc.descendant_task_id
      OR
      (child.host_task_id IS NOT NULL AND child.host_task_id = tdc.descendant_task_id)
    )
    WHERE NOT (child.id = ANY(tdc.path)) -- Cycle protection
      AND tdc.depth < 50                 -- Bounded recursion limit
  ),
  task_rollup_aggregates AS (
    SELECT
      tdc.root_task_id AS task_id,
      SUM(vt.direct_spend) AS visible_rollup_spend
    FROM (
      SELECT DISTINCT root_task_id, descendant_task_id
      FROM task_descendant_closure
    ) tdc
    JOIN visible_tasks vt ON vt.id = tdc.descendant_task_id
    GROUP BY tdc.root_task_id
  ),
  task_source_resolutions AS (
    SELECT
      vt.id AS task_id,
      vt.direct_spend,
      COALESCE(tra.visible_rollup_spend, vt.direct_spend) AS visible_rollup_spend,
      -- Nearest budget source resolution: task_list -> phase -> project -> none
      CASE
        WHEN tlb.id IS NOT NULL THEN 'task_list'
        WHEN pb.id  IS NOT NULL THEN 'phase'
        WHEN pjb.id IS NOT NULL THEN 'project'
        ELSE 'none'
      END AS budget_source_type,
      COALESCE(tlb.id, pb.id, pjb.id, NULL) AS budget_source_id,
      CASE
        WHEN v_has_full_finance THEN 'full'
        WHEN vt.effective_phase_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.phases ph WHERE ph.id = vt.effective_phase_id AND ph.owner_id = v_user_id
        ) THEN 'full'
        ELSE 'task_only'
      END AS financial_visibility
    FROM visible_tasks vt
    LEFT JOIN task_rollup_aggregates tra ON tra.task_id = vt.id
    LEFT JOIN project_budgets tlb ON tlb.entity_type = 'task_list' AND tlb.task_list_id = vt.effective_task_list_id
    LEFT JOIN project_budgets pb  ON pb.entity_type = 'phase' AND pb.phase_id = vt.effective_phase_id
    LEFT JOIN project_budgets pjb ON pjb.entity_type = 'project' AND pjb.project_id = p_project_id
  )
  SELECT COALESCE(
    jsonb_object_agg(
      tsr.task_id::text,
      jsonb_build_object(
        'task_id',              tsr.task_id,
        'direct_spend',         tsr.direct_spend,
        'visible_rollup_spend', tsr.visible_rollup_spend,
        'budget_source_type',   tsr.budget_source_type,
        'budget_source_id',     tsr.budget_source_id,
        'financial_visibility', tsr.financial_visibility
      )
    ),
    '{}'::jsonb
  ) INTO v_tasks_map
  FROM task_source_resolutions tsr;

  -- 10. Compute overall financial_visibility classification
  IF v_has_full_finance THEN
    v_financial_visibility := 'full';
  ELSIF v_phase_summaries <> '{}'::jsonb THEN
    v_financial_visibility := 'partial';
  ELSIF v_tasks_map <> '{}'::jsonb THEN
    v_financial_visibility := 'task_only';
  ELSE
    v_financial_visibility := 'none';
  END IF;

  -- 11. Return canonical payload
  RETURN jsonb_build_object(
    'schema_version',       1,
    'project_id',           p_project_id,
    'workspace_id',         v_workspace_id,
    'financial_visibility', v_financial_visibility,
    'project_summary',      v_project_summary,
    'phase_summaries',      v_phase_summaries,
    'task_list_summaries',  v_task_list_summaries,
    'tasks',                v_tasks_map
  );
END;
$$;

-- Revoke all direct permissions from PUBLIC/anon
REVOKE ALL ON FUNCTION private.get_project_financial_hierarchy_internal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_project_financial_hierarchy_internal(uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Public API Wrapper: public.get_project_financial_hierarchy
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_project_financial_hierarchy(
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_project_financial_hierarchy_internal(p_project_id);
$$;

-- Grant execution to authenticated role; revoke from PUBLIC/anon
REVOKE ALL ON FUNCTION public.get_project_financial_hierarchy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_financial_hierarchy(uuid) TO authenticated;

COMMIT;
