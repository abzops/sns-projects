-- ============================================================================
-- Migration: 20260816112232_organization_admin_v1_01.sql
-- Description: SNS Projects V1-01 - Real Users & Organization Administration
--   1. Create Finance (FIN) and Supply Chain (SCM) departments idempotently
--   2. Apply existing owner (Abhinand) organization mapping:
--      - Workspace Role: Owner
--      - Department: Software & IT (Head, Primary)
--      - System Roles: project_admin, system_admin
-- ============================================================================

DO $$
DECLARE
  v_workspace_id UUID := 'dbcaddf1-cf02-4bad-8af1-974301cdfbea'::UUID;
  v_owner_user_id UUID := '00ae89c1-353b-4367-827e-9817343140d1'::UUID;
  v_swit_dept_id UUID;
  v_fin_dept_id UUID;
  v_scm_dept_id UUID;
BEGIN
  -- 1. Ensure target workspace exists
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id) THEN
    RAISE NOTICE 'Target workspace % does not exist, skipping data population', v_workspace_id;
    RETURN;
  END IF;

  -- 2. Create Finance (FIN) department if not present
  INSERT INTO public.departments (
    workspace_id,
    code,
    name,
    description,
    color,
    is_active,
    created_by
  )
  VALUES (
    v_workspace_id,
    'FIN',
    'Finance',
    'Financial planning, accounting, budgets, and fiscal compliance',
    '#ff8c42',
    true,
    v_owner_user_id
  )
  ON CONFLICT (workspace_id, code) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = COALESCE(public.departments.description, EXCLUDED.description),
    color = COALESCE(public.departments.color, EXCLUDED.color),
    is_active = true,
    updated_at = clock_timestamp()
  RETURNING id INTO v_fin_dept_id;

  -- 3. Create Supply Chain (SCM) department if not present
  INSERT INTO public.departments (
    workspace_id,
    code,
    name,
    description,
    color,
    is_active,
    created_by
  )
  VALUES (
    v_workspace_id,
    'SCM',
    'Supply Chain',
    'Supply chain management, logistics, warehousing, and inventory distribution',
    '#2dd4bf',
    true,
    v_owner_user_id
  )
  ON CONFLICT (workspace_id, code) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = COALESCE(public.departments.description, EXCLUDED.description),
    color = COALESCE(public.departments.color, EXCLUDED.color),
    is_active = true,
    updated_at = clock_timestamp()
  RETURNING id INTO v_scm_dept_id;

  -- 4. Retrieve SWIT department ID
  SELECT id INTO v_swit_dept_id
  FROM public.departments
  WHERE workspace_id = v_workspace_id AND code = 'SWIT';

  -- 5. Ensure owner workspace_members record is active owner
  INSERT INTO public.workspace_members (
    workspace_id,
    user_id,
    role,
    status
  )
  VALUES (
    v_workspace_id,
    v_owner_user_id,
    'owner',
    'active'
  )
  ON CONFLICT (workspace_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
  SET
    role = 'owner',
    status = 'active';

  -- 6. Apply owner department membership: Software & IT -> Head, Primary
  IF v_swit_dept_id IS NOT NULL THEN
    INSERT INTO public.department_memberships (
      workspace_id,
      department_id,
      user_id,
      role,
      is_primary,
      is_active
    )
    VALUES (
      v_workspace_id,
      v_swit_dept_id,
      v_owner_user_id,
      'head',
      true,
      true
    )
    ON CONFLICT (department_id, user_id) DO UPDATE
    SET
      role = 'head',
      is_primary = true,
      is_active = true,
      updated_at = clock_timestamp();
  END IF;

  -- 7. Apply owner system roles: project_admin, system_admin
  INSERT INTO public.user_system_roles (
    workspace_id,
    user_id,
    role,
    created_by
  )
  VALUES
    (v_workspace_id, v_owner_user_id, 'project_admin', v_owner_user_id),
    (v_workspace_id, v_owner_user_id, 'system_admin', v_owner_user_id)
  ON CONFLICT (workspace_id, user_id, role) DO NOTHING;

END $$;
