-- SNS Projects — Package 2 / P2-01A: Phase Grant Hardening
-- Revoke non-essential DDL/administrative table privileges (TRUNCATE, REFERENCES, TRIGGER) from authenticated on public.phases.
-- Preserve standard application CRUD (SELECT, INSERT, UPDATE, DELETE) for authenticated users.
-- Preserve full administrative privileges for service_role and postgres.
-- Preserve zero direct table privileges for anon and PUBLIC.

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.phases
FROM authenticated;
