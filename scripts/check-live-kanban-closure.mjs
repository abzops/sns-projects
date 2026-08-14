import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = process.cwd();
const envAdminPath = path.join(repoRoot, '.env.admin');

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

async function verifyLive() {
  console.log('=== SNS Projects Live Kanban Closure & Database Verification ===\n');
  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));

  const pgClient = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: Number(envAdmin.SUPABASE_DB_PORT || '5432'),
    database: envAdmin.SUPABASE_DB_NAME || 'postgres',
    user: envAdmin.SUPABASE_DB_USER || 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  // 1. Check duplicate positions
  const { rows: dups } = await pgClient.query(`
    SELECT project_id, status_id, position, count(*) as count
    FROM public.tasks
    GROUP BY project_id, status_id, position
    HAVING count(*) > 1;
  `);

  console.log(`Duplicate project/status/position groups: ${dups.length}`);
  if (dups.length > 0) {
    console.error('FAIL: Found duplicates:', dups);
    process.exit(1);
  }

  // 2. Check total counts
  const { rows: pCounts } = await pgClient.query(`SELECT count(*)::int as count FROM public.projects WHERE workspace_id = $1;`, [wsId]);
  const { rows: mCounts } = await pgClient.query(`SELECT count(*)::int as count FROM public.milestones WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1);`, [wsId]);
  const { rows: tlCounts } = await pgClient.query(`SELECT count(*)::int as count FROM public.task_lists WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1);`, [wsId]);
  const { rows: tCounts } = await pgClient.query(`SELECT count(*)::int as count FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1);`, [wsId]);
  const { rows: stCounts } = await pgClient.query(`SELECT count(*)::int as count FROM public.subtasks WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1));`, [wsId]);
  const { rows: raciCounts } = await pgClient.query(`SELECT count(*)::int as count FROM public.task_raci_assignments WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id IN (SELECT id FROM public.projects WHERE workspace_id = $1));`, [wsId]);

  console.log(`Live Dataset Invariants:`);
  console.log(`  Projects: ${pCounts[0].count} (Expected: 3)`);
  console.log(`  Milestones: ${mCounts[0].count} (Expected: 6)`);
  console.log(`  Task Lists: ${tlCounts[0].count} (Expected: 12)`);
  console.log(`  Tasks: ${tCounts[0].count} (Expected: 24)`);
  console.log(`  Subtasks: ${stCounts[0].count} (Expected: 48)`);
  console.log(`  RACI: ${raciCounts[0].count} (Expected: 72)`);

  // 3. Check distribution per project
  const { rows: distRows } = await pgClient.query(`
    SELECT p.name as project_name, ts.system_code, count(t.id) as task_count,
           array_agg(t.position ORDER BY t.position) as positions,
           array_agg(t.title ORDER BY t.position) as titles
    FROM public.projects p
    JOIN public.task_statuses ts ON ts.project_id = p.id
    LEFT JOIN public.tasks t ON t.status_id = ts.id
    WHERE p.workspace_id = $1
    GROUP BY p.name, ts.system_code, ts.position
    ORDER BY p.name, ts.position;
  `, [wsId]);

  console.log('\nDetailed Column Distribution:');
  for (const r of distRows) {
    if (r.task_count > 0) {
      console.log(`  [${r.project_name}] ${r.system_code.padEnd(12)} (${r.task_count} tasks): ${r.positions.join(', ')}`);
      for (let i = 0; i < r.titles.length; i++) {
        console.log(`     - pos ${r.positions[i]}: ${r.titles[i]}`);
      }
    } else {
      console.log(`  [${r.project_name}] ${r.system_code.padEnd(12)} (0 tasks)`);
    }
  }

  await pgClient.end();
}

verifyLive().catch(err => {
  console.error(err);
  process.exit(1);
});
