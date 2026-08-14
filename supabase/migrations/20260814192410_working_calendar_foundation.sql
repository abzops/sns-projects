-- SNS Projects — DP-1-C: Company Working Calendar + Holiday Foundation
-- Scope: public.workspace_working_calendars and public.workspace_holidays tables only.
-- Enforces single-calendar per workspace, weekday validation, non-working holidays, and least-privilege SELECT-only RLS.

-- ============================================================================
-- 1. TABLE: public.workspace_working_calendars
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_working_calendars (
  workspace_id      uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  timezone          text NOT NULL,
  monday_working    boolean NOT NULL DEFAULT true,
  tuesday_working   boolean NOT NULL DEFAULT true,
  wednesday_working boolean NOT NULL DEFAULT true,
  thursday_working  boolean NOT NULL DEFAULT true,
  friday_working    boolean NOT NULL DEFAULT true,
  saturday_working  boolean NOT NULL DEFAULT false,
  sunday_working    boolean NOT NULL DEFAULT false,
  created_by        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Structural constraints
  CONSTRAINT chk_workspace_working_calendars_timezone CHECK (btrim(timezone) <> ''),
  CONSTRAINT chk_workspace_working_calendars_at_least_one_day CHECK (
    monday_working OR tuesday_working OR wednesday_working OR
    thursday_working OR friday_working OR saturday_working OR sunday_working
  )
);

COMMENT ON TABLE public.workspace_working_calendars IS 'Company-wide working calendar configuration defining working weekdays and timezone per workspace.';

CREATE INDEX IF NOT EXISTS idx_workspace_working_calendars_created_by
  ON public.workspace_working_calendars (created_by);

DROP TRIGGER IF EXISTS trg_workspace_working_calendars_updated_at ON public.workspace_working_calendars;
CREATE TRIGGER trg_workspace_working_calendars_updated_at
  BEFORE UPDATE ON public.workspace_working_calendars
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ============================================================================
-- 2. TABLE: public.workspace_holidays
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspace_working_calendars(workspace_id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name         text NOT NULL,
  description  text,
  created_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Structural constraints
  CONSTRAINT chk_workspace_holidays_name CHECK (btrim(name) <> ''),
  CONSTRAINT uq_workspace_holidays_workspace_date UNIQUE (workspace_id, holiday_date)
);

COMMENT ON TABLE public.workspace_holidays IS 'Company non-working holiday dates declared per workspace calendar.';

CREATE INDEX IF NOT EXISTS idx_workspace_holidays_created_by
  ON public.workspace_holidays (created_by);

DROP TRIGGER IF EXISTS trg_workspace_holidays_updated_at ON public.workspace_holidays;
CREATE TRIGGER trg_workspace_holidays_updated_at
  BEFORE UPDATE ON public.workspace_holidays
  FOR EACH ROW
  EXECUTE FUNCTION private.trg_fn_set_updated_at();

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) & PRIVILEGES (LEAST PRIVILEGE: SELECT ONLY)
-- ============================================================================
ALTER TABLE public.workspace_working_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_holidays ENABLE ROW LEVEL SECURITY;

-- Revoke all direct permissions from PUBLIC and anon
REVOKE ALL ON TABLE public.workspace_working_calendars FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.workspace_holidays FROM PUBLIC, anon, authenticated;

-- Grant SELECT only to authenticated users
GRANT SELECT ON TABLE public.workspace_working_calendars TO authenticated;
GRANT SELECT ON TABLE public.workspace_holidays TO authenticated;

-- workspace_working_calendars: Active workspace members can read calendar configuration
DROP POLICY IF EXISTS "workspace_working_calendars_select_member" ON public.workspace_working_calendars;
CREATE POLICY "workspace_working_calendars_select_member"
  ON public.workspace_working_calendars
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_workspace_active_member(workspace_working_calendars.workspace_id))
  );

-- workspace_holidays: Active workspace members can read company holidays
DROP POLICY IF EXISTS "workspace_holidays_select_member" ON public.workspace_holidays;
CREATE POLICY "workspace_holidays_select_member"
  ON public.workspace_holidays
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_workspace_active_member(workspace_holidays.workspace_id))
  );
