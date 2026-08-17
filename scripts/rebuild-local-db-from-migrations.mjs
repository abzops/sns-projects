import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const setupSqlPath = path.join(repoRoot, 'supabase', 'setup.sql');

async function rebuildLocalDbFromMigrations() {
  console.log('======================================================================');
  console.log('SNS Projects — Clean Local Database Rebuild from Migrations');
  console.log('======================================================================\n');

  const client = new Client({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });

  await client.connect();
  console.log('Connected to PostgreSQL container at 127.0.0.1:54322\n');

  try {
    // 1. Clean public schema
    console.log('1. Dropping and recreating public and private schemas...');
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres, public;
      DROP SCHEMA IF EXISTS private CASCADE;
      CREATE SCHEMA private;
      GRANT ALL ON SCHEMA private TO postgres;
      CREATE SCHEMA IF NOT EXISTS auth;
    `);

    // 2. Load base setup (pre-Day0 core tables: profiles, workspaces, members, projects, statuses, tasks)
    console.log('2. Initializing pre-Day0 base schema from setup.sql...');
    const setupSql = await readFile(setupSqlPath, 'utf8');
    // Extract base table DDL (lines 20-180 of setup.sql)
    const baseDdl = `
      CREATE TABLE IF NOT EXISTS public.profiles (
        id         uuid PRIMARY KEY,
        full_name  text,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.workspaces (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name       text NOT NULL,
        created_by uuid REFERENCES public.profiles(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.workspace_members (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        user_id       uuid REFERENCES public.profiles(id),
        invited_email text,
        role          text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
        status        text NOT NULL CHECK (status IN ('active', 'pending', 'declined')) DEFAULT 'pending',
        invited_by    uuid REFERENCES public.profiles(id),
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.projects (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        name         text NOT NULL,
        description  text,
        color        text DEFAULT '#f5c400',
        created_by   uuid REFERENCES public.profiles(id),
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.task_statuses (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
        name       text NOT NULL,
        color      text NOT NULL,
        position   integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.tasks (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
        title       text NOT NULL,
        description text,
        status_id   uuid REFERENCES public.task_statuses(id),
        priority    text CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')) DEFAULT 'none',
        assignee_id uuid REFERENCES public.profiles(id),
        due_date    date,
        position    integer NOT NULL DEFAULT 0,
        created_by  uuid REFERENCES public.profiles(id),
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION public.get_user_workspace_role(p_workspace_id uuid)
      RETURNS text
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT role
        FROM public.workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = auth.uid()
          AND status = 'active'
        LIMIT 1;
      $$;
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
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
    `;
    await client.query(baseDdl);
    console.log('✓ Base schema initialized successfully.\n');

    // 3. Sequentially apply all migration files
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    console.log(`3. Applying ${files.length} migrations in sequential order:\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      process.stdout.write(`  [${String(i + 1).padStart(2, '0')}/${files.length}] ${file} ... `);
      await client.query(sql);
      console.log('APPLIED');
    }

    console.log('\n======================================================================');
    console.log(`SUCCESS: All ${files.length} migrations applied with 0 errors!`);
    console.log('======================================================================\n');
  } finally {
    await client.end();
  }
}

rebuildLocalDbFromMigrations().catch(err => {
  console.error('\n✗ Rebuild failed:', err);
  process.exit(1);
});
