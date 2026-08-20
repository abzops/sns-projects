-- Migration: 20260820082034_p5_03b_subtask_rpc_execution_hotfix.sql
-- Description: P5-03B Subtask RPC Execution ACL Hotfix
--              Restores authenticated execution permission on
--              private.complete_subtask_with_expense_internal so that
--              the public.complete_subtask_with_expense SECURITY INVOKER
--              wrapper can execute the hardened private engine.

-- 1. Private Engine ACL (SECURITY DEFINER, search_path = '')
REVOKE ALL ON FUNCTION private.complete_subtask_with_expense_internal(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_subtask_with_expense_internal(uuid, jsonb, text) TO authenticated, service_role, postgres;

-- 2. Public Wrapper ACL (SECURITY INVOKER)
REVOKE ALL ON FUNCTION public.complete_subtask_with_expense(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_subtask_with_expense(uuid, jsonb, text) TO authenticated, service_role, postgres;

-- 3. Comment confirmation
COMMENT ON FUNCTION public.complete_subtask_with_expense(uuid, jsonb, text) IS
  'P5-03 / P5-03B: Atomically completes a subtask with optional operational expense and evaluates parent task closure.';
