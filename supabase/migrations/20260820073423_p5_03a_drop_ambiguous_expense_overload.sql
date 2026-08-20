-- Migration: 20260820073423_p5_03a_drop_ambiguous_expense_overload.sql
-- Description: P5-03A Hotfix — Drop the old 7-arg overload of
--              private.insert_expense_transaction_internal that was created
--              by P5-01 / P5-01B. The P5-03 migration replaced it with a
--              compatible 8-arg version (adding p_subtask_id DEFAULT NULL),
--              but the old 7-arg signature still exists as a separate overload,
--              creating PostgreSQL overload resolution ambiguity (error 42725)
--              when callers pass NULL as the 7th arg.
--
--              Fix: explicitly DROP the old 7-arg overload. The 8-arg version
--              (p_subtask_id DEFAULT NULL) is a strict superset and handles
--              all existing callers that previously relied on the 7-arg variant.

DROP FUNCTION IF EXISTS private.insert_expense_transaction_internal(
  uuid,   -- p_workspace_id
  uuid,   -- p_task_id
  date,   -- p_expense_date
  text,   -- p_description
  jsonb,  -- p_items
  uuid,   -- p_actor_id
  integer -- p_cycle_number (old 7-arg: no p_subtask_id)
);

-- Ensure authenticated role can invoke the internal subtask completion routine
REVOKE ALL ON FUNCTION private.complete_subtask_with_expense_internal(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_subtask_with_expense_internal(uuid, jsonb, text) TO authenticated, service_role, postgres;

