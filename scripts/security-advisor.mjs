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
  const isRemote = Boolean(env.SUPABASE_DB_PASSWORD && env.SUPABASE_DB_PASSWORD.trim());
  const client = new Client({
    host: isRemote ? (env.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co') : '127.0.0.1',
    port: isRemote ? 5432 : 54322,
    database: 'postgres',
    user: 'postgres',
    password: isRemote ? env.SUPABASE_DB_PASSWORD : 'postgres',
    ssl: isRemote ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUPABASE SECURITY ADVISOR — POST R1.1 ASSESSMENT');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Tables without RLS
  console.log('=== TABLES WITHOUT RLS ===');
  const { rows: noRls } = await client.query(`
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
    ORDER BY tablename
  `);
  if (noRls.length === 0) console.log('✓ All public tables have RLS enabled');
  else { console.log('✗ Tables WITHOUT RLS:'); console.table(noRls); }

  // 2. SECURITY DEFINER functions in public schema
  console.log('\n=== SECURITY DEFINER FUNCTIONS IN PUBLIC SCHEMA ===');
  const { rows: pubSecDef } = await client.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = true
    ORDER BY p.proname
  `);
  if (pubSecDef.length === 0) {
    console.log('✓ No SECURITY DEFINER functions in public schema (all moved to private)');
  } else {
    console.log(`⚠ ${pubSecDef.length} SECURITY DEFINER functions remain in public:`);
    console.table(pubSecDef);
  }

  // 3. Public schema functions with anon or PUBLIC EXECUTE
  console.log('\n=== PUBLIC FUNCTIONS CALLABLE BY ANON/PUBLIC ===');
  const { rows: anonCallable } = await client.query(`
    SELECT p.proname, p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND (p.proacl::text LIKE '%=X/%' OR p.proacl::text LIKE '%anon=X/%')
    ORDER BY p.proname
  `);
  if (anonCallable.length === 0) {
    console.log('✓ No public functions callable by anon or PUBLIC');
  } else {
    console.log(`⚠ ${anonCallable.length} public functions callable by anon/PUBLIC:`);
    console.table(anonCallable);
  }

  // 4. Private schema function ACLs
  console.log('\n=== PRIVATE SCHEMA FUNCTION SECURITY ===');
  const { rows: privFuncs } = await client.query(`
    SELECT p.proname, p.prosecdef AS sec_def,
           p.proconfig AS config,
           p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'private'
    ORDER BY p.proname
  `);
  for (const f of privFuncs) {
    const acl = f.acl || '';
    const hasPublic = acl.includes('=X/') && !acl.startsWith('{postgres=');
    const hasAnon = acl.includes('anon=X/');
    const status = (!hasPublic && !hasAnon) ? '✓' : '✗';
    console.log(`  ${status} ${f.proname}: SECURITY DEFINER=${f.sec_def}, config=${JSON.stringify(f.config)}`);
    console.log(`     ACL: ${acl}`);
  }

  // 5. Notification table security
  console.log('\n=== NOTIFICATION TABLE SECURITY ===');
  const { rows: notifGrants } = await client.query(`
    SELECT grantee, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND grantee IN ('anon', 'authenticated')
    ORDER BY grantee, privilege_type
  `);
  console.log('Table-level grants for anon/authenticated:');
  console.table(notifGrants);

  const { rows: notifColGrants } = await client.query(`
    SELECT grantee, column_name, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND grantee = 'authenticated'
      AND privilege_type = 'UPDATE'
    ORDER BY column_name
  `);
  console.log('Column-level UPDATE grants for authenticated:');
  console.table(notifColGrants);

  // 6. Default privileges
  console.log('\n=== DEFAULT FUNCTION PRIVILEGES (postgres role, public schema) ===');
  const { rows: defPrivs } = await client.query(`
    SELECT defaclobjtype AS obj_type, defaclacl::text AS acl
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE pg_catalog.pg_get_userbyid(defaclrole) = 'postgres'
      AND n.nspname = 'public'
      AND defaclobjtype = 'f'
  `);
  if (defPrivs.length > 0 && defPrivs[0].acl === '{postgres=X/postgres}') {
    console.log('✓ Only postgres has default EXECUTE — anon/authenticated/service_role/PUBLIC removed');
  } else {
    console.table(defPrivs);
  }

  // 7. Schema exposure
  console.log('\n=== SCHEMA EXPOSURE ===');
  try {
    const { rows } = await client.query(`SELECT current_setting('pgrst.db_schemas', true) AS schemas`);
    const schemas = rows[0]?.schemas ?? '(not set — defaults to public,storage)';
    console.log(`pgrst.db_schemas: ${schemas}`);
    if (!schemas.includes('private')) {
      console.log('✓ private schema NOT exposed via PostgREST Data API');
    } else {
      console.log('✗ private schema IS exposed via PostgREST — this is a vulnerability');
    }
  } catch { console.log('✓ pgrst.db_schemas not available — private schema not exposed'); }

  // 8. Schema access grants
  console.log('\n=== PRIVATE SCHEMA ACCESS ===');
  const { rows: schemaGrants } = await client.query(`
    SELECT grantee, privilege_type
    FROM information_schema.usage_privileges
    WHERE object_schema = 'pg_catalog'
      AND object_type = 'SCHEMA'
  `);
  // Check directly via has_schema_privilege
  for (const role of ['anon', 'authenticated', 'service_role', 'postgres']) {
    const { rows: [r] } = await client.query(`SELECT has_schema_privilege($1, 'private', 'USAGE') AS has_usage`, [role]);
    const status = r.has_usage ? '✓' : '✗';
    const expected = (role === 'anon') ? '✗ (expected)' : status;
    if (role === 'anon') {
      console.log(`  ${r.has_usage ? '✗ HAS USAGE (should not)' : '✓ NO USAGE'}: ${role}`);
    } else {
      console.log(`  ${status} USAGE: ${role}`);
    }
  }

  // 9. Policy count per table
  console.log('\n=== POLICY COUNT PER TABLE ===');
  const { rows: policyCounts } = await client.query(`
    SELECT c.relname AS table_name, count(p.polname)::int AS policy_count
    FROM pg_class c
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    GROUP BY c.relname
    ORDER BY c.relname
  `);
  console.table(policyCounts);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ASSESSMENT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');

  await client.end();
}

main().catch(err => {
  console.error('Advisor error:', err);
  process.exit(1);
});
