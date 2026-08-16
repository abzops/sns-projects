-- ============================================================================
-- Migration: fix_v1_03a_draft_save_identity
-- Description: Hotfix for save_defined_process_draft RPC
-- 1. Populates mandatory created_by column on defined_processes and defined_process_versions with p_actor_id.
-- 2. Evaluates system roles (project_admin, system_admin) directly against p_actor_id instead of auth.uid().
-- Security: SECURITY INVOKER, search_path = '', revoked from PUBLIC/anon/authenticated, service_role/postgres ONLY.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_defined_process_draft(
  p_workspace_id    uuid,
  p_actor_id        uuid,
  p_payload         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_caller_role          text;
  v_is_admin             boolean;
  v_is_dept_head         boolean;
  v_process_id           uuid;
  v_version_id           uuid;
  v_proc_name            text;
  v_proc_code            text;
  v_proc_desc            text;
  v_dept_id              uuid;
  v_owner_id             uuid;
  v_base_updated_at      timestamptz;
  v_steps_json           jsonb;
  v_process_record       RECORD;
  v_version_record       RECORD;
  v_existing_step_count  integer := 0;
  v_existing_edge_count  integer := 0;
  v_is_sequential_chain  boolean := true;
  v_step_elem            jsonb;
  v_step_id              uuid;
  v_step_code            text;
  v_step_title           text;
  v_seq_order            integer;
  v_duration             integer;
  v_approval_req         boolean;
  v_consultation_req     boolean;
  v_evidence_req         boolean;
  v_raci_array           jsonb;
  v_raci_elem            jsonb;
  v_raci_role            text;
  v_actor_type           text;
  v_user_id              uuid;
  v_resp_req             boolean;
  v_new_updated_at       timestamptz;
  v_prev_step_id         uuid := NULL;
  v_curr_step_id         uuid;
  v_dup_id               uuid;
  v_incoming_step_ids    uuid[];
  v_existing_step_ids    uuid[];
BEGIN
  -- 1. Caller verification
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Caller identity is required.';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = p_actor_id
    AND status = 'active';

  IF v_caller_role IS NULL OR v_caller_role = 'viewer' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: Caller is not authorized to edit or create process drafts in this workspace.';
  END IF;

  -- 2. Extract payload
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYLOAD: Payload is missing.';
  END IF;

  v_process_id      := NULLIF(p_payload->>'process_id', '')::uuid;
  v_version_id      := NULLIF(p_payload->>'version_id', '')::uuid;
  v_proc_name       := btrim(COALESCE(p_payload->'process'->>'name', ''));
  v_proc_code       := btrim(COALESCE(p_payload->'process'->>'code', ''));
  v_proc_desc       := p_payload->'process'->>'description';
  v_dept_id         := NULLIF(p_payload->'process'->>'department_id', '')::uuid;
  v_owner_id        := NULLIF(p_payload->'process'->>'process_owner_id', '')::uuid;
  v_base_updated_at := NULLIF(p_payload->>'base_updated_at', '')::timestamptz;
  v_steps_json      := COALESCE(p_payload->'steps', '[]'::jsonb);

  -- 3. Validate metadata
  IF v_proc_name = '' THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Process name is required.';
  END IF;

  IF v_proc_code = '' THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Process code is required.';
  END IF;

  IF v_dept_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = v_dept_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Selected department is invalid or does not belong to this workspace.';
  END IF;

  IF v_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = v_owner_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'ERR_VALIDATION: Process owner must be an active member of this workspace.';
  END IF;

  -- 4. Authorization check: Check caller role and direct user_system_roles using p_actor_id
  v_is_admin := (
    v_caller_role IN ('owner', 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.user_system_roles
      WHERE workspace_id = p_workspace_id
        AND user_id = p_actor_id
        AND role = 'project_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_system_roles
      WHERE workspace_id = p_workspace_id
        AND user_id = p_actor_id
        AND role = 'system_admin'
    )
  );

  SELECT EXISTS (
    SELECT 1 FROM public.department_memberships dm
    WHERE dm.department_id = v_dept_id
      AND dm.user_id = p_actor_id
      AND dm.role = 'head'
      AND dm.is_active = true
  ) INTO v_is_dept_head;

  -- Check unique name & code conflicts in workspace
  SELECT id INTO v_dup_id
  FROM public.defined_processes
  WHERE workspace_id = p_workspace_id
    AND code = v_proc_code
    AND (v_process_id IS NULL OR id <> v_process_id);

  IF v_dup_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_CONFLICT_CODE: Process code already exists in this workspace.';
  END IF;

  SELECT id INTO v_dup_id
  FROM public.defined_processes
  WHERE workspace_id = p_workspace_id
    AND name = v_proc_name
    AND (v_process_id IS NULL OR id <> v_process_id);

  IF v_dup_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_CONFLICT_NAME: Process name already exists in this workspace.';
  END IF;

  -- 5. Process & Version Creation / Updating
  IF v_process_id IS NULL THEN
    -- Creating a new process
    IF NOT (v_is_admin OR v_is_dept_head) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: You do not have permission to create processes for this department.';
    END IF;

    INSERT INTO public.defined_processes (
      workspace_id,
      department_id,
      name,
      code,
      description,
      process_owner_id,
      created_by,
      is_active
    ) VALUES (
      p_workspace_id,
      v_dept_id,
      v_proc_name,
      v_proc_code,
      v_proc_desc,
      v_owner_id,
      p_actor_id,
      true
    ) RETURNING id INTO v_process_id;

    INSERT INTO public.defined_process_versions (
      defined_process_id,
      version_number,
      status,
      change_summary,
      created_by
    ) VALUES (
      v_process_id,
      1,
      'draft',
      'Initial draft',
      p_actor_id
    ) RETURNING id INTO v_version_id;

  ELSE
    -- Updating existing process
    SELECT * INTO v_process_record
    FROM public.defined_processes
    WHERE id = v_process_id AND workspace_id = p_workspace_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_NOT_FOUND: Defined process not found in this workspace.';
    END IF;

    -- If moving department, caller must head both or be admin
    IF v_process_record.department_id <> v_dept_id THEN
      IF NOT (v_is_admin OR (v_is_dept_head AND EXISTS (
        SELECT 1 FROM public.department_memberships dm
        WHERE dm.department_id = v_process_record.department_id
          AND dm.user_id = p_actor_id
          AND dm.role = 'head'
          AND dm.is_active = true
      ))) THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: You cannot move this process to a department you do not head.';
      END IF;
    END IF;

    -- Caller must be admin, owning dept head, or process owner
    IF NOT (
      v_is_admin
      OR v_is_dept_head
      OR EXISTS (
        SELECT 1 FROM public.department_memberships dm
        WHERE dm.department_id = v_process_record.department_id
          AND dm.user_id = p_actor_id
          AND dm.role = 'head'
          AND dm.is_active = true
      )
      OR v_process_record.process_owner_id = p_actor_id
    ) THEN
      RAISE EXCEPTION 'ERR_FORBIDDEN: You do not have permission to edit this process draft.';
    END IF;

    UPDATE public.defined_processes
    SET department_id = v_dept_id,
        name = v_proc_name,
        code = v_proc_code,
        description = v_proc_desc,
        process_owner_id = v_owner_id,
        updated_at = now()
    WHERE id = v_process_id;

    -- Resolve draft version
    IF v_version_id IS NULL THEN
      SELECT id, status, updated_at INTO v_version_record
      FROM public.defined_process_versions
      WHERE defined_process_id = v_process_id AND status = 'draft'
      ORDER BY version_number DESC
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.defined_process_versions (
          defined_process_id,
          version_number,
          status,
          change_summary,
          created_by
        ) VALUES (
          v_process_id,
          1,
          'draft',
          'Initial draft',
          p_actor_id
        ) RETURNING id INTO v_version_id;
      ELSE
        v_version_id := v_version_record.id;
      END IF;
    ELSE
      -- Lock draft version for concurrency check
      SELECT * INTO v_version_record
      FROM public.defined_process_versions
      WHERE id = v_version_id AND defined_process_id = v_process_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_NOT_FOUND: Process version not found.';
      END IF;

      IF v_version_record.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: Cannot edit a published or archived process version.';
      END IF;

      -- Optimistic concurrency check
      IF v_base_updated_at IS NOT NULL AND v_version_record.updated_at > v_base_updated_at THEN
        RAISE EXCEPTION 'DRAFT_CONCURRENCY_CONFLICT: This draft changed since you opened it. Reload before saving.';
      END IF;
    END IF;
  END IF;

  -- 6. Custom DAG Detection
  SELECT count(*) INTO v_existing_step_count
  FROM public.defined_process_steps
  WHERE version_id = v_version_id;

  SELECT count(*) INTO v_existing_edge_count
  FROM public.defined_process_step_dependencies
  WHERE version_id = v_version_id;

  IF v_existing_step_count <= 1 THEN
    v_is_sequential_chain := true;
  ELSE
    -- Graph is strictly sequential if exactly (step_count - 1) edges exist AND every edge connects sequence N to sequence N-1
    v_is_sequential_chain := (
      v_existing_edge_count = (v_existing_step_count - 1)
      AND NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies d
        JOIN public.defined_process_steps s ON s.id = d.step_id
        JOIN public.defined_process_steps p ON p.id = d.depends_on_step_id
        WHERE d.version_id = v_version_id
          AND s.sequence_order <> (p.sequence_order + 1)
      )
    );
  END IF;

  -- If CUSTOM FLOW, verify that incoming steps do not attempt structural mutations
  IF NOT v_is_sequential_chain THEN
    SELECT array_agg(id ORDER BY sequence_order) INTO v_existing_step_ids
    FROM public.defined_process_steps
    WHERE version_id = v_version_id;

    SELECT array_agg((elem->>'id')::uuid) INTO v_incoming_step_ids
    FROM jsonb_array_elements(v_steps_json) elem;

    IF array_length(v_incoming_step_ids, 1) <> v_existing_step_count
       OR v_incoming_step_ids IS DISTINCT FROM v_existing_step_ids THEN
      RAISE EXCEPTION 'ERR_CUSTOM_DAG_STRUCTURAL_LOCK: This process uses a custom dependency flow. Structural step addition, deletion, or reordering cannot be performed in V1-03A.';
    END IF;
  END IF;

  -- 7. Two-Phase Safe Step Synchronization
  -- Phase A: Shift existing steps sequence_order by +100000 to avoid unique constraint collisions during reordering
  UPDATE public.defined_process_steps
  SET sequence_order = sequence_order + 100000
  WHERE version_id = v_version_id;

  -- Phase B: Delete steps that were intentionally removed in the client
  IF jsonb_array_length(v_steps_json) > 0 THEN
    DELETE FROM public.defined_process_steps
    WHERE version_id = v_version_id
      AND id NOT IN (
        SELECT (elem->>'id')::uuid
        FROM jsonb_array_elements(v_steps_json) elem
        WHERE (elem->>'id') IS NOT NULL AND (elem->>'id') <> ''
      );
  ELSE
    DELETE FROM public.defined_process_steps
    WHERE version_id = v_version_id;
  END IF;

  -- Phase C: Upsert steps and synchronize RACI
  v_seq_order := 0;
  FOR v_step_elem IN SELECT * FROM jsonb_array_elements(v_steps_json)
  LOOP
    v_seq_order := v_seq_order + 1;
    v_step_id          := NULLIF(v_step_elem->>'id', '')::uuid;
    v_step_code        := btrim(COALESCE(v_step_elem->>'step_code', 'STP-' || lpad(v_seq_order::text, 3, '0')));
    v_step_title       := btrim(COALESCE(v_step_elem->>'title', ''));
    v_duration         := GREATEST(1, COALESCE((v_step_elem->>'expected_duration_days')::integer, 1));
    v_approval_req     := COALESCE((v_step_elem->>'approval_required')::boolean, false);
    v_consultation_req := COALESCE((v_step_elem->>'consultation_required')::boolean, false);
    v_evidence_req     := COALESCE((v_step_elem->>'evidence_required')::boolean, false);

    IF v_step_id IS NULL THEN
      v_step_id := gen_random_uuid();
    END IF;

    -- Upsert step record
    INSERT INTO public.defined_process_steps (
      id,
      version_id,
      step_code,
      title,
      description,
      sequence_order,
      expected_duration_days,
      approval_required,
      consultation_required,
      evidence_required
    ) VALUES (
      v_step_id,
      v_version_id,
      v_step_code,
      v_step_title,
      v_step_elem->>'description',
      v_seq_order,
      v_duration,
      v_approval_req,
      v_consultation_req,
      v_evidence_req
    )
    ON CONFLICT (id) DO UPDATE SET
      step_code              = EXCLUDED.step_code,
      title                  = EXCLUDED.title,
      description            = EXCLUDED.description,
      sequence_order         = EXCLUDED.sequence_order,
      expected_duration_days = EXCLUDED.expected_duration_days,
      approval_required      = EXCLUDED.approval_required,
      consultation_required  = EXCLUDED.consultation_required,
      evidence_required      = EXCLUDED.evidence_required,
      updated_at             = now();

    -- Synchronize RACI for this step
    DELETE FROM public.defined_process_step_raci WHERE step_id = v_step_id;

    v_raci_array := COALESCE(v_step_elem->'raci', '[]'::jsonb);
    FOR v_raci_elem IN SELECT * FROM jsonb_array_elements(v_raci_array)
    LOOP
      v_raci_role  := v_raci_elem->>'raci_role';
      v_actor_type := COALESCE(v_raci_elem->>'actor_type', 'user');
      v_user_id    := NULLIF(v_raci_elem->>'user_id', '')::uuid;
      v_resp_req   := COALESCE((v_raci_elem->>'response_required')::boolean, false);

      IF v_raci_role NOT IN ('R', 'A', 'C', 'I') THEN
        RAISE EXCEPTION 'ERR_VALIDATION: Invalid RACI role %', v_raci_role;
      END IF;

      IF v_actor_type = 'process_starter' THEN
        IF v_raci_role <> 'R' THEN
          RAISE EXCEPTION 'ERR_VALIDATION: Process Starter can only be assigned to Responsible (R).';
        END IF;
        v_user_id := NULL;
        v_resp_req := false;
      ELSIF v_actor_type = 'user' THEN
        IF v_user_id IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE workspace_id = p_workspace_id AND user_id = v_user_id AND status = 'active'
          ) THEN
            RAISE EXCEPTION 'ERR_VALIDATION: Assigned RACI user % is not an active workspace member.', v_user_id;
          END IF;
        END IF;
      ELSE
        RAISE EXCEPTION 'ERR_VALIDATION: Invalid actor_type %', v_actor_type;
      END IF;

      IF v_actor_type = 'process_starter' OR v_user_id IS NOT NULL THEN
        INSERT INTO public.defined_process_step_raci (
          step_id,
          raci_role,
          actor_type,
          user_id,
          response_required
        ) VALUES (
          v_step_id,
          v_raci_role,
          v_actor_type,
          v_user_id,
          CASE WHEN v_raci_role = 'C' THEN v_resp_req ELSE false END
        );
      END IF;
    END LOOP;
  END LOOP;

  -- 8. Dependency Synchronization
  -- If sequential chain, regenerate linear dependencies (Step 1 = root, Step N depends on Step N-1)
  IF v_is_sequential_chain THEN
    DELETE FROM public.defined_process_step_dependencies WHERE version_id = v_version_id;

    v_prev_step_id := NULL;
    FOR v_curr_step_id IN
      SELECT id FROM public.defined_process_steps
      WHERE version_id = v_version_id
      ORDER BY sequence_order ASC
    LOOP
      IF v_prev_step_id IS NOT NULL THEN
        INSERT INTO public.defined_process_step_dependencies (
          version_id,
          step_id,
          depends_on_step_id
        ) VALUES (
          v_version_id,
          v_curr_step_id,
          v_prev_step_id
        );
      END IF;
      v_prev_step_id := v_curr_step_id;
    END LOOP;
  END IF;

  -- 9. Touch version to advance authoritative updated_at revision token
  UPDATE public.defined_process_versions
  SET updated_at = now()
  WHERE id = v_version_id
  RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object(
    'success', true,
    'process_id', v_process_id,
    'version_id', v_version_id,
    'updated_at', v_new_updated_at
  );
END;
$$;

-- Security hardening: Invoker-only, revoked from public/anon/authenticated, service_role only
REVOKE ALL ON FUNCTION public.save_defined_process_draft(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_defined_process_draft(uuid, uuid, jsonb) TO service_role, postgres;
