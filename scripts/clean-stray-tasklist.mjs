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

async function main() {
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

  const strayId = 'a45089b8-098c-4ce7-a1d9-96ca5d90c252';

  // 1. Verify it exists, is named 'Test', and has 0 tasks
  const { rows: checkRows } = await pgClient.query(`
    SELECT tl.id, tl.name, count(t.id) as task_count
    FROM public.task_lists tl
    LEFT JOIN public.tasks t ON t.task_list_id = tl.id
    WHERE tl.id = '${strayId}'
    GROUP BY tl.id, tl.name;
  `);

  console.log('Stray Task List check:', checkRows);
  if (checkRows.length === 0) {
    console.log('Stray Task List already removed.');
  } else if (Number(checkRows[0].task_count) === 0 && checkRows[0].name === 'Test') {
    await pgClient.query(`DELETE FROM public.task_lists WHERE id = '${strayId}';`);
    console.log(`✅ Successfully deleted stray empty Task List '${strayId}'`);
  } else {
    console.error('❌ Stray Task List is not empty or has unexpected name!');
  }

  // 2. Verify all task lists in ASRS project
  const asrsProjId = 'f60d8120-09f8-469c-9278-4b591dfe75a8';
  const { rows: asrsLists } = await pgClient.query(`
    SELECT tl.id, tl.name, m.name as milestone_name, count(t.id) as task_count
    FROM public.task_lists tl
    LEFT JOIN public.milestones m ON m.id = tl.milestone_id
    LEFT JOIN public.tasks t ON t.task_list_id = tl.id
    WHERE tl.project_id = '${asrsProjId}'
    GROUP BY tl.id, tl.name, m.name, m.position, tl.position
    ORDER BY m.position, tl.position;
  `);
  console.log('\nASRS Task Lists after cleanup:');
  console.table(asrsLists);

  await pgClient.end();
}

main().catch(console.error);
