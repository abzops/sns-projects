-- SNS Projects — Package 1 / P1-01A: Process Instance Access Hardening
-- Migration: 20260817064609_p1_01_process_instance_access_hardening.sql
-- 
-- Summary:
-- 1. Hardens public.process_instances permissions to strict fail-closed state.
-- 2. Revokes all direct table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) from PUBLIC, anon, and authenticated.
-- 3. Drops overly broad workspace-member SELECT policy ("process_instances_select_member").
-- 4. Retains database-level access strictly for postgres and service_role.
-- 5. Preserves fail-closed posture until P1-02 implements granular placement and RACI authorization rules.

-- 1. Drop overly broad SELECT policy
DROP POLICY IF EXISTS "process_instances_select_member" ON public.process_instances;

-- 2. Ensure RLS remains enabled
ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;

-- 3. Revoke all direct table privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon, authenticated;

-- 4. Explicitly grant backend/engine privileges only to internal administrative roles
GRANT ALL ON TABLE public.process_instances TO service_role, postgres;

COMMENT ON TABLE public.process_instances IS 'Explicit runtime container for executed Defined Processes (Access hardened: Direct client access revoked until P1-02 placement/RACI rules are implemented).';
