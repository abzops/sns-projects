import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

async function initLocalPostgres() {
  const client = new Client({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });

  await client.connect();
  console.log('Connected to local PostgreSQL container on 54322');

  console.log('Reading master schema.sql...');
  const schemaSql = await readFile(path.join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');

  console.log('Applying master schema.sql...');
  await client.query(schemaSql);
  console.log('Master schema.sql applied successfully!');

  await client.end();
}

initLocalPostgres().catch(console.error);
