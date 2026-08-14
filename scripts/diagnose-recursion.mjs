import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg

function parseEnv(content) {
  return content.split(/\r?\n/).reduce((v, l) => {
    l = l.trim(); if (!l || l[0] === '#') return v;
    const i = l.indexOf('='); if (i <= 0) return v;
    v[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    return v;
  }, {});
}

async function main() {
  const env = parseEnv(await readFile('.env.admin', 'utf8'));
  const client = new Client({
    host: env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432, database: 'postgres', user: 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: [testUser] } = await client.query(`SELECT id FROM public.profiles LIMIT 1`);
  const { rows: [testWs] } = await client.query(`SELECT id FROM public.workspaces LIMIT 1`);
  const userId = testUser?.id;
  const wsId = testWs?.id;

  // Check function properties
  console.log('=== PRIVATE FUNCTION DETAILS ===');
  const { rows: funcDetails } = await client.query(`
    SELECT p.proname, p.prosecdef, p.proconfig,
           pg_get_functiondef(p.oid) AS funcdef
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'private' AND p.proname = 'is_workspace_active_member'
  `);
  for (const f of funcDetails) {
    console.log(`Name: ${f.proname}`);
    console.log(`SECURITY DEFINER: ${f.prosecdef}`);
    console.log(`Config: ${f.proconfig}`);
    console.log(`Definition:\n${f.funcdef}\n`);
  }

  // Check function owner
  console.log('=== FUNCTION OWNER ===');
  const { rows: ownerRows } = await client.query(`
    SELECT p.proname, r.rolname AS owner, r.rolsuper
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'private'
    ORDER BY p.proname
  `);
  console.table(ownerRows);

  // Test: call the function directly as authenticated
  console.log('\n=== DIRECT FUNCTION CALL AS AUTHENTICATED ===');
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}'`);
    const { rows } = await client.query(`SELECT private.is_workspace_active_member($1) AS result`, [wsId]);
    console.log('Result:', rows[0]?.result);
    await client.query('ROLLBACK');
  } catch (e) {
    console.error('Error:', e.message);
    await client.query('ROLLBACK');
  }

  // Test: query workspaces as authenticated
  console.log('\n=== WORKSPACES SELECT AS AUTHENTICATED ===');
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}'`);
    const { rows } = await client.query(`SELECT id, name FROM public.workspaces`);
    console.log('Workspaces found:', rows.length);
    console.table(rows);
    await client.query('ROLLBACK');
  } catch (e) {
    console.error('Error:', e.message);
    await client.query('ROLLBACK');
  }

  // Check current policies on workspace_members
  console.log('\n=== WORKSPACE_MEMBERS POLICIES ===');
  const { rows: wsPolicies } = await client.query(`
    SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
    FROM pg_policy
    WHERE polrelid = 'public.workspace_members'::regclass
    ORDER BY polname
  `);
  console.table(wsPolicies);

  // Check current policies on workspaces
  console.log('\n=== WORKSPACES POLICIES ===');
  const { rows: wPolicies } = await client.query(`
    SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
    FROM pg_policy
    WHERE polrelid = 'public.workspaces'::regclass
    ORDER BY polname
  `);
  console.table(wPolicies);

  await client.end();
}

main().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
