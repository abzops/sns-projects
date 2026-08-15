-- SNS Projects — MVP Runtime History Table Grant Hardening
-- Revoke all direct mutation permissions from PUBLIC, anon, and authenticated
-- Grant SELECT ONLY to authenticated on runtime history tables

-- 1. task_responsible_completions
REVOKE ALL ON TABLE public.task_responsible_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_responsible_completions TO authenticated;

-- 2. task_consultation_responses
REVOKE ALL ON TABLE public.task_consultation_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_consultation_responses TO authenticated;

-- 3. task_evidence_submissions
REVOKE ALL ON TABLE public.task_evidence_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_evidence_submissions TO authenticated;

-- 4. task_approval_cycles
REVOKE ALL ON TABLE public.task_approval_cycles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_approval_cycles TO authenticated;

-- 5. process_audit_events
REVOKE ALL ON TABLE public.process_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.process_audit_events TO authenticated;
