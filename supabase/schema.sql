--
-- PostgreSQL database dump
--

\restrict YzZj51NVVo5TKUwCbLP34byPMJscIPyiJ2DNgD6DgDkqEm9q855fufQbv328nZC

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('request.jwt.claim.email', true), '')::text;
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
    raise debug 'PgBouncer auth request: %', p_usename;

    return query
    select 
        rolname::text, 
        case when rolvaliduntil < now() 
            then null 
            else rolpassword::text 
        end 
    from pg_authid 
    where rolname=$1 and rolcanlogin;
end;
$_$;


--
-- Name: add_working_days(uuid, date, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.add_working_days(p_workspace_id uuid, p_start_date date, p_duration_days integer) RETURNS date
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_cal RECORD;
  v_curr_date date;
  v_working_counted integer := 0;
  v_dow integer;
  v_is_working boolean;
  v_is_holiday boolean;
BEGIN
  IF p_duration_days IS NULL OR p_duration_days < 1 THEN
    RAISE EXCEPTION 'Duration must be at least 1 working day.';
  END IF;

  SELECT * INTO v_cal
  FROM public.workspace_working_calendars
  WHERE workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Working calendar is not configured for this workspace.';
  END IF;

  v_curr_date := p_start_date;

  WHILE v_working_counted < p_duration_days LOOP
    -- Extract day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    v_dow := EXTRACT(DOW FROM v_curr_date);

    v_is_working := CASE v_dow
      WHEN 0 THEN v_cal.sunday_working
      WHEN 1 THEN v_cal.monday_working
      WHEN 2 THEN v_cal.tuesday_working
      WHEN 3 THEN v_cal.wednesday_working
      WHEN 4 THEN v_cal.thursday_working
      WHEN 5 THEN v_cal.friday_working
      WHEN 6 THEN v_cal.saturday_working
      ELSE false
    END;

    IF v_is_working THEN
      SELECT EXISTS (
        SELECT 1 FROM public.workspace_holidays
        WHERE workspace_id = p_workspace_id AND holiday_date = v_curr_date
      ) INTO v_is_holiday;

      IF NOT v_is_holiday THEN
        v_working_counted := v_working_counted + 1;
        IF v_working_counted = p_duration_days THEN
          RETURN v_curr_date;
        END IF;
      END IF;
    END IF;

    v_curr_date := v_curr_date + 1;
  END LOOP;

  RETURN v_curr_date;
END;
$$;


--
-- Name: can_administer_workspace(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_administer_workspace(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT (
    private.get_user_workspace_role(p_workspace_id) IN ('owner', 'admin')
    OR private.has_system_role(p_workspace_id, 'system_admin')
  );
$$;


--
-- Name: can_read_process_instance(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_read_process_instance(p_instance_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instance RECORD;
  v_user_id  uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_instance FROM public.process_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 1. Direct Starter or Process Owner match
  IF v_instance.started_by = v_user_id OR v_instance.owner_id = v_user_id THEN
    RETURN true;
  END IF;

  -- 2. Workspace Executive / Admin oversight
  IF (SELECT private.can_administer_workspace(v_instance.workspace_id))
     OR (SELECT private.has_system_role(v_instance.workspace_id, 'ceo'))
     OR (SELECT private.has_system_role(v_instance.workspace_id, 'cto')) THEN
    RETURN true;
  END IF;

  -- 3. RACI Participant on ANY task belonging to this process instance
  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.task_raci_assignments ra ON ra.task_id = t.id
    WHERE t.process_instance_id = p_instance_id
      AND (
        ra.user_id = v_user_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_user_id
            AND dm.is_active = true
        )
      )
  ) THEN
    RETURN true;
  END IF;

  -- 4. Placement-specific visibility for attached Project hierarchy processes
  -- (Standalone processes do NOT have general workspace visibility)
  IF v_instance.placement_type <> 'standalone' AND v_instance.project_id IS NOT NULL THEN
    IF (SELECT private.is_workspace_active_member(v_instance.workspace_id)) THEN
      IF EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = v_instance.project_id
          AND (
            p.owner_id = v_user_id
            OR EXISTS (
              SELECT 1 FROM public.project_members pm
              WHERE pm.project_id = p.id AND pm.user_id = v_user_id
            )
            OR (SELECT private.get_user_workspace_role(v_instance.workspace_id)) IN ('owner', 'admin')
          )
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;


--
-- Name: can_start_process_version(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_start_process_version(p_version_id uuid, p_caller_id uuid, p_workspace_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version          RECORD;
  v_root_step        RECORD;
  v_caller_is_root_r boolean := false;
BEGIN
  IF p_caller_id IS NULL OR p_workspace_id IS NULL OR p_version_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Validate version status is published
  SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id;
  IF NOT FOUND OR v_version.status <> 'published' THEN
    RETURN false;
  END IF;

  -- 2. Executive Override: Workspace Owner/Admin or System Admin / CEO / CTO
  IF (SELECT private.can_administer_workspace(p_workspace_id))
     OR (SELECT private.has_system_role(p_workspace_id, 'ceo'))
     OR (SELECT private.has_system_role(p_workspace_id, 'cto')) THEN
    RETURN true;
  END IF;

  -- 3. Workspace Role Gate: Viewers can NEVER start processes
  IF (SELECT private.get_user_workspace_role(p_workspace_id)) NOT IN ('owner', 'admin', 'member') THEN
    RETURN false;
  END IF;

  -- 4. Normal Starter Check: Must be in resolved Responsible (R) set on Root Step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.defined_process_step_raci r
    WHERE r.step_id = v_root_step.id
      AND r.raci_role = 'R'
      AND (
        (r.actor_type = 'user' AND r.user_id = p_caller_id)
        OR (r.actor_type = 'process_starter')
        OR (
          r.actor_type = 'department' AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = r.department_id
              AND dm.user_id = p_caller_id
              AND dm.is_active = true
          )
        )
      )
  ) INTO v_caller_is_root_r;

  IF NOT v_caller_is_root_r THEN
    RETURN false;
  END IF;

  -- 5. Dynamic R/A Separation on Approval-Required Steps
  IF EXISTS (
    SELECT 1
    FROM public.defined_process_steps s
    JOIN public.defined_process_step_raci r_ps
      ON r_ps.step_id = s.id AND r_ps.actor_type = 'process_starter' AND r_ps.raci_role = 'R'
    JOIN public.defined_process_step_raci a_usr
      ON a_usr.step_id = s.id AND a_usr.raci_role = 'A'
    WHERE s.version_id = p_version_id
      AND s.approval_required = true
      AND (
        a_usr.user_id = p_caller_id
        OR (
          a_usr.actor_type = 'department' AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = a_usr.department_id
              AND dm.user_id = p_caller_id
              AND dm.is_active = true
          )
        )
      )
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;


--
-- Name: complete_responsible_part_internal(uuid, integer, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.complete_responsible_part_internal(p_task_id uuid, p_cycle_number integer, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id        uuid;
  v_task             RECORD;
  v_instance         RECORD;
  v_task_list        RECORD;
  v_project          RECORD;
  v_step             RECORD;
  v_workspace_id     uuid;
  v_process_name     text;
  v_is_r             boolean;
  v_unresponded_c    integer;
  v_missing_e        integer;
  v_recipient        RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state NOT IN ('ready', 'active', 'rework_required') THEN
    RAISE EXCEPTION 'Task is not in an actionable state (current state: %).', v_task.workflow_state;
  END IF;

  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;
  END IF;

  -- Check Caller is assigned Responsible (R)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'R'
      AND (
        ra.user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_caller_id
            AND dm.is_active = true
        )
      )
  ) INTO v_is_r;

  IF NOT v_is_r THEN
    RAISE EXCEPTION 'Caller is not an assigned Responsible user for this task.';
  END IF;

  SELECT * INTO v_step FROM public.defined_process_steps WHERE id = v_task.process_step_id;

  -- Preflight: Consultation requirements
  IF v_step.consultation_required THEN
    SELECT count(*) INTO v_unresponded_c
    FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'C'
      AND ra.response_required = true
      AND NOT EXISTS (
        SELECT 1 FROM public.task_consultation_responses cr
        WHERE cr.task_id = p_task_id
          AND cr.cycle_number = p_cycle_number
          AND cr.user_id = ra.user_id
      );

    IF v_unresponded_c > 0 THEN
      RAISE EXCEPTION 'Cannot complete: % required consultation response(s) are pending.', v_unresponded_c;
    END IF;
  END IF;

  -- Preflight: Evidence requirements
  SELECT count(*) INTO v_missing_e
  FROM public.defined_process_step_evidence_defs ed
  WHERE ed.step_id = v_step.id
    AND ed.is_mandatory = true
    AND NOT EXISTS (
      SELECT 1 FROM public.task_evidence_submissions es
      WHERE es.task_id = p_task_id
        AND es.cycle_number = p_cycle_number
        AND es.evidence_def_id = ed.id
    );

  IF v_missing_e > 0 THEN
    RAISE EXCEPTION 'Cannot complete: % mandatory evidence item(s) are missing.', v_missing_e;
  END IF;

  -- Record responsible completion
  INSERT INTO public.task_responsible_completions (
    task_id, cycle_number, user_id, completion_note
  ) VALUES (
    p_task_id, p_cycle_number, v_caller_id, p_notes
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET completion_note = p_notes, completed_at = now();

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_RESPONSIBLE_COMPLETED', v_caller_id,
    jsonb_build_object('step_id', v_step.id, 'cycle_number', p_cycle_number)
  );

  -- Branch: Approval Required vs Direct Advance
  IF v_step.approval_required THEN
    PERFORM set_config('sns.process_engine_write', 'on', true);
    UPDATE public.tasks
    SET workflow_state = 'awaiting_approval',
        updated_at = now()
    WHERE id = p_task_id;

    -- Ensure approval cycle record exists
    INSERT INTO public.task_approval_cycles (
      task_id, cycle_number, status
    ) VALUES (
      p_task_id, p_cycle_number, 'pending'
    )
    ON CONFLICT (task_id, cycle_number)
    DO UPDATE SET status = 'pending', decided_at = NULL, decided_by = NULL, decision_reason = NULL;

    -- Notify Accountable users
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.raci_role = 'A' AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'approval_required',
        'Approval required: ' || v_task.title,
        'Task "' || v_task.title || '" has completed work and is awaiting your approval.',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    RETURN jsonb_build_object(
      'status', 'in_review',
      'task_id', p_task_id,
      'cycle_number', p_cycle_number
    );
  ELSE
    -- Directly advance the task and DAG
    PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

    RETURN jsonb_build_object(
      'status', 'completed',
      'task_id', p_task_id,
      'cycle_number', p_cycle_number
    );
  END IF;
END;
$$;


--
-- Name: complete_task_and_advance(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.complete_task_and_advance(p_task_id uuid, p_actor_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_task           RECORD;
  v_instance       RECORD;
  v_task_list      RECORD;
  v_project        RECORD;
  v_workspace_id   uuid;
  v_process_name   text;
  v_done_status_id uuid;
  v_todo_status_id uuid;
  v_recipient      RECORD;
  v_downstream     RECORD;
  v_all_preds_done boolean;
  v_due_date       date;
  v_pending_tasks  integer;
BEGIN
  -- Enable bypass marker for trusted workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- =========================================================================
  -- BRANCH 1: NEW PROCESS INSTANCE RUNTIME
  -- =========================================================================
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;

    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;

    -- Resolve project Done status if project-attached
    IF v_task.project_id IS NOT NULL THEN
      SELECT id INTO v_done_status_id
      FROM public.task_statuses
      WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
      ORDER BY position DESC LIMIT 1;

      IF v_done_status_id IS NULL THEN
        SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
      END IF;

      SELECT id INTO v_todo_status_id
      FROM public.task_statuses
      WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
      ORDER BY position ASC LIMIT 1;

      IF v_todo_status_id IS NULL THEN
        SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
      END IF;
    END IF;

    -- 1. Complete the current task
    UPDATE public.tasks
    SET workflow_state = 'completed',
        workflow_completed_at = now(),
        status_id = COALESCE(v_done_status_id, status_id)
    WHERE id = p_task_id;

    -- Record audit event
    INSERT INTO public.process_audit_events (
      workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
    ) VALUES (
      v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_COMPLETED', p_actor_id,
      jsonb_build_object(
        'instance_id', v_instance.id,
        'step_id', v_task.process_step_id,
        'cycle_number', v_task.current_cycle_number
      )
    );

    -- Notify completed Task RACI
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL AND (p_actor_id IS NULL OR u_id <> p_actor_id)
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'process_task_completed',
        'Task completed: ' || v_task.title,
        'Step has been completed in process "' || v_process_name || '".',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    -- 2. Evaluate all downstream tasks in the process instance (ISOLATED BY process_instance_id)
    FOR v_downstream IN
      SELECT
        t.id AS downstream_task_id,
        t.title AS downstream_title,
        s.id AS step_id
      FROM public.defined_process_step_dependencies d
      JOIN public.defined_process_steps s ON s.id = d.step_id
      JOIN public.tasks t ON t.process_step_id = s.id AND t.process_instance_id = v_instance.id
      WHERE d.depends_on_step_id = v_task.process_step_id
        AND t.workflow_state = 'waiting'
    LOOP
      -- Check if ALL predecessor tasks are completed in THIS process instance
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies pred_dep
        JOIN public.tasks pred_task ON pred_task.process_step_id = pred_dep.depends_on_step_id
          AND pred_task.process_instance_id = v_instance.id
        WHERE pred_dep.step_id = v_downstream.step_id
          AND pred_task.workflow_state <> 'completed'
      ) INTO v_all_preds_done;

      IF v_all_preds_done THEN
        -- Decisions 33 & 42: No per-step contractual due dates
        UPDATE public.tasks
        SET workflow_state = 'ready',
            ready_at = now(),
            due_date = NULL,
            status_id = COALESCE(v_todo_status_id, status_id)
        WHERE id = v_downstream.downstream_task_id;

        -- Audit TASK_READY
        INSERT INTO public.process_audit_events (
          workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
        ) VALUES (
          v_workspace_id, v_task.project_id, v_task.task_list_id, v_downstream.downstream_task_id, 'TASK_READY', p_actor_id,
          jsonb_build_object('instance_id', v_instance.id, 'step_id', v_downstream.step_id)
        );

        -- Notify activated task RACI
        FOR v_recipient IN
          SELECT DISTINCT u_id FROM (
            SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_downstream.downstream_task_id AND ra.user_id IS NOT NULL
            UNION
            SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
            JOIN public.department_memberships dm ON dm.department_id = ra.department_id
            WHERE ra.task_id = v_downstream.downstream_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
          ) sub WHERE u_id IS NOT NULL
        LOOP
          PERFORM private.emit_notification(
            v_workspace_id,
            v_recipient.u_id,
            'process_task_ready',
            'Task ready: ' || v_downstream.downstream_title,
            'Dependencies cleared. Task is now ready in process "' || v_process_name || '".',
            'task',
            v_downstream.downstream_task_id,
            v_task.project_id,
            v_downstream.downstream_task_id
          );
        END LOOP;
      END IF;
    END LOOP;

    -- 3. Automatic Process Instance Completion Check
    SELECT count(*) INTO v_pending_tasks
    FROM public.tasks
    WHERE process_instance_id = v_instance.id
      AND process_step_id IS NOT NULL
      AND workflow_state NOT IN ('completed', 'cancelled');

    IF v_pending_tasks = 0 THEN
      UPDATE public.process_instances
      SET status = 'completed',
          completed_at = now()
      WHERE id = v_instance.id;

      INSERT INTO public.process_audit_events (
        workspace_id, project_id, task_list_id, event_type, actor_id, payload
      ) VALUES (
        v_workspace_id, v_task.project_id, v_task.task_list_id, 'PROCESS_COMPLETED', p_actor_id,
        jsonb_build_object('instance_id', v_instance.id, 'instance_name', v_instance.instance_name)
      );

      -- Notify process starter and all participants
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT v_instance.started_by AS u_id WHERE v_instance.started_by IS NOT NULL
          UNION
          SELECT v_instance.owner_id AS u_id WHERE v_instance.owner_id IS NOT NULL
          UNION
          SELECT ra.user_id AS u_id
          FROM public.tasks t
          JOIN public.task_raci_assignments ra ON ra.task_id = t.id
          WHERE t.process_instance_id = v_instance.id AND ra.user_id IS NOT NULL
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'process_completed',
          'Process completed: ' || v_process_name,
          'All tasks in process "' || v_process_name || '" have been completed.',
          'process_instance',
          v_instance.id,
          v_task.project_id,
          NULL
        );
      END LOOP;
    END IF;

  -- =========================================================================
  -- BRANCH 2: LEGACY TASK LIST DEFINED PROCESS RUNTIME
  -- =========================================================================
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;

    -- Resolve project Done status
    SELECT id INTO v_done_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'done' OR lower(name) = 'done')
    ORDER BY position DESC LIMIT 1;

    IF v_done_status_id IS NULL THEN
      SELECT id INTO v_done_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position DESC LIMIT 1;
    END IF;

    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
    END IF;

    -- 1. Complete the current task
    UPDATE public.tasks
    SET workflow_state = 'completed',
        workflow_completed_at = now(),
        status_id = COALESCE(v_done_status_id, status_id)
    WHERE id = p_task_id;

    -- Record audit event
    INSERT INTO public.process_audit_events (
      workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
    ) VALUES (
      v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_COMPLETED', p_actor_id,
      jsonb_build_object('step_id', v_task.process_step_id, 'cycle_number', v_task.current_cycle_number)
    );

    -- Notify completed Task R/A/C/I
    FOR v_recipient IN
      SELECT DISTINCT u_id FROM (
        SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.user_id IS NOT NULL
        UNION
        SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
        JOIN public.department_memberships dm ON dm.department_id = ra.department_id
        WHERE ra.task_id = p_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
      ) sub WHERE u_id IS NOT NULL AND (p_actor_id IS NULL OR u_id <> p_actor_id)
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_recipient.u_id,
        'process_task_completed',
        'Task completed: ' || v_task.title,
        'Step has been completed in process "' || v_task_list.name || '".',
        'task',
        p_task_id,
        v_task.project_id,
        p_task_id
      );
    END LOOP;

    -- 2. Evaluate all downstream tasks in the task list
    FOR v_downstream IN
      SELECT
        t.id AS downstream_task_id,
        t.title AS downstream_title,
        s.id AS step_id,
        s.expected_duration_days
      FROM public.defined_process_step_dependencies d
      JOIN public.defined_process_steps s ON s.id = d.step_id
      JOIN public.tasks t ON t.process_step_id = s.id AND t.task_list_id = v_task.task_list_id
      WHERE d.depends_on_step_id = v_task.process_step_id
        AND t.workflow_state = 'waiting'
    LOOP
      -- Check if ALL predecessor tasks are completed
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.defined_process_step_dependencies pred_dep
        JOIN public.tasks pred_task ON pred_task.process_step_id = pred_dep.depends_on_step_id
          AND pred_task.task_list_id = v_task.task_list_id
        WHERE pred_dep.step_id = v_downstream.step_id
          AND pred_task.workflow_state <> 'completed'
      ) INTO v_all_preds_done;

      IF v_all_preds_done THEN
        v_due_date := private.add_working_days(v_workspace_id, CURRENT_DATE, v_downstream.expected_duration_days);

        UPDATE public.tasks
        SET workflow_state = 'ready',
            ready_at = now(),
            due_date = v_due_date,
            status_id = COALESCE(v_todo_status_id, status_id)
        WHERE id = v_downstream.downstream_task_id;

        -- Audit TASK_READY
        INSERT INTO public.process_audit_events (
          workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
        ) VALUES (
          v_workspace_id, v_task.project_id, v_task.task_list_id, v_downstream.downstream_task_id, 'TASK_READY', p_actor_id,
          jsonb_build_object('step_id', v_downstream.step_id, 'due_date', v_due_date)
        );

        -- Notify activated task RACI
        FOR v_recipient IN
          SELECT DISTINCT u_id FROM (
            SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_downstream.downstream_task_id AND ra.user_id IS NOT NULL
            UNION
            SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
            JOIN public.department_memberships dm ON dm.department_id = ra.department_id
            WHERE ra.task_id = v_downstream.downstream_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
          ) sub WHERE u_id IS NOT NULL
        LOOP
          PERFORM private.emit_notification(
            v_workspace_id,
            v_recipient.u_id,
            'process_task_ready',
            'Task ready: ' || v_downstream.downstream_title,
            'Dependencies cleared. Task is now ready in process "' || v_task_list.name || '".',
            'task',
            v_downstream.downstream_task_id,
            v_task.project_id,
            v_downstream.downstream_task_id
          );
        END LOOP;
      END IF;
    END LOOP;

    -- 3. Automatic Process Completion Check
    SELECT count(*) INTO v_pending_tasks
    FROM public.tasks
    WHERE task_list_id = v_task.task_list_id
      AND process_step_id IS NOT NULL
      AND workflow_state NOT IN ('completed', 'cancelled');

    IF v_pending_tasks = 0 THEN
      UPDATE public.task_lists
      SET process_state = 'completed',
          completed_at = now()
      WHERE id = v_task.task_list_id;

      INSERT INTO public.process_audit_events (
        workspace_id, project_id, task_list_id, event_type, actor_id, payload
      ) VALUES (
        v_workspace_id, v_task.project_id, v_task.task_list_id, 'PROCESS_COMPLETED', p_actor_id,
        jsonb_build_object('task_list_id', v_task.task_list_id)
      );

      -- Notify process starter and all participants
      FOR v_recipient IN
        SELECT DISTINCT u_id FROM (
          SELECT v_task_list.started_by AS u_id WHERE v_task_list.started_by IS NOT NULL
          UNION
          SELECT ra.user_id AS u_id
          FROM public.tasks t
          JOIN public.task_raci_assignments ra ON ra.task_id = t.id
          WHERE t.task_list_id = v_task.task_list_id AND ra.user_id IS NOT NULL
        ) sub WHERE u_id IS NOT NULL
      LOOP
        PERFORM private.emit_notification(
          v_workspace_id,
          v_recipient.u_id,
          'process_completed',
          'Process completed: ' || v_task_list.name,
          'All tasks in process "' || v_task_list.name || '" have been completed.',
          'task_list',
          v_task.task_list_id,
          v_task.project_id,
          NULL
        );
      END LOOP;
    END IF;
  END IF;
END;
$$;


--
-- Name: emit_notification(uuid, uuid, text, text, text, text, uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.emit_notification(p_workspace_id uuid, p_user_id uuid, p_type text, p_title text, p_message text, p_entity_type text, p_entity_id uuid, p_project_id uuid, p_task_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  -- Deduplication check: ignore if an unread notification with identical parameters exists created in last 10 seconds
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND type = p_type
      AND title = p_title
      AND COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_read = false
      AND created_at > (now() - interval '10 seconds')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    workspace_id,
    user_id,
    type,
    title,
    message,
    entity_type,
    entity_id,
    project_id,
    task_id,
    is_read,
    created_at
  ) VALUES (
    p_workspace_id,
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_entity_type,
    p_entity_id,
    p_project_id,
    p_task_id,
    false,
    now()
  );
END;
$$;


--
-- Name: get_user_workspace_role(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.get_user_workspace_role(p_workspace_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;


--
-- Name: has_system_role(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.has_system_role(p_workspace_id uuid, p_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_system_roles
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND role = p_role
  );
$$;


--
-- Name: is_workspace_active_member(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_workspace_active_member(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;


--
-- Name: reject_process_task_internal(uuid, integer, text, text, date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.reject_process_task_internal(p_task_id uuid, p_cycle_number integer, p_rejection_reason text, p_rework_instructions text DEFAULT NULL::text, p_new_due_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id       uuid;
  v_task            RECORD;
  v_instance        RECORD;
  v_task_list       RECORD;
  v_project         RECORD;
  v_workspace_id    uuid;
  v_process_name    text;
  v_is_a            boolean;
  v_recipient       RECORD;
  v_todo_status_id  uuid;
  v_target_due_date date;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'in_review' THEN
    RAISE EXCEPTION 'Task must be in review state to be rejected.';
  END IF;

  IF v_task.current_cycle_number <> p_cycle_number THEN
    RAISE EXCEPTION 'Cycle number mismatch. Expected % but got %.', v_task.current_cycle_number, p_cycle_number;
  END IF;

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;

    -- Decisions 33 & 42: Steps in a Process Instance must NOT have individual due dates
    IF p_new_due_date IS NOT NULL THEN
      RAISE EXCEPTION 'Process Instance steps do not have individual due dates.';
    END IF;
    v_target_due_date := NULL;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;

    -- Legacy runtime requires due date for rework
    IF p_new_due_date IS NULL THEN
      RAISE EXCEPTION 'New due date is required for rework.';
    END IF;
    v_target_due_date := p_new_due_date;
  END IF;

  -- Check Caller is assigned Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_caller_id
            AND dm.is_active = true
        )
      )
  ) INTO v_is_a;

  IF NOT v_is_a THEN
    RAISE EXCEPTION 'Caller is not an assigned Accountable user for this task.';
  END IF;

  -- Resolve Todo status if project-attached
  IF v_task.project_id IS NOT NULL THEN
    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_task.project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_task.project_id ORDER BY position ASC LIMIT 1;
    END IF;
  END IF;

  -- Record rejection in approval cycle
  INSERT INTO public.task_approval_cycles (
    task_id, cycle_number, status, rejection_reason, rework_instructions, decided_by, decided_at
  ) VALUES (
    p_task_id, p_cycle_number, 'rejected', p_rejection_reason, p_rework_instructions, v_caller_id, now()
  )
  ON CONFLICT (task_id, cycle_number)
  DO UPDATE SET
    status = 'rejected',
    rejection_reason = p_rejection_reason,
    rework_instructions = p_rework_instructions,
    decided_by = v_caller_id,
    decided_at = now();

  -- Enable bypass marker for workflow mutation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- Increment cycle number and transition state to rework_required
  UPDATE public.tasks
  SET workflow_state = 'rework_required',
      current_cycle_number = current_cycle_number + 1,
      due_date = v_target_due_date,
      status_id = COALESCE(v_todo_status_id, status_id)
  WHERE id = p_task_id;

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_REJECTED', v_caller_id,
    jsonb_build_object(
      'step_id', v_task.process_step_id,
      'cycle_number', p_cycle_number,
      'reason', p_rejection_reason,
      'new_due_date', v_target_due_date
    )
  );

  -- Notify Responsible (R) users of rework requirement
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_task_rejected',
      'Rework Required: ' || v_task.title,
      'Task was rejected during review in process "' || v_process_name || '". Reason: ' || p_rejection_reason,
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'rework_required',
    'task_id', p_task_id,
    'new_cycle_number', v_task.current_cycle_number + 1
  );
END;
$$;


--
-- Name: start_process_instance_internal(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.start_process_instance_internal(p_version_id uuid, p_instance_name text, p_start_request_id uuid, p_overall_due_date date DEFAULT NULL::date, p_placement_type text DEFAULT 'standalone'::text, p_project_id uuid DEFAULT NULL::uuid, p_phase_id uuid DEFAULT NULL::uuid, p_task_list_id uuid DEFAULT NULL::uuid, p_parent_task_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id             uuid;
  v_version               RECORD;
  v_process               RECORD;
  v_project               RECORD;
  v_parent_task           RECORD;
  v_existing_instance     RECORD;
  v_existing_root_task_id uuid;
  v_existing_task_count   integer;
  v_workspace_id          uuid;
  v_instance_id           uuid;
  v_root_step             RECORD;
  v_step                  RECORD;
  v_standalone_parent_id  uuid := NULL;
  v_step_parent_task_id   uuid := NULL;
  v_root_task_id          uuid := NULL;
  v_task_id               uuid;
  v_todo_status_id        uuid := NULL;
  v_is_root               boolean;
  v_task_count            integer := 0;
  v_pos                   integer := 1000;
  v_recipient             RECORD;
  v_project_id            uuid := p_project_id;
  v_phase_id              uuid := p_phase_id;
  v_task_list_id          uuid := p_task_list_id;
  v_parent_task_id        uuid := p_parent_task_id;
BEGIN
  -- 1. Authentication Check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Parameter Validation
  IF p_instance_name IS NULL OR btrim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Process instance name is required.';
  END IF;

  IF p_start_request_id IS NULL THEN
    RAISE EXCEPTION 'start_request_id is required for process instance creation.';
  END IF;

  IF p_placement_type NOT IN ('standalone', 'project', 'phase', 'task_list', 'task') THEN
    RAISE EXCEPTION 'Invalid placement type: %. Must be standalone, project, phase, task_list, or task.', p_placement_type;
  END IF;

  -- 3. Validate Version & Fetch Process
  SELECT * INTO v_version FROM public.defined_process_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'published' THEN
    RAISE EXCEPTION 'Process version must be published to be started.';
  END IF;

  SELECT * INTO v_process FROM public.defined_processes WHERE id = v_version.defined_process_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process container not found.';
  END IF;
  v_workspace_id := v_process.workspace_id;

  -- 4. Server-Side Placement Validation & Hierarchy Resolution
  IF p_placement_type = 'standalone' THEN
    IF p_project_id IS NOT NULL OR p_phase_id IS NOT NULL OR p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Standalone process cannot have project_id, phase_id, task_list_id, or parent_task_id.';
    END IF;
    v_project_id := NULL;
    v_phase_id := NULL;
    v_task_list_id := NULL;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'project' THEN
    IF p_project_id IS NULL THEN
      RAISE EXCEPTION 'project_id is required for project placement.';
    END IF;
    IF p_phase_id IS NOT NULL OR p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Project placement must not specify phase_id, task_list_id, or parent_task_id.';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target project not found.';
    END IF;
    IF v_project.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'Target project belongs to a different workspace.';
    END IF;
    v_phase_id := NULL;
    v_task_list_id := NULL;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'phase' THEN
    IF p_project_id IS NULL OR p_phase_id IS NULL THEN
      RAISE EXCEPTION 'project_id and phase_id are required for phase placement.';
    END IF;
    IF p_task_list_id IS NOT NULL OR p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Phase placement must not specify task_list_id or parent_task_id.';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target project not found.';
    END IF;
    IF v_project.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'Target project belongs to a different workspace.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.phases ph WHERE ph.id = p_phase_id AND ph.project_id = p_project_id) THEN
      RAISE EXCEPTION 'Phase does not belong to the target project.';
    END IF;
    v_task_list_id := NULL;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'task_list' THEN
    IF p_project_id IS NULL OR p_phase_id IS NULL OR p_task_list_id IS NULL THEN
      RAISE EXCEPTION 'project_id, phase_id, and task_list_id are required for task_list placement.';
    END IF;
    IF p_parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Task list placement must not specify parent_task_id.';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target project not found.';
    END IF;
    IF v_project.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'Target project belongs to a different workspace.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.phases ph WHERE ph.id = p_phase_id AND ph.project_id = p_project_id) THEN
      RAISE EXCEPTION 'Phase does not belong to the target project.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.task_lists tl
      WHERE tl.id = p_task_list_id
        AND tl.project_id = p_project_id
        AND tl.phase_id = p_phase_id
    ) THEN
      RAISE EXCEPTION 'Task list does not belong to the specified phase and project.';
    END IF;
    v_parent_task_id := NULL;

  ELSIF p_placement_type = 'task' THEN
    IF p_parent_task_id IS NULL THEN
      RAISE EXCEPTION 'parent_task_id is required for task placement.';
    END IF;
    SELECT * INTO v_parent_task FROM public.tasks WHERE id = p_parent_task_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent task not found.';
    END IF;
    IF v_parent_task.project_id IS NOT NULL THEN
      SELECT * INTO v_project FROM public.projects WHERE id = v_parent_task.project_id;
      IF NOT FOUND OR v_project.workspace_id <> v_workspace_id THEN
        RAISE EXCEPTION 'Parent task project belongs to a different workspace.';
      END IF;
    END IF;
    v_project_id := v_parent_task.project_id;
    v_phase_id := v_parent_task.phase_id;
    v_task_list_id := v_parent_task.task_list_id;
    v_parent_task_id := p_parent_task_id;
    v_step_parent_task_id := p_parent_task_id;
  END IF;

  -- 5. Starter Authorization Check
  IF NOT private.can_start_process_version(p_version_id, v_caller_id, v_workspace_id) THEN
    RAISE EXCEPTION 'Caller is not authorized to start this process version.';
  END IF;

  -- 6. Find Root Step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Root step not found for process version.';
  END IF;

  -- 7. Idempotency Check & Deterministic Replay
  SELECT * INTO v_existing_instance
  FROM public.process_instances
  WHERE workspace_id = v_workspace_id
    AND started_by = v_caller_id
    AND start_request_id = p_start_request_id;

  IF FOUND THEN
    -- Verify payload consistency
    IF v_existing_instance.defined_process_version_id <> p_version_id
       OR v_existing_instance.instance_name <> p_instance_name
       OR v_existing_instance.placement_type <> p_placement_type
       OR v_existing_instance.project_id IS DISTINCT FROM v_project_id
       OR v_existing_instance.phase_id IS DISTINCT FROM v_phase_id
       OR v_existing_instance.task_list_id IS DISTINCT FROM v_task_list_id
       OR (p_placement_type <> 'standalone' AND v_existing_instance.parent_task_id IS DISTINCT FROM v_parent_task_id)
       OR v_existing_instance.due_date IS DISTINCT FROM p_overall_due_date THEN
      RAISE EXCEPTION 'Idempotency conflict: start_request_id was previously used with different parameters.';
    END IF;

    -- Fetch existing root task and task count
    SELECT id INTO v_existing_root_task_id
    FROM public.tasks
    WHERE process_instance_id = v_existing_instance.id
      AND process_step_id = v_root_step.id
    LIMIT 1;

    SELECT count(*) INTO v_existing_task_count
    FROM public.tasks
    WHERE process_instance_id = v_existing_instance.id
      AND process_step_id IS NOT NULL;

    RETURN jsonb_build_object(
      'process_instance_id', v_existing_instance.id,
      'placement_type', v_existing_instance.placement_type,
      'root_task_id', v_existing_root_task_id,
      'parent_task_id', v_existing_instance.parent_task_id,
      'task_count', v_existing_task_count,
      'is_replay', true
    );
  END IF;

  -- 8. Resolve default Todo status if project-attached
  IF v_project_id IS NOT NULL THEN
    SELECT id INTO v_todo_status_id
    FROM public.task_statuses
    WHERE project_id = v_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
    ORDER BY position ASC LIMIT 1;

    IF v_todo_status_id IS NULL THEN
      SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = v_project_id ORDER BY position ASC LIMIT 1;
    END IF;
  END IF;

  -- 9. Enable bypass marker for trusted process creation
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 10. Insert Process Instance Row (Owner = Starter, start_request_id enforced)
  INSERT INTO public.process_instances (
    workspace_id,
    defined_process_id,
    defined_process_version_id,
    start_request_id,
    instance_name,
    started_by,
    owner_id,
    started_at,
    due_date,
    placement_type,
    project_id,
    phase_id,
    task_list_id,
    parent_task_id,
    status
  ) VALUES (
    v_workspace_id,
    v_process.id,
    p_version_id,
    p_start_request_id,
    p_instance_name,
    v_caller_id,
    v_caller_id,
    now(),
    p_overall_due_date,
    p_placement_type,
    v_project_id,
    v_phase_id,
    v_task_list_id,
    v_parent_task_id,
    'running'
  ) RETURNING id INTO v_instance_id;

  -- 11. If Standalone, Create Standalone Parent Task (Decision 1 & 8)
  IF p_placement_type = 'standalone' THEN
    INSERT INTO public.tasks (
      project_id,
      phase_id,
      task_list_id,
      parent_task_id,
      process_instance_id,
      title,
      description,
      status_id,
      workflow_state,
      current_cycle_number,
      ready_at,
      due_date,
      position,
      created_by
    ) VALUES (
      NULL,
      NULL,
      NULL,
      NULL,
      v_instance_id,
      p_instance_name,
      'Standalone Defined Process container: ' || p_instance_name,
      NULL,
      'ready',
      1,
      now(),
      p_overall_due_date,
      1000,
      v_caller_id
    ) RETURNING id INTO v_standalone_parent_id;

    UPDATE public.process_instances
    SET parent_task_id = v_standalone_parent_id
    WHERE id = v_instance_id;

    v_step_parent_task_id := v_standalone_parent_id;
  END IF;

  -- 12. Materialize Step Tasks
  FOR v_step IN
    SELECT * FROM public.defined_process_steps
    WHERE version_id = p_version_id
    ORDER BY sequence_order ASC
  LOOP
    v_is_root := (v_step.id = v_root_step.id);
    v_task_count := v_task_count + 1;
    v_pos := v_pos + 1000;

    INSERT INTO public.tasks (
      project_id,
      phase_id,
      task_list_id,
      parent_task_id,
      process_instance_id,
      title,
      description,
      status_id,
      defined_process_version_id,
      process_step_id,
      workflow_state,
      current_cycle_number,
      ready_at,
      due_date,
      overdue_cycle_notified,
      position,
      created_by
    ) VALUES (
      v_project_id,
      v_phase_id,
      v_task_list_id,
      v_step_parent_task_id,
      v_instance_id,
      v_step.title,
      v_step.description,
      v_todo_status_id,
      p_version_id,
      v_step.id,
      CASE WHEN v_is_root THEN 'ready'::text ELSE 'waiting'::text END,
      1,
      CASE WHEN v_is_root THEN now() ELSE NULL END,
      NULL,
      false,
      v_pos,
      v_caller_id
    ) RETURNING id INTO v_task_id;

    IF v_is_root THEN
      v_root_task_id := v_task_id;
    END IF;

    -- Copy Step RACI with Dynamic process_starter Resolution
    INSERT INTO public.task_raci_assignments (
      task_id,
      raci_role,
      user_id,
      department_id,
      response_required
    )
    SELECT DISTINCT ON (raci_role, resolved_user_id, department_id)
      v_task_id,
      raci_role,
      resolved_user_id,
      department_id,
      response_required
    FROM (
      SELECT
        r.raci_role,
        CASE
          WHEN r.actor_type = 'process_starter' THEN v_caller_id
          WHEN r.actor_type = 'user' THEN r.user_id
          ELSE NULL
        END AS resolved_user_id,
        NULL::uuid AS department_id,
        COALESCE(r.response_required, false) AS response_required
      FROM public.defined_process_step_raci r
      WHERE r.step_id = v_step.id
    ) sub
    WHERE resolved_user_id IS NOT NULL OR department_id IS NOT NULL
    ORDER BY raci_role, resolved_user_id, department_id, response_required DESC;
  END LOOP;

  -- 13. Audit Events & Notifications
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_project_id, v_task_list_id, v_root_task_id, 'PROCESS_STARTED', v_caller_id,
    jsonb_build_object(
      'instance_id', v_instance_id,
      'instance_name', p_instance_name,
      'version_id', p_version_id,
      'placement_type', p_placement_type,
      'task_count', v_task_count,
      'overall_due_date', p_overall_due_date,
      'start_request_id', p_start_request_id
    )
  );

  -- Notify Root Step RACI Participants
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_root_task_id AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = v_root_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_task_ready',
      'Process Task Ready: ' || v_root_step.title,
      'Process "' || p_instance_name || '" has started and root step is ready.',
      'task',
      v_root_task_id,
      v_project_id,
      v_root_task_id
    );
  END LOOP;

  -- 14. Return Instance Summary
  RETURN jsonb_build_object(
    'process_instance_id', v_instance_id,
    'placement_type', p_placement_type,
    'root_task_id', v_root_task_id,
    'parent_task_id', v_standalone_parent_id,
    'task_count', v_task_count,
    'is_replay', false
  );
END;
$$;


--
-- Name: sync_validate_legacy_task_list_version(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_validate_legacy_task_list_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_list_version_id uuid;
BEGIN
  IF NEW.process_instance_id IS NULL AND NEW.process_step_id IS NOT NULL THEN
    IF NEW.task_list_id IS NULL THEN
      RAISE EXCEPTION 'Legacy defined process step task must have a task_list_id.';
    END IF;

    SELECT defined_process_version_id INTO v_list_version_id
    FROM public.task_lists
    WHERE id = NEW.task_list_id;

    IF v_list_version_id IS NULL OR v_list_version_id <> NEW.defined_process_version_id THEN
      RAISE EXCEPTION 'Version coherence violation: task_list % (version: %) does not match task defined_process_version_id %.',
        NEW.task_list_id, v_list_version_id, NEW.defined_process_version_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION sync_validate_legacy_task_list_version(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.sync_validate_legacy_task_list_version() IS 'Internal validation trigger function enforcing task_list version coherence for legacy defined tasks.';


--
-- Name: trg_fn_guard_defined_task_list_mutation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trg_fn_guard_defined_task_list_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_is_trusted boolean;
BEGIN
  v_is_trusted := (
    current_user = 'postgres'
    AND current_setting('sns.process_engine_write', true) = 'on'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_trusted THEN
      IF NEW.task_list_type = 'defined' THEN
        RAISE EXCEPTION 'Defined Process task lists cannot be created directly.';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.task_list_type = 'defined' THEN
      IF NOT v_is_trusted THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
           OR NEW.task_list_type IS DISTINCT FROM OLD.task_list_type
           OR NEW.defined_process_id IS DISTINCT FROM OLD.defined_process_id
           OR NEW.defined_process_version_id IS DISTINCT FROM OLD.defined_process_version_id
           OR NEW.process_state IS DISTINCT FROM OLD.process_state
           OR NEW.started_by IS DISTINCT FROM OLD.started_by
           OR NEW.started_at IS DISTINCT FROM OLD.started_at
           OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
           OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
           OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
           OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'Direct modification of Defined Process task list lifecycle fields is prohibited.';
        END IF;
      END IF;
    ELSE
      -- Custom task list
      IF NOT v_is_trusted THEN
        IF NEW.task_list_type = 'defined' THEN
          RAISE EXCEPTION 'Cannot convert a custom task list into a Defined Process task list directly.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.task_list_type = 'defined' THEN
      IF NOT v_is_trusted THEN
        RAISE EXCEPTION 'Defined Process task lists cannot be deleted directly.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: trg_fn_guard_defined_task_mutation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trg_fn_guard_defined_task_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_is_trusted boolean;
  v_parent_list_type text;
BEGIN
  v_is_trusted := (
    current_user = 'postgres'
    AND current_setting('sns.process_engine_write', true) = 'on'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_trusted THEN
      IF NEW.process_step_id IS NOT NULL OR NEW.defined_process_version_id IS NOT NULL OR NEW.workflow_state IS NOT NULL THEN
        RAISE EXCEPTION 'Defined Process tasks cannot be created directly.';
      END IF;

      IF NEW.task_list_id IS NOT NULL THEN
        SELECT tl.task_list_type INTO v_parent_list_type
        FROM public.task_lists tl
        WHERE tl.id = NEW.task_list_id;

        IF v_parent_list_type = 'defined' THEN
          RAISE EXCEPTION 'Cannot insert custom tasks into a Defined Process task list.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.process_step_id IS NOT NULL THEN
      IF NOT v_is_trusted THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.status_id IS DISTINCT FROM OLD.status_id
           OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
           OR NEW.due_date IS DISTINCT FROM OLD.due_date
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
           OR NEW.task_list_id IS DISTINCT FROM OLD.task_list_id
           OR NEW.defined_process_version_id IS DISTINCT FROM OLD.defined_process_version_id
           OR NEW.process_step_id IS DISTINCT FROM OLD.process_step_id
           OR NEW.workflow_state IS DISTINCT FROM OLD.workflow_state
           OR NEW.current_cycle_number IS DISTINCT FROM OLD.current_cycle_number
           OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
           OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
           OR NEW.workflow_completed_at IS DISTINCT FROM OLD.workflow_completed_at
           OR NEW.overdue_cycle_notified IS DISTINCT FROM OLD.overdue_cycle_notified THEN
          RAISE EXCEPTION 'Direct modification of Defined Process task workflow fields is prohibited.';
        END IF;
      END IF;
    ELSE
      -- Custom task
      IF NOT v_is_trusted THEN
        IF NEW.process_step_id IS NOT NULL OR NEW.defined_process_version_id IS NOT NULL OR NEW.workflow_state IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot convert a custom task into a Defined Process task directly.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.process_step_id IS NOT NULL THEN
      IF NOT v_is_trusted THEN
        RAISE EXCEPTION 'Defined Process tasks cannot be deleted directly.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: trg_fn_raci_assigned(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trg_fn_raci_assigned() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_task_title      text;
  v_project_id      uuid;
  v_workspace_id    uuid;
  v_project_name    text;
  v_phase_name      text;
  v_task_list_name  text;
  v_hierarchy_path  text;
  v_title           text;
  v_type            text;
  v_message         text;
  v_dept_member     RECORD;
BEGIN
  SELECT 
    t.title,
    t.project_id,
    p.workspace_id,
    p.name,
    ph.name,
    tl.name
  INTO 
    v_task_title,
    v_project_id,
    v_workspace_id,
    v_project_name,
    v_phase_name,
    v_task_list_name
  FROM public.tasks t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.phases ph ON ph.id = t.phase_id
  LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
  WHERE t.id = NEW.task_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_phase_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_phase_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  IF NEW.raci_role = 'R' THEN
    v_title := 'Task assigned to you';
    v_type  := 'task_assigned';
  ELSIF NEW.raci_role = 'A' THEN
    v_title := 'You are accountable for a task';
    v_type  := 'task_accountable';
  ELSIF NEW.raci_role = 'C' THEN
    v_title := 'Your input is requested';
    v_type  := 'task_consulted';
  ELSIF NEW.raci_role = 'I' THEN
    v_title := 'You are following a task';
    v_type  := 'task_informed';
  ELSE
    v_title := 'Task updated';
    v_type  := 'task_raci_update';
  END IF;

  v_message := '"' || v_task_title || '" in ' || v_hierarchy_path;

  IF NEW.user_id IS NOT NULL THEN
    PERFORM private.emit_notification(
      v_workspace_id,
      NEW.user_id,
      v_type,
      v_title,
      v_message,
      'task',
      NEW.task_id,
      v_project_id,
      NEW.task_id
    );
  END IF;

  IF NEW.department_id IS NOT NULL THEN
    FOR v_dept_member IN
      SELECT dm.user_id
      FROM public.department_memberships dm
      WHERE dm.department_id = NEW.department_id
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true
    LOOP
      PERFORM private.emit_notification(
        v_workspace_id,
        v_dept_member.user_id,
        v_type,
        v_title,
        v_message || ' (via Department assignment)',
        'task',
        NEW.task_id,
        v_project_id,
        NEW.task_id
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: trg_fn_set_updated_at(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trg_fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: trg_fn_subtask_assigned(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trg_fn_subtask_assigned() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_parent_task_title text;
  v_project_id        uuid;
  v_workspace_id      uuid;
  v_project_name      text;
  v_phase_name        text;
  v_task_list_name    text;
  v_hierarchy_path    text;
  v_title             text;
  v_message           text;
  v_actor_id          uuid;
BEGIN
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
    RETURN NEW;
  END IF;

  SELECT 
    t.title,
    t.project_id,
    p.workspace_id,
    p.name,
    ph.name,
    tl.name
  INTO 
    v_parent_task_title,
    v_project_id,
    v_workspace_id,
    v_project_name,
    v_phase_name,
    v_task_list_name
  FROM public.tasks t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.phases ph ON ph.id = t.phase_id
  LEFT JOIN public.task_lists tl ON tl.id = t.task_list_id
  WHERE t.id = NEW.task_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_phase_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_phase_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Subtask assigned to you';
  v_message := '"' || NEW.title || '" under task "' || v_parent_task_title || '" in ' || v_hierarchy_path;

  PERFORM private.emit_notification(
    v_workspace_id,
    NEW.assignee_id,
    'subtask_assigned',
    v_title,
    v_message,
    'subtask',
    NEW.id,
    v_project_id,
    NEW.task_id
  );

  RETURN NEW;
END;
$$;


--
-- Name: trg_fn_task_status_changed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.trg_fn_task_status_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id    uuid;
  v_project_name    text;
  v_phase_name      text;
  v_task_list_name  text;
  v_status_name     text;
  v_hierarchy_path  text;
  v_title           text;
  v_message         text;
  v_recipient       RECORD;
  v_actor_id        uuid;
BEGIN
  IF OLD.status_id IS NOT DISTINCT FROM NEW.status_id THEN
    RETURN NEW;
  END IF;

  IF NEW.process_step_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_status_name FROM public.task_statuses WHERE id = NEW.status_id;

  SELECT 
    p.workspace_id,
    p.name,
    ph.name,
    tl.name
  INTO 
    v_workspace_id,
    v_project_name,
    v_phase_name,
    v_task_list_name
  FROM public.projects p
  LEFT JOIN public.phases ph ON ph.id = NEW.phase_id
  LEFT JOIN public.task_lists tl ON tl.id = NEW.task_list_id
  WHERE p.id = NEW.project_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_phase_name IS NOT NULL AND v_task_list_name IS NOT NULL THEN
    v_hierarchy_path := v_project_name || ' › ' || v_phase_name || ' › ' || v_task_list_name;
  ELSE
    v_hierarchy_path := v_project_name;
  END IF;

  v_title   := 'Task status updated: ' || COALESCE(v_status_name, 'Updated');
  v_message := '"' || NEW.title || '" moved to ' || COALESCE(v_status_name, 'new status') || ' in ' || v_hierarchy_path;

  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id
      FROM public.task_raci_assignments ra
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'A', 'I')
        AND ra.user_id IS NOT NULL

      UNION

      SELECT dm.user_id AS u_id
      FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = NEW.id
        AND ra.raci_role IN ('R', 'I')
        AND ra.department_id IS NOT NULL
        AND dm.workspace_id = v_workspace_id
        AND dm.is_active = true

      UNION

      SELECT NEW.assignee_id AS u_id
      WHERE NEW.assignee_id IS NOT NULL
    ) sub
    WHERE u_id IS NOT NULL
      AND (v_actor_id IS NULL OR u_id <> v_actor_id)
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'task_status_changed',
      v_title,
      v_message,
      'task',
      NEW.id,
      NEW.project_id,
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: approve_process_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_process_task(p_task_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_is_accountable boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Task is not awaiting approval (current state: %).', v_task.workflow_state;
  END IF;

  -- Verify caller is Accountable (A)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'A'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_accountable;

  IF NOT v_is_accountable THEN
    RAISE EXCEPTION 'Caller is not the assigned Accountable user for this task.';
  END IF;

  -- Update approval cycle
  UPDATE public.task_approval_cycles
  SET status = 'approved',
      decided_by = v_caller_id,
      decided_at = now()
  WHERE task_id = p_task_id AND cycle_number = v_task.current_cycle_number;

  -- Complete task and advance workflow
  PERFORM private.complete_task_and_advance(p_task_id, v_caller_id);

  RETURN jsonb_build_object(
    'success', true,
    'workflow_state', 'completed'
  );
END;
$$;


--
-- Name: complete_responsible_part(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_responsible_part(p_task_id uuid, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_cycle integer;
BEGIN
  SELECT current_cycle_number INTO v_cycle FROM public.tasks WHERE id = p_task_id;
  IF v_cycle IS NULL THEN
    v_cycle := 1;
  END IF;

  RETURN private.complete_responsible_part_internal(
    p_task_id,
    v_cycle,
    p_note
  );
END;
$$;


--
-- Name: FUNCTION complete_responsible_part(p_task_id uuid, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.complete_responsible_part(p_task_id uuid, p_note text) IS 'Legacy 2-argument backward-compatible wrapper resolving current cycle automatically.';


--
-- Name: complete_responsible_part(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_responsible_part(p_task_id uuid, p_cycle_number integer, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RETURN private.complete_responsible_part_internal(
    p_task_id,
    p_cycle_number,
    p_notes
  );
END;
$$;


--
-- Name: get_process_instance_progress(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_process_instance_progress(p_instance_id uuid) RETURNS numeric
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_total     integer;
  v_completed integer;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_instance_id IS NULL THEN
    RETURN 0.00;
  END IF;

  -- Explicit Process Instance visibility check
  IF NOT private.can_read_process_instance(p_instance_id, v_caller_id) THEN
    RAISE EXCEPTION 'Access denied to process instance.';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE workflow_state = 'completed')
  INTO v_total, v_completed
  FROM public.tasks
  WHERE process_instance_id = p_instance_id
    AND process_step_id IS NOT NULL;

  IF v_total = 0 THEN
    RETURN 0.00;
  END IF;

  RETURN ROUND((v_completed::numeric / v_total::numeric) * 100.0, 2);
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
      BEGIN
        INSERT INTO public.profiles (id, full_name, avatar_url)
        VALUES (
          NEW.id,
          COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
          COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
        );
        RETURN NEW;
      END;
      $$;


--
-- Name: publish_defined_process_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_defined_process_version(p_version_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id    uuid;
  v_version      RECORD;
  v_process      RECORD;
  v_step_count   integer;
  v_root_count   integer;
  v_root_step    RECORD;
  v_invalid_raci RECORD;
  v_step         RECORD;
  v_r_count      integer;
  v_a_count      integer;
  v_req_c_count  integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_version
  FROM public.defined_process_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft process versions can be published.';
  END IF;

  SELECT * INTO v_process
  FROM public.defined_processes
  WHERE id = v_version.defined_process_id;

  -- Verify publication authorization:
  -- Department Head of owning department OR project_admin / system_admin OR workspace owner/admin
  IF NOT (
    (SELECT private.get_user_workspace_role(v_process.workspace_id)) IN ('owner', 'admin')
    OR
    (SELECT private.has_system_role(v_process.workspace_id, 'project_admin'))
    OR
    (SELECT private.has_system_role(v_process.workspace_id, 'system_admin'))
    OR
    EXISTS (
      SELECT 1 FROM public.department_memberships dm
      WHERE dm.department_id = v_process.department_id
        AND dm.user_id = v_caller_id
        AND dm.role = 'head'
        AND dm.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Insufficient authority to publish this process version.';
  END IF;

  -- 1. Step count check (>= 1)
  SELECT count(*) INTO v_step_count
  FROM public.defined_process_steps
  WHERE version_id = p_version_id;

  IF v_step_count < 1 THEN
    RAISE EXCEPTION 'Process version must contain at least one step.';
  END IF;

  -- 2. Root step check (exactly 1 root with sequence_order = 1)
  SELECT count(*) INTO v_root_count
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF v_root_count <> 1 THEN
    RAISE EXCEPTION 'Process version must have exactly one root step (found %)', v_root_count;
  END IF;

  SELECT * INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF v_root_step.sequence_order <> 1 THEN
    RAISE EXCEPTION 'Root step must have sequence_order = 1.';
  END IF;

  -- 3. Reachability & DAG cycle check
  WITH RECURSIVE reachable AS (
    SELECT v_root_step.id AS step_id
    UNION
    SELECT d.step_id
    FROM public.defined_process_step_dependencies d
    JOIN reachable r ON r.step_id = d.depends_on_step_id
    WHERE d.version_id = p_version_id
  )
  SELECT count(DISTINCT step_id) INTO v_root_count FROM reachable;

  IF v_root_count <> v_step_count THEN
    RAISE EXCEPTION 'Every step in the process must be reachable from the root step without cycles.';
  END IF;

  -- 4. Check each step's RACI, durations, approvals, consultations
  FOR v_step IN
    SELECT * FROM public.defined_process_steps WHERE version_id = p_version_id
  LOOP
    IF v_step.expected_duration_days < 1 THEN
      RAISE EXCEPTION 'Step % (%) duration must be >= 1 working day.', v_step.step_code, v_step.title;
    END IF;

    -- Count R and A (R includes both concrete users and Process Starter)
    SELECT
      count(*) FILTER (WHERE raci_role = 'R'),
      count(*) FILTER (WHERE raci_role = 'A'),
      count(*) FILTER (WHERE raci_role = 'C' AND response_required = true)
    INTO v_r_count, v_a_count, v_req_c_count
    FROM public.defined_process_step_raci
    WHERE step_id = v_step.id;

    IF v_r_count < 1 THEN
      RAISE EXCEPTION 'Step % (%) must have at least one Responsible (R) assignment.', v_step.step_code, v_step.title;
    END IF;

    IF v_a_count <> 1 THEN
      RAISE EXCEPTION 'Step % (%) must have exactly one Accountable (A) assignment (found %).', v_step.step_code, v_step.title, v_a_count;
    END IF;

    -- approval_required => Accountable concrete user cannot be in concrete Responsible set
    IF v_step.approval_required THEN
      IF EXISTS (
        SELECT 1 FROM public.defined_process_step_raci r
        WHERE r.step_id = v_step.id AND r.raci_role = 'R' AND r.actor_type = 'user' AND r.user_id = (
          SELECT a.user_id FROM public.defined_process_step_raci a
          WHERE a.step_id = v_step.id AND a.raci_role = 'A'
        )
      ) THEN
        RAISE EXCEPTION 'Step % requires approval, so Accountable cannot be in the Responsible set.', v_step.step_code;
      END IF;
    END IF;

    -- consultation_required => >= 1 C with response_required = true
    IF v_step.consultation_required AND v_req_c_count < 1 THEN
      RAISE EXCEPTION 'Step % requires consultation, so at least one Consulted (C) must have response_required = true.', v_step.step_code;
    END IF;
  END LOOP;

  -- 5. Validate that all concrete RACI users are active workspace members
  SELECT r.user_id, p.full_name INTO v_invalid_raci
  FROM public.defined_process_step_raci r
  JOIN public.defined_process_steps s ON s.id = r.step_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE s.version_id = p_version_id
    AND r.actor_type = 'user'
    AND r.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v_process.workspace_id
        AND wm.user_id = r.user_id
        AND wm.status = 'active'
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'RACI user % is not an active workspace member.', COALESCE(v_invalid_raci.full_name, v_invalid_raci.user_id::text);
  END IF;

  -- 6. Perform atomic publication
  UPDATE public.defined_process_versions
  SET status = 'archived'
  WHERE defined_process_id = v_process.id AND status = 'published';

  UPDATE public.defined_process_versions
  SET status = 'published',
      published_by = v_caller_id,
      published_at = now()
  WHERE id = p_version_id;

  INSERT INTO public.process_audit_events (
    workspace_id, event_type, actor_id, payload
  ) VALUES (
    v_process.workspace_id, 'VERSION_PUBLISHED', v_caller_id,
    jsonb_build_object(
      'process_id', v_process.id,
      'version_id', p_version_id,
      'version_number', v_version.version_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'process_id', v_process.id,
    'version_id', p_version_id,
    'status', 'published'
  );
END;
$$;


--
-- Name: reject_process_task(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_process_task(p_task_id uuid, p_reason text, p_new_due_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_cycle integer;
BEGIN
  SELECT current_cycle_number INTO v_cycle FROM public.tasks WHERE id = p_task_id;
  IF v_cycle IS NULL THEN
    v_cycle := 1;
  END IF;

  RETURN private.reject_process_task_internal(
    p_task_id             => p_task_id,
    p_cycle_number        => v_cycle,
    p_rejection_reason    => p_reason,
    p_rework_instructions => NULL,
    p_new_due_date        => p_new_due_date
  );
END;
$$;


--
-- Name: FUNCTION reject_process_task(p_task_id uuid, p_reason text, p_new_due_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_process_task(p_task_id uuid, p_reason text, p_new_due_date date) IS 'Legacy 3-argument backward-compatible wrapper resolving current cycle automatically.';


--
-- Name: reject_process_task(uuid, integer, text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_process_task(p_task_id uuid, p_cycle_number integer, p_rejection_reason text, p_rework_instructions text DEFAULT NULL::text, p_new_due_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RETURN private.reject_process_task_internal(
    p_task_id,
    p_cycle_number,
    p_rejection_reason,
    p_rework_instructions,
    p_new_due_date
  );
END;
$$;


--
-- Name: reorder_kanban_tasks(uuid, uuid, uuid[], uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reorder_kanban_tasks(p_task_id uuid, p_new_status_id uuid, p_source_task_ids uuid[], p_destination_task_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_task RECORD;
  v_dest_status RECORD;
  v_project_id uuid;
  v_old_status_id uuid;
  v_ordered_ids uuid[];
  v_db_source_ids uuid[];
  v_db_dest_ids uuid[];
  v_db_same_ids uuid[];
  v_diff_count integer;
  v_index integer;
  v_target_id uuid;
  v_source_len integer;
  v_dest_len integer;
BEGIN
  -- 1. Validate the moved task exists and retrieve project_id, status_id & process_step_id (under RLS)
  SELECT id, project_id, status_id, phase_id, task_list_id, process_step_id
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found or caller lacks permission', p_task_id;
  END IF;

  v_project_id := v_task.project_id;
  v_old_status_id := v_task.status_id;

  -- 2. Validate destination status exists and belongs to the same project
  SELECT id, project_id, name, system_code
  INTO v_dest_status
  FROM public.task_statuses
  WHERE id = p_new_status_id AND project_id = v_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target status % not found in project %', p_new_status_id, v_project_id;
  END IF;

  -- 3. Check for duplicates in source array
  IF p_source_task_ids IS NOT NULL AND array_length(p_source_task_ids, 1) > 0 THEN
    SELECT count(*) - count(DISTINCT tid)
    INTO v_diff_count
    FROM unnest(p_source_task_ids) AS tid;

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Duplicate task ID found in source task array';
    END IF;
  END IF;

  -- 4. Check for duplicates in destination array
  IF p_destination_task_ids IS NOT NULL AND array_length(p_destination_task_ids, 1) > 0 THEN
    SELECT count(*) - count(DISTINCT tid)
    INTO v_diff_count
    FROM unnest(p_destination_task_ids) AS tid;

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'Duplicate task ID found in destination task array';
    END IF;
  END IF;

  -- CASE A: SAME-COLUMN REORDER
  IF v_old_status_id = p_new_status_id THEN
    v_ordered_ids := COALESCE(p_destination_task_ids, p_source_task_ids);

    IF v_ordered_ids IS NULL OR array_length(v_ordered_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Same-column reorder requires non-empty ordered task array';
    END IF;

    IF NOT (p_task_id = ANY(v_ordered_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in reorder array', p_task_id;
    END IF;

    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_same_ids;

    IF array_length(v_ordered_ids, 1) <> array_length(v_db_same_ids, 1) THEN
      RAISE EXCEPTION 'Submitted task list count (%) does not match database count (%) for status %',
        array_length(v_ordered_ids, 1), array_length(v_db_same_ids, 1), v_old_status_id;
    END IF;

    SELECT count(*)
    INTO v_diff_count
    FROM unnest(v_ordered_ids) AS tid
    WHERE NOT (tid = ANY(v_db_same_ids));

    IF v_diff_count > 0 THEN
      RAISE EXCEPTION 'One or more task IDs in reorder array do not belong to status % in project %',
        v_old_status_id, v_project_id;
    END IF;

    FOR v_index IN 1..array_length(v_ordered_ids, 1) LOOP
      v_target_id := v_ordered_ids[v_index];
      UPDATE public.tasks
      SET position = v_index * 1000,
          updated_at = now()
      WHERE id = v_target_id;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', true,
      'reordered_count', array_length(v_ordered_ids, 1)
    );

  -- CASE B: CROSS-COLUMN REORDER
  ELSE
    IF v_task.process_step_id IS NOT NULL THEN
      RAISE EXCEPTION 'Defined Process task status is controlled by the process workflow.';
    END IF;

    IF p_destination_task_ids IS NULL OR array_length(p_destination_task_ids, 1) = 0 THEN
      RAISE EXCEPTION 'Cross-column move requires non-empty destination task array containing moved task';
    END IF;

    IF p_source_task_ids IS NOT NULL AND p_task_id = ANY(p_source_task_ids) THEN
      RAISE EXCEPTION 'Moved task % must not be present in final source task array', p_task_id;
    END IF;

    IF NOT (p_task_id = ANY(p_destination_task_ids)) THEN
      RAISE EXCEPTION 'Moved task % must be present in destination task array', p_task_id;
    END IF;

    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = v_old_status_id
      FOR UPDATE
    ) INTO v_db_source_ids;

    v_source_len := COALESCE(array_length(p_source_task_ids, 1), 0);

    IF v_source_len <> (array_length(v_db_source_ids, 1) - 1) THEN
      RAISE EXCEPTION 'Source task count mismatch: expected %, got %',
        (array_length(v_db_source_ids, 1) - 1), v_source_len;
    END IF;

    IF v_source_len > 0 THEN
      SELECT count(*)
      INTO v_diff_count
      FROM unnest(p_source_task_ids) AS tid
      WHERE NOT (tid = ANY(v_db_source_ids));

      IF v_diff_count > 0 THEN
        RAISE EXCEPTION 'Source array contains task IDs not belonging to source status % in project %',
          v_old_status_id, v_project_id;
      END IF;
    END IF;

    SELECT ARRAY(
      SELECT id
      FROM public.tasks
      WHERE project_id = v_project_id AND status_id = p_new_status_id
      FOR UPDATE
    ) INTO v_db_dest_ids;

    v_dest_len := COALESCE(array_length(v_db_dest_ids, 1), 0);

    IF array_length(p_destination_task_ids, 1) <> (v_dest_len + 1) THEN
      RAISE EXCEPTION 'Destination task count mismatch: expected %, got %',
        (v_dest_len + 1), array_length(p_destination_task_ids, 1);
    END IF;

    IF v_dest_len > 0 THEN
      SELECT count(*)
      INTO v_diff_count
      FROM unnest(p_destination_task_ids) AS tid
      WHERE tid <> p_task_id AND NOT (tid = ANY(v_db_dest_ids));

      IF v_diff_count > 0 THEN
        RAISE EXCEPTION 'Destination array contains invalid task IDs for target status % in project %',
          p_new_status_id, v_project_id;
      END IF;
    END IF;

    UPDATE public.tasks
    SET status_id = p_new_status_id,
        updated_at = now()
    WHERE id = p_task_id;

    IF v_source_len > 0 THEN
      FOR v_index IN 1..v_source_len LOOP
        v_target_id := p_source_task_ids[v_index];
        UPDATE public.tasks
        SET position = v_index * 1000,
            updated_at = now()
        WHERE id = v_target_id;
      END LOOP;
    END IF;

    FOR v_index IN 1..array_length(p_destination_task_ids, 1) LOOP
      v_target_id := p_destination_task_ids[v_index];
      UPDATE public.tasks
      SET position = v_index * 1000,
          updated_at = now()
      WHERE id = v_target_id;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'task_id', p_task_id,
      'source_status_id', v_old_status_id,
      'destination_status_id', p_new_status_id,
      'project_id', v_project_id,
      'same_column', false,
      'source_reordered_count', v_source_len,
      'destination_reordered_count', array_length(p_destination_task_ids, 1)
    );
  END IF;
END;
$$;


--
-- Name: save_defined_process_draft(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_defined_process_draft(p_workspace_id uuid, p_actor_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
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


--
-- Name: seed_default_statuses(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_statuses() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.task_statuses (project_id, name, color, position, system_code)
  VALUES
    (NEW.id, 'To Do',        '#a0a0a0', 0, 'todo'),
    (NEW.id, 'In Progress',  '#8cc9ff', 1, 'in_progress'),
    (NEW.id, 'In Review',    '#ffb020', 2, 'in_review'),
    (NEW.id, 'Blocked',      '#ff6666', 3, 'blocked'),
    (NEW.id, 'Done',         '#60d394', 4, 'done');
  RETURN NEW;
END;
$$;


--
-- Name: start_defined_process(uuid, uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_defined_process(p_version_id uuid, p_project_id uuid, p_phase_id uuid, p_instance_name text, p_raci_overrides jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id       uuid;
  v_version         RECORD;
  v_process         RECORD;
  v_project         RECORD;
  v_workspace_id    uuid;
  v_root_step       RECORD;
  v_step            RECORD;
  v_task_list_id    uuid;
  v_root_task_id    uuid;
  v_task_id         uuid;
  v_todo_status_id  uuid;
  v_task_count      integer := 0;
  v_raci_count      integer := 0;
  v_dep_count       integer := 0;
  v_is_root         boolean;
  v_pos             integer := 1000;
  v_recipient       RECORD;
  v_today           date;
  v_due_date        date;
BEGIN
  -- 1. Authentication check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Validate project & phase hierarchy
  SELECT * INTO v_project
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  v_workspace_id := v_project.workspace_id;

  IF NOT private.is_workspace_active_member(v_workspace_id) THEN
    RAISE EXCEPTION 'Caller is not an active member of this workspace.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.phases ph
    WHERE ph.id = p_phase_id AND ph.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Phase % does not belong to project %.', p_phase_id, p_project_id;
  END IF;

  -- 3. Validate version status is published
  SELECT * INTO v_version
  FROM public.defined_process_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process version not found.';
  END IF;

  IF v_version.status <> 'published' THEN
    RAISE EXCEPTION 'Process version is % (must be published).', v_version.status;
  END IF;

  -- 4. Load process container
  SELECT * INTO v_process
  FROM public.defined_processes
  WHERE id = v_version.defined_process_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defined process container not found.';
  END IF;

  IF v_process.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'Process workspace mismatch.';
  END IF;

  -- 5. Find the root step
  SELECT s.* INTO v_root_step
  FROM public.defined_process_steps s
  WHERE s.version_id = p_version_id
    AND NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_dependencies d
      WHERE d.version_id = p_version_id AND d.step_id = s.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No root step found for version %.', p_version_id;
  END IF;

  -- 6. Starter authorization check
  IF NOT private.can_start_process_version(p_version_id, v_caller_id, v_workspace_id) THEN
    RAISE EXCEPTION 'Caller % is not authorized to start process % (version %).',
      v_caller_id, v_process.code, v_version.version_number;
  END IF;

  -- 7. Validate instance name
  IF p_instance_name IS NULL OR trim(p_instance_name) = '' THEN
    RAISE EXCEPTION 'Instance name cannot be blank.';
  END IF;

  -- 8. Get default "Todo" status
  SELECT id INTO v_todo_status_id
  FROM public.task_statuses
  WHERE project_id = p_project_id AND (system_code = 'todo' OR lower(name) = 'to do')
  ORDER BY position ASC
  LIMIT 1;

  IF v_todo_status_id IS NULL THEN
    SELECT id INTO v_todo_status_id FROM public.task_statuses WHERE project_id = p_project_id ORDER BY position ASC LIMIT 1;
  END IF;

  IF v_todo_status_id IS NULL THEN
    RAISE EXCEPTION 'No open task status found in project %.', p_project_id;
  END IF;

  -- 9. Enable write marker
  PERFORM set_config('sns.process_engine_write', 'on', true);

  -- 10. Create the defined task list
  INSERT INTO public.task_lists (
    project_id,
    phase_id,
    name,
    description,
    position,
    created_by,
    task_list_type,
    defined_process_id,
    defined_process_version_id,
    process_state,
    started_by,
    started_at
  ) VALUES (
    p_project_id,
    p_phase_id,
    p_instance_name,
    'Instantiated from ' || v_process.name || ' v' || v_version.version_number,
    0,
    v_caller_id,
    'defined',
    v_process.id,
    p_version_id,
    'active',
    v_caller_id,
    now()
  ) RETURNING id INTO v_task_list_id;

  v_today := CURRENT_DATE;

  -- 11. Materialize Step Tasks
  FOR v_step IN
    SELECT s.*
    FROM public.defined_process_steps s
    WHERE s.version_id = p_version_id
    ORDER BY s.sequence_order ASC
  LOOP
    v_is_root := (v_step.id = v_root_step.id);
    v_task_count := v_task_count + 1;
    v_pos := v_pos + 1000;

    IF v_is_root AND v_step.expected_duration_days IS NOT NULL AND v_step.expected_duration_days > 0 THEN
      v_due_date := private.add_working_days(v_workspace_id, v_today, v_step.expected_duration_days);
    ELSE
      v_due_date := NULL;
    END IF;

    INSERT INTO public.tasks (
      project_id,
      phase_id,
      task_list_id,
      title,
      description,
      status_id,
      defined_process_version_id,
      process_step_id,
      workflow_state,
      current_cycle_number,
      ready_at,
      due_date,
      overdue_cycle_notified,
      position,
      created_by
    ) VALUES (
      p_project_id,
      p_phase_id,
      v_task_list_id,
      v_step.title,
      v_step.description,
      v_todo_status_id,
      p_version_id,
      v_step.id,
      CASE WHEN v_is_root THEN 'ready'::text ELSE 'waiting'::text END,
      1,
      CASE WHEN v_is_root THEN now() ELSE NULL END,
      v_due_date,
      false,
      v_pos,
      v_caller_id
    ) RETURNING id INTO v_task_id;

    IF v_is_root THEN
      v_root_task_id := v_task_id;
    END IF;

    -- Copy Step RACI
    INSERT INTO public.task_raci_assignments (
      task_id,
      raci_role,
      user_id,
      department_id,
      response_required
    )
    SELECT DISTINCT ON (raci_role, resolved_user_id, department_id)
      v_task_id,
      raci_role,
      resolved_user_id,
      department_id,
      response_required
    FROM (
      SELECT
        r.raci_role,
        CASE
          WHEN r.actor_type = 'process_starter' THEN v_caller_id
          WHEN r.actor_type = 'user' THEN r.user_id
          ELSE NULL
        END AS resolved_user_id,
        NULL::uuid AS department_id,
        COALESCE(r.response_required, false) AS response_required
      FROM public.defined_process_step_raci r
      WHERE r.step_id = v_step.id
    ) sub
    WHERE resolved_user_id IS NOT NULL OR department_id IS NOT NULL
    ORDER BY raci_role, resolved_user_id, department_id, response_required DESC;

    GET DIAGNOSTICS v_raci_count = ROW_COUNT;
  END LOOP;

  -- 12. Audit event
  INSERT INTO public.process_audit_events (
    workspace_id,
    project_id,
    task_list_id,
    task_id,
    event_type,
    actor_id,
    payload
  ) VALUES (
    v_workspace_id,
    p_project_id,
    v_task_list_id,
    v_root_task_id,
    'PROCESS_STARTED',
    v_caller_id,
    jsonb_build_object(
      'process_code', v_process.code,
      'process_name', v_process.name,
      'version_number', v_version.version_number,
      'instance_name', p_instance_name,
      'task_list_id', v_task_list_id,
      'root_task_id', v_root_task_id,
      'task_count', v_task_count
    )
  );

  -- 13. Notifications
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = v_root_task_id AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = v_root_task_id AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_task_ready',
      'Process Task Ready: ' || v_root_step.title,
      'Process "' || p_instance_name || '" has started and root step is ready.',
      'task',
      v_root_task_id,
      p_project_id,
      v_root_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'task_list_id', v_task_list_id,
    'root_task_id', v_root_task_id,
    'task_count', v_task_count
  );
END;
$$;


--
-- Name: start_process_instance(uuid, text, uuid, date, text, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_process_instance(p_version_id uuid, p_instance_name text, p_start_request_id uuid, p_overall_due_date date DEFAULT NULL::date, p_placement_type text DEFAULT 'standalone'::text, p_project_id uuid DEFAULT NULL::uuid, p_phase_id uuid DEFAULT NULL::uuid, p_task_list_id uuid DEFAULT NULL::uuid, p_parent_task_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RETURN private.start_process_instance_internal(
    p_version_id,
    p_instance_name,
    p_start_request_id,
    p_overall_due_date,
    p_placement_type,
    p_project_id,
    p_phase_id,
    p_task_list_id,
    p_parent_task_id
  );
END;
$$;


--
-- Name: submit_task_consultation(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_task_consultation(p_task_id uuid, p_response text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id     uuid;
  v_task          RECORD;
  v_instance      RECORD;
  v_task_list     RECORD;
  v_project       RECORD;
  v_workspace_id  uuid;
  v_process_name  text;
  v_is_c          boolean;
  v_recipient     RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_response IS NULL OR btrim(p_response) = '' THEN
    RAISE EXCEPTION 'Response text cannot be empty.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  IF v_task.workflow_state NOT IN ('ready', 'in_progress', 'waiting') THEN
    RAISE EXCEPTION 'Cannot submit consultation response in % state.', v_task.workflow_state;
  END IF;

  -- Context resolution
  IF v_task.process_instance_id IS NOT NULL THEN
    SELECT * INTO v_instance FROM public.process_instances WHERE id = v_task.process_instance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Process instance not found.';
    END IF;
    v_workspace_id := v_instance.workspace_id;
    v_process_name := v_instance.instance_name;
  ELSE
    SELECT * INTO v_task_list FROM public.task_lists WHERE id = v_task.task_list_id;
    SELECT * INTO v_project FROM public.projects WHERE id = v_task.project_id;
    v_workspace_id := v_project.workspace_id;
    v_process_name := v_task_list.name;
  END IF;

  -- Check Caller is assigned Consulted (C)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id
      AND ra.raci_role = 'C'
      AND (
        ra.user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.department_memberships dm
          WHERE dm.department_id = ra.department_id
            AND dm.user_id = v_caller_id
            AND dm.is_active = true
        )
      )
  ) INTO v_is_c;

  IF NOT v_is_c THEN
    RAISE EXCEPTION 'Caller is not an assigned Consulted participant for this task.';
  END IF;

  -- Record consultation response
  INSERT INTO public.task_consultation_responses (
    task_id, cycle_number, user_id, response_text
  ) VALUES (
    p_task_id, v_task.current_cycle_number, v_caller_id, p_response
  )
  ON CONFLICT (task_id, cycle_number, user_id)
  DO UPDATE SET response_text = p_response, responded_at = now();

  -- Record Audit Event
  INSERT INTO public.process_audit_events (
    workspace_id, project_id, task_list_id, task_id, event_type, actor_id, payload
  ) VALUES (
    v_workspace_id, v_task.project_id, v_task.task_list_id, p_task_id, 'TASK_CONSULTATION_SUBMITTED', v_caller_id,
    jsonb_build_object('cycle_number', v_task.current_cycle_number)
  );

  -- Notify Responsible users
  FOR v_recipient IN
    SELECT DISTINCT u_id FROM (
      SELECT ra.user_id AS u_id FROM public.task_raci_assignments ra WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.user_id IS NOT NULL
      UNION
      SELECT dm.user_id AS u_id FROM public.task_raci_assignments ra
      JOIN public.department_memberships dm ON dm.department_id = ra.department_id
      WHERE ra.task_id = p_task_id AND ra.raci_role = 'R' AND ra.department_id IS NOT NULL AND dm.is_active = true
    ) sub WHERE u_id IS NOT NULL AND u_id <> v_caller_id
  LOOP
    PERFORM private.emit_notification(
      v_workspace_id,
      v_recipient.u_id,
      'process_consultation_response',
      'Consultation Response: ' || v_task.title,
      'A consultation response was submitted for task in process "' || v_process_name || '".',
      'task',
      p_task_id,
      v_task.project_id,
      p_task_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'cycle_number', v_task.current_cycle_number
  );
END;
$$;


--
-- Name: submit_task_evidence(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_task_evidence(p_task_id uuid, p_evidence_def_id uuid DEFAULT NULL::uuid, p_evidence_type text DEFAULT 'text'::text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id      uuid;
  v_task           RECORD;
  v_is_responsible boolean := false;
  v_submission_id  uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_evidence_type NOT IN ('text', 'link') THEN
    RAISE EXCEPTION 'Only text and link evidence types are supported in MVP.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR v_task.process_step_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not a Defined Process task.';
  END IF;

  -- Verify caller is Responsible (R)
  SELECT EXISTS (
    SELECT 1 FROM public.task_raci_assignments ra
    WHERE ra.task_id = p_task_id AND ra.raci_role = 'R'
      AND (
        ra.user_id = v_caller_id
        OR (
          ra.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.department_memberships dm
            WHERE dm.department_id = ra.department_id AND dm.user_id = v_caller_id AND dm.is_active = true
          )
        )
      )
  ) INTO v_is_responsible;

  IF NOT v_is_responsible THEN
    RAISE EXCEPTION 'Caller is not an assigned Responsible user for this task.';
  END IF;

  -- If evidence_def_id supplied, ensure it belongs to this step
  IF p_evidence_def_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.defined_process_step_evidence_defs ed
      WHERE ed.id = p_evidence_def_id AND ed.step_id = v_task.process_step_id
    ) THEN
      RAISE EXCEPTION 'Evidence definition does not belong to this process step.';
    END IF;
  END IF;

  INSERT INTO public.task_evidence_submissions (
    task_id, cycle_number, evidence_def_id, evidence_type, payload, submitted_by
  ) VALUES (
    p_task_id, v_task.current_cycle_number, p_evidence_def_id, p_evidence_type, p_payload, v_caller_id
  ) RETURNING id INTO v_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id
  );
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: defined_process_step_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defined_process_step_dependencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    step_id uuid NOT NULL,
    depends_on_step_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_step_deps_no_self_dependency CHECK ((step_id <> depends_on_step_id))
);


--
-- Name: TABLE defined_process_step_dependencies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.defined_process_step_dependencies IS 'DAG dependency edges between steps strictly confined to the same defined process version.';


--
-- Name: defined_process_step_evidence_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defined_process_step_evidence_defs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    step_id uuid NOT NULL,
    evidence_type text NOT NULL,
    title text NOT NULL,
    description text,
    is_mandatory boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT defined_process_step_evidence_defs_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['file'::text, 'link'::text, 'text'::text, 'reference'::text])))
);


--
-- Name: TABLE defined_process_step_evidence_defs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.defined_process_step_evidence_defs IS 'Evidence requirement definitions for process steps (file, link, text, reference).';


--
-- Name: defined_process_step_raci; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defined_process_step_raci (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    step_id uuid NOT NULL,
    raci_role text NOT NULL,
    user_id uuid,
    response_required boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type text DEFAULT 'user'::text NOT NULL,
    CONSTRAINT chk_step_raci_actor CHECK ((((actor_type = 'user'::text) AND (user_id IS NOT NULL)) OR ((actor_type = 'process_starter'::text) AND (user_id IS NULL) AND (raci_role = 'R'::text)))),
    CONSTRAINT chk_step_raci_actor_type CHECK ((actor_type = ANY (ARRAY['user'::text, 'process_starter'::text]))),
    CONSTRAINT chk_step_raci_response_required CHECK (((response_required = false) OR (raci_role = 'C'::text))),
    CONSTRAINT defined_process_step_raci_raci_role_check CHECK ((raci_role = ANY (ARRAY['R'::text, 'A'::text, 'C'::text, 'I'::text])))
);


--
-- Name: TABLE defined_process_step_raci; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.defined_process_step_raci IS 'Template RACI assignments for process steps with max-one Accountable enforcement.';


--
-- Name: defined_process_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defined_process_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    step_code text NOT NULL,
    title text NOT NULL,
    description text,
    sequence_order integer NOT NULL,
    expected_duration_days integer NOT NULL,
    approval_required boolean DEFAULT false NOT NULL,
    consultation_required boolean DEFAULT false NOT NULL,
    evidence_required boolean DEFAULT false NOT NULL,
    notify_c_on_extension boolean DEFAULT false NOT NULL,
    notify_i_on_extension boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT defined_process_steps_expected_duration_days_check CHECK ((expected_duration_days >= 1)),
    CONSTRAINT defined_process_steps_sequence_order_check CHECK ((sequence_order >= 1))
);


--
-- Name: TABLE defined_process_steps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.defined_process_steps IS 'Step template definitions within a defined process version with sequence ordering and governance flags.';


--
-- Name: defined_process_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defined_process_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    defined_process_id uuid NOT NULL,
    version_number integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    change_summary text,
    published_by uuid,
    published_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_defined_process_versions_publication CHECK ((((status = 'draft'::text) AND (published_by IS NULL) AND (published_at IS NULL)) OR ((status = ANY (ARRAY['published'::text, 'archived'::text])) AND (published_by IS NOT NULL) AND (published_at IS NOT NULL)))),
    CONSTRAINT defined_process_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))),
    CONSTRAINT defined_process_versions_version_number_check CHECK ((version_number >= 1))
);


--
-- Name: TABLE defined_process_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.defined_process_versions IS 'Immutable version instances for defined processes with single-published enforcement.';


--
-- Name: defined_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defined_processes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    process_owner_id uuid NOT NULL,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_task_list_id uuid,
    approval_state text DEFAULT 'not_required'::text NOT NULL,
    submitted_for_approval_by uuid,
    submitted_for_approval_at timestamp with time zone,
    approval_decided_by uuid,
    approval_decided_at timestamp with time zone,
    approval_notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_defined_processes_source_provenance CHECK ((((source_type = 'manual'::text) AND (source_task_list_id IS NULL) AND (approval_state = 'not_required'::text)) OR ((source_type = 'custom_conversion'::text) AND (source_task_list_id IS NOT NULL) AND (approval_state <> 'not_required'::text)))),
    CONSTRAINT defined_processes_approval_state_check CHECK ((approval_state = ANY (ARRAY['not_required'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT defined_processes_source_type_check CHECK ((source_type = ANY (ARRAY['manual'::text, 'custom_conversion'::text])))
);


--
-- Name: TABLE defined_processes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.defined_processes IS 'Reusable defined process templates catalog governed at workspace and department level.';


--
-- Name: department_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    department_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT department_memberships_role_check CHECK ((role = ANY (ARRAY['head'::text, 'lead'::text, 'member'::text])))
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    color text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text,
    entity_type text,
    entity_id uuid,
    project_id uuid,
    task_id uuid,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['task_assigned'::text, 'task_accountable'::text, 'task_consulted'::text, 'task_informed'::text, 'raci_changed'::text, 'task_status_changed'::text, 'subtask_assigned'::text, 'project_status_changed'::text, 'system'::text, 'process_task_ready'::text, 'process_task_completed'::text, 'consultation_required'::text, 'approval_required'::text, 'task_rework_required'::text, 'process_completed'::text])))
);


--
-- Name: phases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    start_date date,
    end_date date,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id uuid
);


--
-- Name: process_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    task_list_id uuid,
    task_id uuid,
    event_type text NOT NULL,
    actor_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: process_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    defined_process_id uuid NOT NULL,
    defined_process_version_id uuid NOT NULL,
    instance_name text NOT NULL,
    started_by uuid NOT NULL,
    owner_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date timestamp with time zone,
    placement_type text NOT NULL,
    project_id uuid,
    phase_id uuid,
    task_list_id uuid,
    parent_task_id uuid,
    status text DEFAULT 'running'::text NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT chk_process_instance_placement CHECK ((((placement_type = 'standalone'::text) AND (project_id IS NULL) AND (phase_id IS NULL) AND (task_list_id IS NULL)) OR ((placement_type = 'project'::text) AND (project_id IS NOT NULL) AND (phase_id IS NULL) AND (task_list_id IS NULL) AND (parent_task_id IS NULL)) OR ((placement_type = 'phase'::text) AND (project_id IS NOT NULL) AND (phase_id IS NOT NULL) AND (task_list_id IS NULL) AND (parent_task_id IS NULL)) OR ((placement_type = 'task_list'::text) AND (project_id IS NOT NULL) AND (phase_id IS NOT NULL) AND (task_list_id IS NOT NULL) AND (parent_task_id IS NULL)) OR ((placement_type = 'task'::text) AND (project_id IS NOT NULL) AND (parent_task_id IS NOT NULL)))),
    CONSTRAINT chk_process_instance_status_lifecycle CHECK ((((status = 'running'::text) AND (completed_at IS NULL) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL) AND (cancel_reason IS NULL)) OR ((status = 'completed'::text) AND (completed_at IS NOT NULL) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL) AND (cancel_reason IS NULL)) OR ((status = 'cancelled'::text) AND (completed_at IS NULL) AND (cancelled_at IS NOT NULL) AND (cancelled_by IS NOT NULL) AND (cancel_reason IS NOT NULL) AND (btrim(cancel_reason) <> ''::text)))),
    CONSTRAINT process_instances_placement_type_check CHECK ((placement_type = ANY (ARRAY['standalone'::text, 'project'::text, 'phase'::text, 'task_list'::text, 'task'::text]))),
    CONSTRAINT process_instances_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE process_instances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.process_instances IS 'Explicit runtime container for executed Defined Processes (Access hardened: Direct client access revoked until P1-02 placement/RACI rules are implemented).';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT '#f5c400'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id uuid,
    start_date date,
    target_end_date date,
    project_status text DEFAULT 'active'::text NOT NULL,
    project_priority text DEFAULT 'medium'::text NOT NULL,
    CONSTRAINT projects_project_priority_check CHECK ((project_priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT projects_project_status_check CHECK ((project_status = ANY (ARRAY['draft'::text, 'planned'::text, 'active'::text, 'on_hold'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: subtasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    assignee_id uuid,
    status text DEFAULT 'todo'::text NOT NULL,
    start_date date,
    due_date date,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subtasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])))
);


--
-- Name: task_approval_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_approval_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    rejection_reason text,
    new_due_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_task_approval_cycle_decision CHECK ((((status = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL) AND (rejection_reason IS NULL) AND (new_due_date IS NULL)) OR ((status = 'approved'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (rejection_reason IS NULL) AND (new_due_date IS NULL)) OR ((status = 'rejected'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (rejection_reason IS NOT NULL) AND (btrim(rejection_reason) <> ''::text) AND (new_due_date IS NOT NULL)))),
    CONSTRAINT task_approval_cycles_cycle_number_check CHECK ((cycle_number >= 1)),
    CONSTRAINT task_approval_cycles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: task_consultation_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_consultation_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    user_id uuid NOT NULL,
    response_text text NOT NULL,
    responded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_consultation_responses_cycle_number_check CHECK ((cycle_number >= 1)),
    CONSTRAINT task_consultation_responses_response_text_check CHECK ((btrim(response_text) <> ''::text))
);


--
-- Name: task_evidence_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_evidence_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    evidence_def_id uuid,
    evidence_type text NOT NULL,
    payload jsonb NOT NULL,
    submitted_by uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_evidence_submissions_cycle_number_check CHECK ((cycle_number >= 1)),
    CONSTRAINT task_evidence_submissions_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['text'::text, 'link'::text])))
);


--
-- Name: task_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    task_list_type text DEFAULT 'custom'::text NOT NULL,
    defined_process_id uuid,
    defined_process_version_id uuid,
    process_state text,
    started_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    owner_id uuid,
    phase_id uuid,
    CONSTRAINT chk_task_lists_process_state CHECK (((process_state IS NULL) OR (process_state = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))),
    CONSTRAINT chk_task_lists_provenance_coherence CHECK ((((task_list_type = 'custom'::text) AND (defined_process_id IS NULL) AND (defined_process_version_id IS NULL) AND (process_state IS NULL) AND (started_by IS NULL) AND (started_at IS NULL) AND (completed_at IS NULL) AND (cancelled_by IS NULL) AND (cancelled_at IS NULL) AND (cancellation_reason IS NULL)) OR ((task_list_type = 'defined'::text) AND (defined_process_id IS NOT NULL) AND (defined_process_version_id IS NOT NULL) AND (process_state = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])) AND (started_by IS NOT NULL) AND (started_at IS NOT NULL) AND (((process_state = 'active'::text) AND (completed_at IS NULL) AND (cancelled_by IS NULL) AND (cancelled_at IS NULL) AND (cancellation_reason IS NULL)) OR ((process_state = 'completed'::text) AND (completed_at IS NOT NULL) AND (cancelled_by IS NULL) AND (cancelled_at IS NULL) AND (cancellation_reason IS NULL)) OR ((process_state = 'cancelled'::text) AND (completed_at IS NULL) AND (cancelled_by IS NOT NULL) AND (cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL) AND (btrim(cancellation_reason) <> ''::text)))))),
    CONSTRAINT chk_task_lists_task_list_type CHECK ((task_list_type = ANY (ARRAY['custom'::text, 'defined'::text])))
);


--
-- Name: task_raci_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_raci_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    raci_role text NOT NULL,
    user_id uuid,
    department_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    response_required boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_raci_accountable_user CHECK (((raci_role <> 'A'::text) OR ((user_id IS NOT NULL) AND (department_id IS NULL)))),
    CONSTRAINT chk_raci_single_target CHECK ((((user_id IS NOT NULL) AND (department_id IS NULL)) OR ((user_id IS NULL) AND (department_id IS NOT NULL)))),
    CONSTRAINT chk_task_raci_response_required CHECK (((response_required = false) OR (raci_role = 'C'::text))),
    CONSTRAINT task_raci_assignments_raci_role_check CHECK ((raci_role = ANY (ARRAY['R'::text, 'A'::text, 'C'::text, 'I'::text])))
);


--
-- Name: task_responsible_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_responsible_completions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    user_id uuid NOT NULL,
    completion_note text,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_responsible_completions_cycle_number_check CHECK ((cycle_number >= 1))
);


--
-- Name: task_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    system_code text,
    CONSTRAINT task_statuses_system_code_check CHECK (((system_code IS NULL) OR (system_code = ANY (ARRAY['todo'::text, 'in_progress'::text, 'in_review'::text, 'blocked'::text, 'done'::text, 'cancelled'::text]))))
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    title text NOT NULL,
    description text,
    status_id uuid,
    priority text DEFAULT 'none'::text,
    assignee_id uuid,
    due_date date,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    task_list_id uuid,
    defined_process_version_id uuid,
    process_step_id uuid,
    workflow_state text,
    current_cycle_number integer,
    ready_at timestamp with time zone,
    activated_at timestamp with time zone,
    workflow_completed_at timestamp with time zone,
    overdue_cycle_notified boolean,
    phase_id uuid,
    parent_task_id uuid,
    process_instance_id uuid,
    CONSTRAINT chk_tasks_defined_provenance_coherence CHECK ((((process_step_id IS NULL) AND (defined_process_version_id IS NULL) AND (process_instance_id IS NULL) AND (workflow_state IS NULL) AND (current_cycle_number IS NULL) AND (ready_at IS NULL) AND (activated_at IS NULL) AND (workflow_completed_at IS NULL) AND (overdue_cycle_notified IS NULL)) OR ((process_instance_id IS NOT NULL) AND (process_step_id IS NULL) AND (defined_process_version_id IS NULL) AND (parent_task_id IS NULL) AND (project_id IS NULL) AND (phase_id IS NULL) AND (task_list_id IS NULL)) OR ((process_instance_id IS NULL) AND (process_step_id IS NOT NULL) AND (defined_process_version_id IS NOT NULL) AND (task_list_id IS NOT NULL) AND (phase_id IS NOT NULL) AND (workflow_state IS NOT NULL) AND (current_cycle_number IS NOT NULL) AND (current_cycle_number >= 1) AND (overdue_cycle_notified IS NOT NULL) AND (assignee_id IS NULL)) OR ((process_instance_id IS NOT NULL) AND (process_step_id IS NOT NULL) AND (defined_process_version_id IS NOT NULL) AND (workflow_state IS NOT NULL) AND (current_cycle_number IS NOT NULL) AND (current_cycle_number >= 1) AND (assignee_id IS NULL)))),
    CONSTRAINT chk_tasks_no_self_parent CHECK (((parent_task_id IS NULL) OR (parent_task_id <> id))),
    CONSTRAINT chk_tasks_workflow_state CHECK (((workflow_state IS NULL) OR (workflow_state = ANY (ARRAY['waiting'::text, 'ready'::text, 'active'::text, 'awaiting_consultation'::text, 'awaiting_approval'::text, 'rework_required'::text, 'completed'::text, 'cancelled'::text])))),
    CONSTRAINT tasks_hierarchy_check CHECK ((((project_id IS NULL) AND (phase_id IS NULL) AND (task_list_id IS NULL)) OR ((process_instance_id IS NOT NULL) AND (phase_id IS NOT NULL) AND (task_list_id IS NULL)) OR ((project_id IS NOT NULL) AND (task_list_id IS NOT NULL)) OR ((project_id IS NOT NULL) AND (task_list_id IS NULL)))),
    CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['none'::text, 'low'::text, 'medium'::text, 'high'::text, 'urgent'::text])))
);


--
-- Name: user_system_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_system_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_system_roles_role_check CHECK ((role = ANY (ARRAY['ceo'::text, 'cto'::text, 'project_admin'::text, 'system_admin'::text])))
);


--
-- Name: workspace_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_holidays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    holiday_date date NOT NULL,
    name text NOT NULL,
    description text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workspace_holidays_name CHECK ((btrim(name) <> ''::text))
);


--
-- Name: TABLE workspace_holidays; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspace_holidays IS 'Company non-working holiday dates declared per workspace calendar.';


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    invited_email text,
    role text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text]))),
    CONSTRAINT workspace_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'declined'::text])))
);


--
-- Name: workspace_working_calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_working_calendars (
    workspace_id uuid NOT NULL,
    timezone text NOT NULL,
    monday_working boolean DEFAULT true NOT NULL,
    tuesday_working boolean DEFAULT true NOT NULL,
    wednesday_working boolean DEFAULT true NOT NULL,
    thursday_working boolean DEFAULT true NOT NULL,
    friday_working boolean DEFAULT true NOT NULL,
    saturday_working boolean DEFAULT false NOT NULL,
    sunday_working boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workspace_working_calendars_at_least_one_day CHECK ((monday_working OR tuesday_working OR wednesday_working OR thursday_working OR friday_working OR saturday_working OR sunday_working)),
    CONSTRAINT chk_workspace_working_calendars_timezone CHECK ((btrim(timezone) <> ''::text))
);


--
-- Name: TABLE workspace_working_calendars; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspace_working_calendars IS 'Company-wide working calendar configuration defining working weekdays and timezone per workspace.';


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: defined_process_step_dependencies defined_process_step_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_dependencies
    ADD CONSTRAINT defined_process_step_dependencies_pkey PRIMARY KEY (id);


--
-- Name: defined_process_step_evidence_defs defined_process_step_evidence_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_evidence_defs
    ADD CONSTRAINT defined_process_step_evidence_defs_pkey PRIMARY KEY (id);


--
-- Name: defined_process_step_raci defined_process_step_raci_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_raci
    ADD CONSTRAINT defined_process_step_raci_pkey PRIMARY KEY (id);


--
-- Name: defined_process_steps defined_process_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_steps
    ADD CONSTRAINT defined_process_steps_pkey PRIMARY KEY (id);


--
-- Name: defined_process_versions defined_process_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_versions
    ADD CONSTRAINT defined_process_versions_pkey PRIMARY KEY (id);


--
-- Name: defined_processes defined_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_pkey PRIMARY KEY (id);


--
-- Name: department_memberships department_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_memberships
    ADD CONSTRAINT department_memberships_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: phases phases_id_project_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_id_project_unique UNIQUE (id, project_id);


--
-- Name: phases phases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_pkey PRIMARY KEY (id);


--
-- Name: process_audit_events process_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_audit_events
    ADD CONSTRAINT process_audit_events_pkey PRIMARY KEY (id);


--
-- Name: process_instances process_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: subtasks subtasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_pkey PRIMARY KEY (id);


--
-- Name: task_approval_cycles task_approval_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_approval_cycles
    ADD CONSTRAINT task_approval_cycles_pkey PRIMARY KEY (id);


--
-- Name: task_consultation_responses task_consultation_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_consultation_responses
    ADD CONSTRAINT task_consultation_responses_pkey PRIMARY KEY (id);


--
-- Name: task_evidence_submissions task_evidence_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evidence_submissions
    ADD CONSTRAINT task_evidence_submissions_pkey PRIMARY KEY (id);


--
-- Name: task_lists task_lists_id_phase_project_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_id_phase_project_unique UNIQUE (id, phase_id, project_id);


--
-- Name: task_lists task_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_pkey PRIMARY KEY (id);


--
-- Name: task_raci_assignments task_raci_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_raci_assignments
    ADD CONSTRAINT task_raci_assignments_pkey PRIMARY KEY (id);


--
-- Name: task_responsible_completions task_responsible_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_responsible_completions
    ADD CONSTRAINT task_responsible_completions_pkey PRIMARY KEY (id);


--
-- Name: task_statuses task_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: defined_process_steps uq_defined_process_steps_id_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_steps
    ADD CONSTRAINT uq_defined_process_steps_id_version UNIQUE (id, version_id);


--
-- Name: defined_process_steps uq_defined_process_steps_version_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_steps
    ADD CONSTRAINT uq_defined_process_steps_version_code UNIQUE (version_id, step_code);


--
-- Name: defined_process_steps uq_defined_process_steps_version_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_steps
    ADD CONSTRAINT uq_defined_process_steps_version_sequence UNIQUE (version_id, sequence_order);


--
-- Name: defined_process_versions uq_defined_process_versions_id_process; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_versions
    ADD CONSTRAINT uq_defined_process_versions_id_process UNIQUE (id, defined_process_id);


--
-- Name: defined_process_versions uq_defined_process_versions_process_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_versions
    ADD CONSTRAINT uq_defined_process_versions_process_version UNIQUE (defined_process_id, version_number);


--
-- Name: defined_processes uq_defined_processes_workspace_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT uq_defined_processes_workspace_code UNIQUE (workspace_id, code);


--
-- Name: defined_processes uq_defined_processes_workspace_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT uq_defined_processes_workspace_name UNIQUE (workspace_id, name);


--
-- Name: department_memberships uq_department_member; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_memberships
    ADD CONSTRAINT uq_department_member UNIQUE (department_id, user_id);


--
-- Name: departments uq_department_workspace_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT uq_department_workspace_code UNIQUE (workspace_id, code);


--
-- Name: departments uq_departments_id_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT uq_departments_id_workspace UNIQUE (id, workspace_id);


--
-- Name: defined_process_step_dependencies uq_step_deps_version_step_depends; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_dependencies
    ADD CONSTRAINT uq_step_deps_version_step_depends UNIQUE (version_id, step_id, depends_on_step_id);


--
-- Name: task_approval_cycles uq_task_approval_cycle; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_approval_cycles
    ADD CONSTRAINT uq_task_approval_cycle UNIQUE (task_id, cycle_number);


--
-- Name: task_consultation_responses uq_task_consult_resp; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_consultation_responses
    ADD CONSTRAINT uq_task_consult_resp UNIQUE (task_id, cycle_number, user_id);


--
-- Name: task_lists uq_task_lists_id_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT uq_task_lists_id_version UNIQUE (id, defined_process_version_id);


--
-- Name: task_responsible_completions uq_task_resp_completion; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_responsible_completions
    ADD CONSTRAINT uq_task_resp_completion UNIQUE (task_id, cycle_number, user_id);


--
-- Name: user_system_roles uq_user_system_role; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_system_roles
    ADD CONSTRAINT uq_user_system_role UNIQUE (workspace_id, user_id, role);


--
-- Name: workspace_holidays uq_workspace_holidays_workspace_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_holidays
    ADD CONSTRAINT uq_workspace_holidays_workspace_date UNIQUE (workspace_id, holiday_date);


--
-- Name: user_system_roles user_system_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_system_roles
    ADD CONSTRAINT user_system_roles_pkey PRIMARY KEY (id);


--
-- Name: workspace_holidays workspace_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_holidays
    ADD CONSTRAINT workspace_holidays_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_working_calendars workspace_working_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_working_calendars
    ADD CONSTRAINT workspace_working_calendars_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_token_idx ON auth.refresh_tokens USING btree (token);


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, email);


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: idx_defined_process_steps_version_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defined_process_steps_version_id ON public.defined_process_steps USING btree (version_id);


--
-- Name: idx_defined_process_versions_process_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defined_process_versions_process_status ON public.defined_process_versions USING btree (defined_process_id, status);


--
-- Name: idx_defined_processes_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defined_processes_owner ON public.defined_processes USING btree (process_owner_id);


--
-- Name: idx_defined_processes_source_task_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defined_processes_source_task_list ON public.defined_processes USING btree (source_task_list_id) WHERE (source_task_list_id IS NOT NULL);


--
-- Name: idx_defined_processes_ws_dept_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defined_processes_ws_dept_active ON public.defined_processes USING btree (workspace_id, department_id, is_active);


--
-- Name: idx_departments_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_code ON public.departments USING btree (workspace_id, code);


--
-- Name: idx_departments_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_workspace ON public.departments USING btree (workspace_id);


--
-- Name: idx_dept_memberships_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_memberships_dept ON public.department_memberships USING btree (department_id);


--
-- Name: idx_dept_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_memberships_user ON public.department_memberships USING btree (user_id);


--
-- Name: idx_dept_memberships_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_memberships_workspace ON public.department_memberships USING btree (workspace_id);


--
-- Name: idx_notifications_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_project ON public.notifications USING btree (project_id);


--
-- Name: idx_notifications_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_task ON public.notifications USING btree (task_id);


--
-- Name: idx_notifications_user_inbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_inbox ON public.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_notifications_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_workspace ON public.notifications USING btree (workspace_id);


--
-- Name: idx_phases_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phases_owner_id ON public.phases USING btree (owner_id);


--
-- Name: idx_phases_project_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phases_project_pos ON public.phases USING btree (project_id, "position");


--
-- Name: idx_process_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_audit_actor ON public.process_audit_events USING btree (actor_id);


--
-- Name: idx_process_audit_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_audit_project ON public.process_audit_events USING btree (project_id);


--
-- Name: idx_process_audit_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_audit_task ON public.process_audit_events USING btree (task_id);


--
-- Name: idx_process_audit_task_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_audit_task_list ON public.process_audit_events USING btree (task_list_id);


--
-- Name: idx_process_audit_ws_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_audit_ws_created ON public.process_audit_events USING btree (workspace_id, created_at DESC);


--
-- Name: idx_process_instances_defined_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_defined_process ON public.process_instances USING btree (defined_process_id, defined_process_version_id);


--
-- Name: idx_process_instances_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_owner ON public.process_instances USING btree (owner_id);


--
-- Name: idx_process_instances_parent_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_parent_task ON public.process_instances USING btree (parent_task_id) WHERE (parent_task_id IS NOT NULL);


--
-- Name: idx_process_instances_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_phase ON public.process_instances USING btree (phase_id) WHERE (phase_id IS NOT NULL);


--
-- Name: idx_process_instances_placement_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_placement_type ON public.process_instances USING btree (placement_type);


--
-- Name: idx_process_instances_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_project ON public.process_instances USING btree (project_id) WHERE (project_id IS NOT NULL);


--
-- Name: idx_process_instances_start_request_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_process_instances_start_request_unique ON public.process_instances USING btree (workspace_id, started_by, start_request_id);


--
-- Name: idx_process_instances_started_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_started_by ON public.process_instances USING btree (started_by);


--
-- Name: idx_process_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_status ON public.process_instances USING btree (status);


--
-- Name: idx_process_instances_task_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_task_list ON public.process_instances USING btree (task_list_id) WHERE (task_list_id IS NOT NULL);


--
-- Name: idx_process_instances_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_instances_workspace ON public.process_instances USING btree (workspace_id);


--
-- Name: idx_projects_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_owner ON public.projects USING btree (owner_id);


--
-- Name: idx_step_deps_depends_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_deps_depends_version ON public.defined_process_step_dependencies USING btree (depends_on_step_id, version_id);


--
-- Name: idx_step_deps_downstream; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_deps_downstream ON public.defined_process_step_dependencies USING btree (version_id, depends_on_step_id, step_id);


--
-- Name: idx_step_deps_step_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_deps_step_version ON public.defined_process_step_dependencies USING btree (step_id, version_id);


--
-- Name: idx_step_evidence_defs_step_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_evidence_defs_step_id ON public.defined_process_step_evidence_defs USING btree (step_id);


--
-- Name: idx_step_raci_step_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_raci_step_id ON public.defined_process_step_raci USING btree (step_id);


--
-- Name: idx_step_raci_user_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_raci_user_step ON public.defined_process_step_raci USING btree (user_id, step_id);


--
-- Name: idx_subtasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtasks_assignee ON public.subtasks USING btree (assignee_id);


--
-- Name: idx_subtasks_task_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtasks_task_pos ON public.subtasks USING btree (task_id, "position");


--
-- Name: idx_task_approval_decided_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_approval_decided_by ON public.task_approval_cycles USING btree (decided_by);


--
-- Name: idx_task_approval_task_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_approval_task_cycle ON public.task_approval_cycles USING btree (task_id, cycle_number);


--
-- Name: idx_task_consult_resp_task_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_consult_resp_task_cycle ON public.task_consultation_responses USING btree (task_id, cycle_number);


--
-- Name: idx_task_consult_resp_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_consult_resp_user ON public.task_consultation_responses USING btree (user_id);


--
-- Name: idx_task_evidence_def; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evidence_def ON public.task_evidence_submissions USING btree (evidence_def_id);


--
-- Name: idx_task_evidence_submitted_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evidence_submitted_by ON public.task_evidence_submissions USING btree (submitted_by);


--
-- Name: idx_task_evidence_task_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evidence_task_cycle ON public.task_evidence_submissions USING btree (task_id, cycle_number);


--
-- Name: idx_task_lists_cancelled_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_cancelled_by ON public.task_lists USING btree (cancelled_by) WHERE (cancelled_by IS NOT NULL);


--
-- Name: idx_task_lists_defined_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_defined_process ON public.task_lists USING btree (defined_process_id, defined_process_version_id) WHERE (task_list_type = 'defined'::text);


--
-- Name: idx_task_lists_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_owner_id ON public.task_lists USING btree (owner_id);


--
-- Name: idx_task_lists_phase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_phase_id ON public.task_lists USING btree (phase_id);


--
-- Name: idx_task_lists_phase_pos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_phase_pos ON public.task_lists USING btree (phase_id, "position");


--
-- Name: idx_task_lists_phase_proj; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_phase_proj ON public.task_lists USING btree (phase_id, project_id);


--
-- Name: idx_task_lists_process_version_fk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_process_version_fk ON public.task_lists USING btree (defined_process_version_id, defined_process_id);


--
-- Name: idx_task_lists_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_project ON public.task_lists USING btree (project_id);


--
-- Name: idx_task_lists_project_process_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_project_process_state ON public.task_lists USING btree (project_id, process_state) WHERE (task_list_type = 'defined'::text);


--
-- Name: idx_task_lists_started_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_lists_started_by ON public.task_lists USING btree (started_by) WHERE (started_by IS NOT NULL);


--
-- Name: idx_task_raci_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_raci_dept ON public.task_raci_assignments USING btree (department_id);


--
-- Name: idx_task_raci_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_raci_task ON public.task_raci_assignments USING btree (task_id);


--
-- Name: idx_task_raci_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_raci_user ON public.task_raci_assignments USING btree (user_id);


--
-- Name: idx_task_resp_comp_task_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_resp_comp_task_cycle ON public.task_responsible_completions USING btree (task_id, cycle_number);


--
-- Name: idx_task_resp_comp_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_resp_comp_user ON public.task_responsible_completions USING btree (user_id);


--
-- Name: idx_tasks_hierarchy_covering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_hierarchy_covering ON public.tasks USING btree (task_list_id, phase_id, project_id);


--
-- Name: idx_tasks_overdue_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_overdue_scan ON public.tasks USING btree (due_date, workflow_state) WHERE ((process_step_id IS NOT NULL) AND (due_date IS NOT NULL));


--
-- Name: idx_tasks_parent_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_parent_task_id ON public.tasks USING btree (parent_task_id) WHERE (parent_task_id IS NOT NULL);


--
-- Name: idx_tasks_phase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_phase_id ON public.tasks USING btree (phase_id);


--
-- Name: idx_tasks_phase_proj; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_phase_proj ON public.tasks USING btree (phase_id, project_id);


--
-- Name: idx_tasks_process_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_process_instance ON public.tasks USING btree (process_instance_id) WHERE (process_instance_id IS NOT NULL);


--
-- Name: idx_tasks_process_step_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_process_step_version ON public.tasks USING btree (process_step_id, defined_process_version_id) WHERE (process_step_id IS NOT NULL);


--
-- Name: idx_tasks_task_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_task_list ON public.tasks USING btree (task_list_id);


--
-- Name: idx_tasks_task_list_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_task_list_version ON public.tasks USING btree (task_list_id, defined_process_version_id) WHERE (defined_process_version_id IS NOT NULL);


--
-- Name: idx_tasks_task_list_workflow_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_task_list_workflow_state ON public.tasks USING btree (task_list_id, workflow_state) WHERE (process_step_id IS NOT NULL);


--
-- Name: idx_user_system_roles_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_system_roles_lookup ON public.user_system_roles USING btree (workspace_id, user_id, role);


--
-- Name: idx_user_system_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_system_roles_user ON public.user_system_roles USING btree (user_id);


--
-- Name: idx_user_system_roles_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_system_roles_workspace ON public.user_system_roles USING btree (workspace_id);


--
-- Name: idx_workspace_holidays_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_holidays_created_by ON public.workspace_holidays USING btree (created_by);


--
-- Name: idx_workspace_working_calendars_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_working_calendars_created_by ON public.workspace_working_calendars USING btree (created_by);


--
-- Name: uq_defined_process_versions_single_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_defined_process_versions_single_published ON public.defined_process_versions USING btree (defined_process_id) WHERE (status = 'published'::text);


--
-- Name: uq_dept_member_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_dept_member_primary ON public.department_memberships USING btree (workspace_id, user_id) WHERE ((is_primary = true) AND (is_active = true));


--
-- Name: uq_step_raci_single_accountable; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_step_raci_single_accountable ON public.defined_process_step_raci USING btree (step_id) WHERE (raci_role = 'A'::text);


--
-- Name: uq_step_raci_step_process_starter; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_step_raci_step_process_starter ON public.defined_process_step_raci USING btree (step_id, raci_role) WHERE (actor_type = 'process_starter'::text);


--
-- Name: uq_step_raci_step_role_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_step_raci_step_role_user ON public.defined_process_step_raci USING btree (step_id, raci_role, user_id) WHERE (actor_type = 'user'::text);


--
-- Name: uq_task_raci_accountable; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_task_raci_accountable ON public.task_raci_assignments USING btree (task_id) WHERE (raci_role = 'A'::text);


--
-- Name: uq_task_raci_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_task_raci_dept ON public.task_raci_assignments USING btree (task_id, raci_role, department_id) WHERE (department_id IS NOT NULL);


--
-- Name: uq_task_raci_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_task_raci_user ON public.task_raci_assignments USING btree (task_id, raci_role, user_id) WHERE (user_id IS NOT NULL);


--
-- Name: uq_tasks_instance_process_step; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tasks_instance_process_step ON public.tasks USING btree (process_instance_id, process_step_id) WHERE ((process_step_id IS NOT NULL) AND (process_instance_id IS NOT NULL));


--
-- Name: INDEX uq_tasks_instance_process_step; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_tasks_instance_process_step IS 'Enforces exactly 1 materialized task per process step inside each discrete Process Instance, supporting multiple instances in the same task list.';


--
-- Name: uq_tasks_legacy_task_list_step; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tasks_legacy_task_list_step ON public.tasks USING btree (task_list_id, process_step_id) WHERE ((process_step_id IS NOT NULL) AND (process_instance_id IS NULL));


--
-- Name: INDEX uq_tasks_legacy_task_list_step; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_tasks_legacy_task_list_step IS 'Enforces exactly 1 materialized task per process step inside a legacy Defined Process Task List.';


--
-- Name: defined_process_step_evidence_defs trg_defined_process_step_evidence_defs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defined_process_step_evidence_defs_updated_at BEFORE UPDATE ON public.defined_process_step_evidence_defs FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: defined_process_steps trg_defined_process_steps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defined_process_steps_updated_at BEFORE UPDATE ON public.defined_process_steps FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: defined_process_versions trg_defined_process_versions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defined_process_versions_updated_at BEFORE UPDATE ON public.defined_process_versions FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: defined_processes trg_defined_processes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defined_processes_updated_at BEFORE UPDATE ON public.defined_processes FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: process_instances trg_process_instances_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_process_instances_updated_at BEFORE UPDATE ON public.process_instances FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: task_raci_assignments trg_raci_assigned; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_raci_assigned AFTER INSERT ON public.task_raci_assignments FOR EACH ROW EXECUTE FUNCTION private.trg_fn_raci_assigned();


--
-- Name: subtasks trg_subtask_assigned; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subtask_assigned AFTER INSERT OR UPDATE OF assignee_id ON public.subtasks FOR EACH ROW EXECUTE FUNCTION private.trg_fn_subtask_assigned();


--
-- Name: task_lists trg_task_lists_guard_defined_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_lists_guard_defined_mutation BEFORE INSERT OR DELETE OR UPDATE ON public.task_lists FOR EACH ROW EXECUTE FUNCTION private.trg_fn_guard_defined_task_list_mutation();


--
-- Name: tasks trg_task_status_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_status_changed AFTER UPDATE OF status_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION private.trg_fn_task_status_changed();


--
-- Name: tasks trg_tasks_guard_defined_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_guard_defined_mutation BEFORE INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION private.trg_fn_guard_defined_task_mutation();


--
-- Name: tasks trg_validate_legacy_task_list_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_legacy_task_list_version BEFORE INSERT OR UPDATE OF task_list_id, process_step_id, defined_process_version_id, process_instance_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION private.sync_validate_legacy_task_list_version();


--
-- Name: workspace_holidays trg_workspace_holidays_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_holidays_updated_at BEFORE UPDATE ON public.workspace_holidays FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: workspace_working_calendars trg_workspace_working_calendars_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_working_calendars_updated_at BEFORE UPDATE ON public.workspace_working_calendars FOR EACH ROW EXECUTE FUNCTION private.trg_fn_set_updated_at();


--
-- Name: defined_process_step_dependencies defined_process_step_dependencies_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_dependencies
    ADD CONSTRAINT defined_process_step_dependencies_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.defined_process_versions(id) ON DELETE CASCADE;


--
-- Name: defined_process_step_evidence_defs defined_process_step_evidence_defs_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_evidence_defs
    ADD CONSTRAINT defined_process_step_evidence_defs_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.defined_process_steps(id) ON DELETE CASCADE;


--
-- Name: defined_process_step_raci defined_process_step_raci_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_raci
    ADD CONSTRAINT defined_process_step_raci_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.defined_process_steps(id) ON DELETE CASCADE;


--
-- Name: defined_process_step_raci defined_process_step_raci_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_raci
    ADD CONSTRAINT defined_process_step_raci_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_process_steps defined_process_steps_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_steps
    ADD CONSTRAINT defined_process_steps_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.defined_process_versions(id) ON DELETE CASCADE;


--
-- Name: defined_process_versions defined_process_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_versions
    ADD CONSTRAINT defined_process_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_process_versions defined_process_versions_defined_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_versions
    ADD CONSTRAINT defined_process_versions_defined_process_id_fkey FOREIGN KEY (defined_process_id) REFERENCES public.defined_processes(id) ON DELETE CASCADE;


--
-- Name: defined_process_versions defined_process_versions_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_versions
    ADD CONSTRAINT defined_process_versions_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_approval_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_approval_decided_by_fkey FOREIGN KEY (approval_decided_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_process_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_process_owner_id_fkey FOREIGN KEY (process_owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_source_task_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_source_task_list_id_fkey FOREIGN KEY (source_task_list_id) REFERENCES public.task_lists(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_submitted_for_approval_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_submitted_for_approval_by_fkey FOREIGN KEY (submitted_for_approval_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: defined_processes defined_processes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT defined_processes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: department_memberships department_memberships_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_memberships
    ADD CONSTRAINT department_memberships_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: department_memberships department_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_memberships
    ADD CONSTRAINT department_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: department_memberships department_memberships_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_memberships
    ADD CONSTRAINT department_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: departments departments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: departments departments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: defined_processes fk_defined_processes_dept_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_processes
    ADD CONSTRAINT fk_defined_processes_dept_workspace FOREIGN KEY (department_id, workspace_id) REFERENCES public.departments(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: defined_process_step_dependencies fk_step_deps_depends_on_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_dependencies
    ADD CONSTRAINT fk_step_deps_depends_on_version FOREIGN KEY (depends_on_step_id, version_id) REFERENCES public.defined_process_steps(id, version_id) ON DELETE CASCADE;


--
-- Name: defined_process_step_dependencies fk_step_deps_step_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defined_process_step_dependencies
    ADD CONSTRAINT fk_step_deps_step_version FOREIGN KEY (step_id, version_id) REFERENCES public.defined_process_steps(id, version_id) ON DELETE CASCADE;


--
-- Name: task_lists fk_task_lists_phase; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT fk_task_lists_phase FOREIGN KEY (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT;


--
-- Name: task_lists fk_task_lists_process_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT fk_task_lists_process_version FOREIGN KEY (defined_process_version_id, defined_process_id) REFERENCES public.defined_process_versions(id, defined_process_id) ON DELETE RESTRICT;


--
-- Name: task_lists fk_task_lists_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT fk_task_lists_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_phase; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_phase FOREIGN KEY (phase_id, project_id) REFERENCES public.phases(id, project_id) ON DELETE RESTRICT;


--
-- Name: tasks fk_tasks_step_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_step_version FOREIGN KEY (process_step_id, defined_process_version_id) REFERENCES public.defined_process_steps(id, version_id) ON DELETE RESTRICT;


--
-- Name: tasks fk_tasks_task_list; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_task_list FOREIGN KEY (task_list_id, phase_id, project_id) REFERENCES public.task_lists(id, phase_id, project_id) ON DELETE RESTRICT;


--
-- Name: notifications notifications_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: phases phases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: phases phases_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: phases phases_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: process_audit_events process_audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_audit_events
    ADD CONSTRAINT process_audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: process_audit_events process_audit_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_audit_events
    ADD CONSTRAINT process_audit_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;


--
-- Name: process_audit_events process_audit_events_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_audit_events
    ADD CONSTRAINT process_audit_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: process_audit_events process_audit_events_task_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_audit_events
    ADD CONSTRAINT process_audit_events_task_list_id_fkey FOREIGN KEY (task_list_id) REFERENCES public.task_lists(id) ON DELETE RESTRICT;


--
-- Name: process_audit_events process_audit_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_audit_events
    ADD CONSTRAINT process_audit_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: process_instances process_instances_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: process_instances process_instances_defined_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_defined_process_id_fkey FOREIGN KEY (defined_process_id) REFERENCES public.defined_processes(id) ON DELETE RESTRICT;


--
-- Name: process_instances process_instances_defined_process_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_defined_process_version_id_fkey FOREIGN KEY (defined_process_version_id) REFERENCES public.defined_process_versions(id) ON DELETE RESTRICT;


--
-- Name: process_instances process_instances_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: process_instances process_instances_parent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: process_instances process_instances_phase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.phases(id) ON DELETE SET NULL;


--
-- Name: process_instances process_instances_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: process_instances process_instances_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: process_instances process_instances_task_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_task_list_id_fkey FOREIGN KEY (task_list_id) REFERENCES public.task_lists(id) ON DELETE SET NULL;


--
-- Name: process_instances process_instances_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: projects projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);


--
-- Name: projects projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: subtasks subtasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: subtasks subtasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: subtasks subtasks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_approval_cycles task_approval_cycles_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_approval_cycles
    ADD CONSTRAINT task_approval_cycles_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_approval_cycles task_approval_cycles_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_approval_cycles
    ADD CONSTRAINT task_approval_cycles_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: task_consultation_responses task_consultation_responses_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_consultation_responses
    ADD CONSTRAINT task_consultation_responses_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: task_consultation_responses task_consultation_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_consultation_responses
    ADD CONSTRAINT task_consultation_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_evidence_submissions task_evidence_submissions_evidence_def_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evidence_submissions
    ADD CONSTRAINT task_evidence_submissions_evidence_def_id_fkey FOREIGN KEY (evidence_def_id) REFERENCES public.defined_process_step_evidence_defs(id) ON DELETE RESTRICT;


--
-- Name: task_evidence_submissions task_evidence_submissions_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evidence_submissions
    ADD CONSTRAINT task_evidence_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_evidence_submissions task_evidence_submissions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evidence_submissions
    ADD CONSTRAINT task_evidence_submissions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: task_lists task_lists_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_lists task_lists_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_lists task_lists_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_lists task_lists_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_lists
    ADD CONSTRAINT task_lists_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_raci_assignments task_raci_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_raci_assignments
    ADD CONSTRAINT task_raci_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: task_raci_assignments task_raci_assignments_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_raci_assignments
    ADD CONSTRAINT task_raci_assignments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: task_raci_assignments task_raci_assignments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_raci_assignments
    ADD CONSTRAINT task_raci_assignments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_raci_assignments task_raci_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_raci_assignments
    ADD CONSTRAINT task_raci_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: task_responsible_completions task_responsible_completions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_responsible_completions
    ADD CONSTRAINT task_responsible_completions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;


--
-- Name: task_responsible_completions task_responsible_completions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_responsible_completions
    ADD CONSTRAINT task_responsible_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_statuses task_statuses_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id);


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: tasks tasks_parent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_process_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_process_instance_id_fkey FOREIGN KEY (process_instance_id) REFERENCES public.process_instances(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.task_statuses(id);


--
-- Name: tasks tasks_task_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_task_list_id_fkey FOREIGN KEY (task_list_id) REFERENCES public.task_lists(id) ON DELETE RESTRICT;


--
-- Name: user_system_roles user_system_roles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_system_roles
    ADD CONSTRAINT user_system_roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: user_system_roles user_system_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_system_roles
    ADD CONSTRAINT user_system_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_system_roles user_system_roles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_system_roles
    ADD CONSTRAINT user_system_roles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_holidays workspace_holidays_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_holidays
    ADD CONSTRAINT workspace_holidays_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: workspace_holidays workspace_holidays_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_holidays
    ADD CONSTRAINT workspace_holidays_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspace_working_calendars(workspace_id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_working_calendars workspace_working_calendars_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_working_calendars
    ADD CONSTRAINT workspace_working_calendars_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: workspace_working_calendars workspace_working_calendars_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_working_calendars
    ADD CONSTRAINT workspace_working_calendars_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: defined_process_step_dependencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.defined_process_step_dependencies ENABLE ROW LEVEL SECURITY;

--
-- Name: defined_process_step_dependencies defined_process_step_dependencies_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY defined_process_step_dependencies_select_member ON public.defined_process_step_dependencies FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.defined_process_versions dpv
     JOIN public.defined_processes dp ON ((dp.id = dpv.defined_process_id)))
  WHERE ((dpv.id = defined_process_step_dependencies.version_id) AND private.is_workspace_active_member(dp.workspace_id)))));


--
-- Name: defined_process_step_evidence_defs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.defined_process_step_evidence_defs ENABLE ROW LEVEL SECURITY;

--
-- Name: defined_process_step_evidence_defs defined_process_step_evidence_defs_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY defined_process_step_evidence_defs_select_member ON public.defined_process_step_evidence_defs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.defined_process_steps dps
     JOIN public.defined_process_versions dpv ON ((dpv.id = dps.version_id)))
     JOIN public.defined_processes dp ON ((dp.id = dpv.defined_process_id)))
  WHERE ((dps.id = defined_process_step_evidence_defs.step_id) AND private.is_workspace_active_member(dp.workspace_id)))));


--
-- Name: defined_process_step_raci; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.defined_process_step_raci ENABLE ROW LEVEL SECURITY;

--
-- Name: defined_process_step_raci defined_process_step_raci_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY defined_process_step_raci_select_member ON public.defined_process_step_raci FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.defined_process_steps dps
     JOIN public.defined_process_versions dpv ON ((dpv.id = dps.version_id)))
     JOIN public.defined_processes dp ON ((dp.id = dpv.defined_process_id)))
  WHERE ((dps.id = defined_process_step_raci.step_id) AND private.is_workspace_active_member(dp.workspace_id)))));


--
-- Name: defined_process_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.defined_process_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: defined_process_steps defined_process_steps_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY defined_process_steps_select_member ON public.defined_process_steps FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.defined_process_versions dpv
     JOIN public.defined_processes dp ON ((dp.id = dpv.defined_process_id)))
  WHERE ((dpv.id = defined_process_steps.version_id) AND private.is_workspace_active_member(dp.workspace_id)))));


--
-- Name: defined_process_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.defined_process_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: defined_process_versions defined_process_versions_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY defined_process_versions_select_member ON public.defined_process_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.defined_processes dp
  WHERE ((dp.id = defined_process_versions.defined_process_id) AND private.is_workspace_active_member(dp.workspace_id)))));


--
-- Name: defined_processes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.defined_processes ENABLE ROW LEVEL SECURITY;

--
-- Name: defined_processes defined_processes_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY defined_processes_select_member ON public.defined_processes FOR SELECT TO authenticated USING (( SELECT private.is_workspace_active_member(defined_processes.workspace_id) AS is_workspace_active_member));


--
-- Name: department_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.department_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: departments departments_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_delete_owner ON public.departments FOR DELETE TO authenticated USING (((private.get_user_workspace_role(workspace_id) = 'owner'::text) OR private.has_system_role(workspace_id, 'system_admin'::text)));


--
-- Name: departments departments_insert_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_insert_manage ON public.departments FOR INSERT TO authenticated WITH CHECK (private.can_administer_workspace(workspace_id));


--
-- Name: departments departments_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_select_member ON public.departments FOR SELECT TO authenticated USING (private.is_workspace_active_member(workspace_id));


--
-- Name: departments departments_update_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_update_manage ON public.departments FOR UPDATE TO authenticated USING (private.can_administer_workspace(workspace_id)) WITH CHECK (private.can_administer_workspace(workspace_id));


--
-- Name: department_memberships dept_memberships_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dept_memberships_select_member ON public.department_memberships FOR SELECT TO authenticated USING (private.is_workspace_active_member(workspace_id));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: phases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phases ENABLE ROW LEVEL SECURITY;

--
-- Name: phases phases_delete_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phases_delete_member ON public.phases FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: phases phases_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phases_insert_member ON public.phases FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: phases phases_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phases_select_member ON public.phases FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: phases phases_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phases_update_member ON public.phases FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = phases.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: process_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.process_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: process_audit_events process_audit_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY process_audit_select_member ON public.process_audit_events FOR SELECT TO authenticated USING (private.is_workspace_active_member(workspace_id));


--
-- Name: process_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: process_instances process_instances_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY process_instances_select_policy ON public.process_instances FOR SELECT TO authenticated USING (private.can_read_process_instance(id, auth.uid()));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: projects projects_delete_admin_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_delete_admin_owner ON public.projects FOR DELETE TO authenticated USING (private.can_administer_workspace(workspace_id));


--
-- Name: projects projects_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_insert_member ON public.projects FOR INSERT TO authenticated WITH CHECK (((private.get_user_workspace_role(workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(workspace_id, 'system_admin'::text) OR private.has_system_role(workspace_id, 'project_admin'::text)));


--
-- Name: projects projects_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_select_member ON public.projects FOR SELECT TO authenticated USING ((private.get_user_workspace_role(workspace_id) IS NOT NULL));


--
-- Name: projects projects_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_update_member ON public.projects FOR UPDATE TO authenticated USING (((private.get_user_workspace_role(workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(workspace_id, 'system_admin'::text) OR private.has_system_role(workspace_id, 'project_admin'::text))) WITH CHECK (((private.get_user_workspace_role(workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(workspace_id, 'system_admin'::text) OR private.has_system_role(workspace_id, 'project_admin'::text)));


--
-- Name: subtasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

--
-- Name: subtasks subtasks_delete_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subtasks_delete_member ON public.subtasks FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = subtasks.task_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: subtasks subtasks_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subtasks_insert_member ON public.subtasks FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = subtasks.task_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: subtasks subtasks_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subtasks_select_member ON public.subtasks FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = subtasks.task_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: subtasks subtasks_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subtasks_update_member ON public.subtasks FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = subtasks.task_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = subtasks.task_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: task_approval_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_approval_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: task_approval_cycles task_approval_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_approval_select_member ON public.task_approval_cycles FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_approval_cycles.task_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: task_consultation_responses task_consult_resp_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_consult_resp_select_member ON public.task_consultation_responses FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_consultation_responses.task_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: task_consultation_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_consultation_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: task_evidence_submissions task_evidence_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_evidence_select_member ON public.task_evidence_submissions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_evidence_submissions.task_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: task_evidence_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_evidence_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: task_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: task_lists task_lists_delete_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_lists_delete_member ON public.task_lists FOR DELETE TO authenticated USING (((task_list_type = 'custom'::text) AND ((( SELECT private.get_user_workspace_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = task_lists.project_id))) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text])) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = task_lists.project_id)), 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = task_lists.project_id)), 'system_admin'::text) AS has_system_role))));


--
-- Name: task_lists task_lists_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_lists_insert_member ON public.task_lists FOR INSERT TO authenticated WITH CHECK (((task_list_type = 'custom'::text) AND ((( SELECT private.get_user_workspace_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = task_lists.project_id))) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = task_lists.project_id)), 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = task_lists.project_id)), 'system_admin'::text) AS has_system_role))));


--
-- Name: task_lists task_lists_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_lists_select_member ON public.task_lists FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_lists.project_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: task_lists task_lists_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_lists_update_member ON public.task_lists FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_lists.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_lists.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: task_raci_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_raci_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_raci_assignments task_raci_delete_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_raci_delete_member ON public.task_raci_assignments FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_raci_assignments.task_id) AND (t.process_step_id IS NULL) AND ((( SELECT private.get_user_workspace_role(p.workspace_id) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(p.workspace_id, 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(p.workspace_id, 'system_admin'::text) AS has_system_role))))));


--
-- Name: task_raci_assignments task_raci_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_raci_insert_member ON public.task_raci_assignments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_raci_assignments.task_id) AND (t.process_step_id IS NULL) AND ((( SELECT private.get_user_workspace_role(p.workspace_id) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(p.workspace_id, 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(p.workspace_id, 'system_admin'::text) AS has_system_role))))));


--
-- Name: task_raci_assignments task_raci_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_raci_select_member ON public.task_raci_assignments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_raci_assignments.task_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: task_raci_assignments task_raci_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_raci_update_member ON public.task_raci_assignments FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_raci_assignments.task_id) AND (t.process_step_id IS NULL) AND ((( SELECT private.get_user_workspace_role(p.workspace_id) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(p.workspace_id, 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(p.workspace_id, 'system_admin'::text) AS has_system_role)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_raci_assignments.task_id) AND (t.process_step_id IS NULL) AND ((( SELECT private.get_user_workspace_role(p.workspace_id) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(p.workspace_id, 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(p.workspace_id, 'system_admin'::text) AS has_system_role))))));


--
-- Name: task_responsible_completions task_resp_comp_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_resp_comp_select_member ON public.task_responsible_completions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.tasks t
     JOIN public.projects p ON ((p.id = t.project_id)))
  WHERE ((t.id = task_responsible_completions.task_id) AND private.is_workspace_active_member(p.workspace_id)))));


--
-- Name: task_responsible_completions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_responsible_completions ENABLE ROW LEVEL SECURITY;

--
-- Name: task_statuses task_statuses_delete_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_statuses_delete_member ON public.task_statuses FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_statuses.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: task_statuses task_statuses_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_statuses_insert_member ON public.task_statuses FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_statuses.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: task_statuses task_statuses_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_statuses_select_member ON public.task_statuses FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_statuses.project_id) AND (private.get_user_workspace_role(p.workspace_id) IS NOT NULL)))));


--
-- Name: task_statuses task_statuses_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_statuses_update_member ON public.task_statuses FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_statuses.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = task_statuses.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: tasks tasks_delete_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_delete_member ON public.tasks FOR DELETE TO authenticated USING (((process_step_id IS NULL) AND ((( SELECT private.get_user_workspace_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = tasks.project_id))) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = tasks.project_id)), 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = tasks.project_id)), 'system_admin'::text) AS has_system_role))));


--
-- Name: tasks tasks_insert_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert_member ON public.tasks FOR INSERT TO authenticated WITH CHECK (((process_step_id IS NULL) AND (defined_process_version_id IS NULL) AND (workflow_state IS NULL) AND ((task_list_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.task_lists tl
  WHERE ((tl.id = tasks.task_list_id) AND (tl.task_list_type = 'custom'::text))))) AND ((( SELECT private.get_user_workspace_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = tasks.project_id))) AS get_user_workspace_role) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = tasks.project_id)), 'project_admin'::text) AS has_system_role) OR ( SELECT private.has_system_role(( SELECT p.workspace_id
           FROM public.projects p
          WHERE (p.id = tasks.project_id)), 'system_admin'::text) AS has_system_role))));


--
-- Name: tasks tasks_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_member ON public.tasks FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = tasks.project_id) AND (private.get_user_workspace_role(p.workspace_id) IS NOT NULL)))));


--
-- Name: tasks tasks_select_standalone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_standalone ON public.tasks FOR SELECT TO authenticated USING (((project_id IS NULL) AND (process_instance_id IS NOT NULL) AND private.can_read_process_instance(process_instance_id, auth.uid())));


--
-- Name: tasks tasks_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_update_member ON public.tasks FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = tasks.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = tasks.project_id) AND ((private.get_user_workspace_role(p.workspace_id) = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])) OR private.has_system_role(p.workspace_id, 'system_admin'::text) OR private.has_system_role(p.workspace_id, 'project_admin'::text))))));


--
-- Name: user_system_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_system_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_system_roles user_system_roles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_system_roles_select ON public.user_system_roles FOR SELECT TO authenticated USING (private.is_workspace_active_member(workspace_id));


--
-- Name: workspace_holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_holidays workspace_holidays_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_holidays_select_member ON public.workspace_holidays FOR SELECT TO authenticated USING (( SELECT private.is_workspace_active_member(workspace_holidays.workspace_id) AS is_workspace_active_member));


--
-- Name: workspace_members workspace_members_insert_bootstrap; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_insert_bootstrap ON public.workspace_members FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (role = 'owner'::text) AND (status = 'active'::text) AND (NOT (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE (wm.workspace_id = workspace_members.workspace_id))))));


--
-- Name: workspace_members workspace_members_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_select_active ON public.workspace_members FOR SELECT TO authenticated USING (private.is_workspace_active_member(workspace_id));


--
-- Name: workspace_working_calendars; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_working_calendars ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_working_calendars workspace_working_calendars_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_working_calendars_select_member ON public.workspace_working_calendars FOR SELECT TO authenticated USING (( SELECT private.is_workspace_active_member(workspace_working_calendars.workspace_id) AS is_workspace_active_member));


--
-- Name: workspaces workspaces_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_delete_owner ON public.workspaces FOR DELETE TO authenticated USING ((private.get_user_workspace_role(id) = 'owner'::text));


--
-- Name: workspaces workspaces_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_select_member ON public.workspaces FOR SELECT TO authenticated USING (private.is_workspace_active_member(id));


--
-- Name: workspaces workspaces_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_update_owner ON public.workspaces FOR UPDATE TO authenticated USING (((private.get_user_workspace_role(id) = ANY (ARRAY['owner'::text, 'admin'::text])) OR private.has_system_role(id, 'system_admin'::text))) WITH CHECK (((private.get_user_workspace_role(id) = ANY (ARRAY['owner'::text, 'admin'::text])) OR private.has_system_role(id, 'system_admin'::text)));


--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime notifications; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.notifications;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict YzZj51NVVo5TKUwCbLP34byPMJscIPyiJ2DNgD6DgDkqEm9q855fufQbv328nZC

