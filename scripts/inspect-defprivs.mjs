import { readFile } from 'node:fs/promises'
import path from 'node:path'
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
  try {
    console.log('=== DEFAULT PRIVILEGES ===');
    const { rows } = await client.query(`
      SELECT
        pg_catalog.pg_get_userbyid(defaclrole) AS owner,
        n.nspname AS schema_name,
        defaclobjtype AS obj_type,
        defaclacl::text AS acl
      FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      ORDER BY owner, schema_name
    `);
    console.table(rows);

    // Check PostgREST schema exposure via current_setting
    console.log('\n=== PGRST EXPOSED SCHEMAS ===');
    try {
      const { rows: pgrst } = await client.query(`SELECT current_setting('pgrst.db_schemas', true) AS schemas`);
      console.log('pgrst.db_schemas:', pgrst[0]?.schemas ?? '(not set)');
    } catch (e) {
      console.log('pgrst.db_schemas: not available');
    }
  } finally {
    await client.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
