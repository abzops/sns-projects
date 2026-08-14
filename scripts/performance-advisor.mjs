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

async function inspectPerformanceAdvisor() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUPABASE PERFORMANCE ADVISOR INSPECTION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const envAdmin = parseEnv(await readFile(envAdminPath, 'utf8'));
  const client = new Client({
    host: envAdmin.SUPABASE_DB_HOST || 'db.gqerfixdmgbqahgslzsq.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: envAdmin.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('=== 1. UNINDEXED FOREIGN KEYS (PUBLIC SCHEMA) ===');
  // Query to find foreign keys lacking covering index on child table columns
  const { rows: unindexedFks } = await client.query(`
    SELECT
      c.conrelid::regclass AS child_table,
      c.conname AS fk_name,
      pg_get_constraintdef(c.oid) AS fk_def
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.contype = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
      );
  `);

  if (unindexedFks.length === 0) {
    console.log('✓ All foreign keys in public schema have covering indexes!');
  } else {
    console.log(`Found ${unindexedFks.length} unindexed foreign keys:`);
    console.table(unindexedFks);
  }

  console.log('\n=== 2. UNUSED INDEXES (INFORMATIONAL) ===');
  const { rows: unusedIndexes } = await client.query(`
    SELECT
      schemaname,
      relname AS table_name,
      indexrelname AS index_name,
      idx_scan,
      pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
      AND idx_scan = 0
      AND indexrelname NOT LIKE '%_pkey'
    ORDER BY relname, indexrelname;
  `);
  console.log(`Found ${unusedIndexes.length} unused indexes (normal for freshly created or low-traffic tables):`);
  console.table(unusedIndexes);

  await client.end();
}

inspectPerformanceAdvisor().catch(console.error);
