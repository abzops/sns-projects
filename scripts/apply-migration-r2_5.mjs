import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260814_03_hierarchy_alignment.sql');

function parseEnv(content) {
  return content
    .split(/\r?\n/)
    .reduce((values, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return values;
      const equalsIndex = line.indexOf('=');
      if (equalsIndex <= 0) return values;
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      values[key] = value;
      return values;
    }, {});
}

async function main() {
  const env = parseEnv(await readFile(envAdminPath, 'utf8'));
  const sql = await readFile(migrationPath, 'utf8');

  const client = new Client({
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(env.SUPABASE_DB_PORT || '5432'),
    database: env.SUPABASE_DB_NAME || 'postgres',
    user: env.SUPABASE_DB_USER || 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL database.');

  // Check pre-migration counts
  const { rows: preProj } = await client.query('SELECT count(*)::int as count FROM public.projects');
  const { rows: preTasks } = await client.query('SELECT count(*)::int as count FROM public.tasks');
  const { rows: preRaci } = await client.query('SELECT count(*)::int as count FROM public.task_raci_assignments');

  console.log(`Pre-migration state: ${preProj[0].count} projects, ${preTasks[0].count} tasks, ${preRaci[0].count} raci rows.`);

  console.log('Applying 20260814_03_hierarchy_alignment.sql...');
  await client.query(sql);
  console.log('Migration applied successfully!');

  // Check post-migration counts
  const { rows: postProj } = await client.query('SELECT count(*)::int as count FROM public.projects');
  const { rows: postTasks } = await client.query('SELECT count(*)::int as count FROM public.tasks');
  const { rows: postRaci } = await client.query('SELECT count(*)::int as count FROM public.task_raci_assignments');

  console.log(`Post-migration state: ${postProj[0].count} projects, ${postTasks[0].count} tasks, ${postRaci[0].count} raci rows.`);

  if (postProj[0].count !== preProj[0].count || postTasks[0].count !== preTasks[0].count) {
    throw new Error('FATAL: Pre and post migration entity counts do not match!');
  }

  // Verify new tables exist and are queryable
  const { rows: mCount } = await client.query('SELECT count(*)::int as count FROM public.milestones');
  const { rows: tlCount } = await client.query('SELECT count(*)::int as count FROM public.task_lists');
  const { rows: stCount } = await client.query('SELECT count(*)::int as count FROM public.subtasks');

  console.log(`New hierarchy tables verified: ${mCount[0].count} milestones, ${tlCount[0].count} task_lists, ${stCount[0].count} subtasks.`);

  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
