-- P6-04C1 — Saved View Grant Hardening
-- Explicitly restricts table privileges on public.finance_explorer_saved_views
-- Authenticated role: SELECT, INSERT, UPDATE, DELETE (TRUNCATE, REFERENCES, TRIGGER revoked)
-- Anon and PUBLIC roles: All table privileges revoked

REVOKE ALL PRIVILEGES ON TABLE public.finance_explorer_saved_views FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.finance_explorer_saved_views TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.finance_explorer_saved_views FROM anon, PUBLIC;
