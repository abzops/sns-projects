import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const repoRoot = process.cwd();
const envAppPath = path.join(repoRoot, '.env');

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
  const envApp = parseEnv(await readFile(envAppPath, 'utf8'));
  const supabase = createClient(envApp.VITE_SUPABASE_URL, envApp.VITE_SUPABASE_ANON_KEY);

  // Require explicit password via environment variable; never guess or use fallbacks
  const password = process.env.TEST_USER_PASSWORD;
  if (!password) {
    console.log('[SKIP] TEST_USER_PASSWORD not set. Skipping live authenticated query.');
    return;
  }

  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_EMAIL || 'abhinand@stacknstock.in',
    password,
  });

  if (authErr) {
    console.error('Auth error:', authErr);
  } else {
    console.log('Authenticated as:', authData.user.email);
  }

  // Find ASRS Product Development project ID
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name')
    .ilike('name', '%ASRS%');
  
  if (pErr) console.error('Project query error:', pErr);
  console.log('Found ASRS project:', projects);

  const projectId = projects[0]?.id;

  // Run exact useTaskLists step 1 query
  console.log('\n--- Testing useTaskLists Step 1 Query ---');
  const { data: listData, error: lErr } = await supabase
    .from('task_lists')
    .select(`
      *,
      milestones:milestone_id (
        id,
        name,
        project_id
      )
    `)
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (lErr) {
    console.error('❌ Step 1 query error:', lErr);
  } else {
    console.log(`✅ Step 1 query returned ${listData.length} task lists:`, listData);
  }

  // Run exact useTaskLists step 2 query
  console.log('\n--- Testing useTaskLists Step 2 Query ---');
  const { data: taskData, error: tErr } = await supabase
    .from('tasks')
    .select(`
      id,
      task_list_id,
      task_statuses:status_id (
        id,
        system_code,
        name
      )
    `)
    .eq('project_id', projectId)
    .not('task_list_id', 'is', null);

  if (tErr) {
    console.error('❌ Step 2 query error:', tErr);
  } else {
    console.log(`✅ Step 2 query returned ${taskData.length} tasks:`, taskData);
  }
}

main().catch(console.error);
