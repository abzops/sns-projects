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

async function seedDemoProcess() {
  console.log('=== SEEDING INTERNAL MVP DEMO PROCESS ===\n');

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
  const wsId = 'dbcaddf1-cf02-4bad-8af1-974301cdfbea';

  try {
    // 1. Check if INTERNAL-MVP-DEMO already exists
    const { rows: existingProc } = await client.query(`
      SELECT id, name, code FROM public.defined_processes
      WHERE workspace_id = $1 AND code = 'INTERNAL-MVP-DEMO';
    `, [wsId]);

    if (existingProc.length > 0) {
      console.log(`Demo process already exists: ${existingProc[0].name} (${existingProc[0].id})`);
      return;
    }

    // 2. Check single active workspace user
    const { rows: members } = await client.query(`
      SELECT user_id FROM public.workspace_members
      WHERE workspace_id = $1 AND status = 'active' AND user_id IS NOT NULL;
    `, [wsId]);

    if (members.length !== 1) {
      console.log(`Expected exactly 1 active workspace user, found ${members.length}.`);
    }

    const userId = members[0].user_id;

    // 3. Resolve department (Operations or Engineering)
    const { rows: [dept] } = await client.query(`
      SELECT id, code, name FROM public.departments
      WHERE workspace_id = $1 AND code IN ('OPS', 'ENG', 'PROC', 'SWIT')
      LIMIT 1;
    `, [wsId]);

    console.log(`Using Department: ${dept.name} (${dept.code})`);
    console.log(`Using Process Owner / RACI User: ${userId}`);

    await client.query('BEGIN');

    // Create Defined Process
    const { rows: [proc] } = await client.query(`
      INSERT INTO public.defined_processes (
        workspace_id, department_id, name, code, description, process_owner_id, is_active, created_by
      ) VALUES (
        $1, $2, 'SNS Defined Process MVP Demo', 'INTERNAL-MVP-DEMO', 'Internal validation process for Defined Process Engine MVP runtime execution.', $3, true, $3
      ) RETURNING id;
    `, [wsId, dept.id, userId]);

    console.log(`Created defined_process: ${proc.id}`);

    // Create Version 1 (Draft)
    const { rows: [ver] } = await client.query(`
      INSERT INTO public.defined_process_versions (
        defined_process_id, version_number, status, change_summary, created_by
      ) VALUES (
        $1, 1, 'draft', 'Initial internal demo workflow definition', $2
      ) RETURNING id;
    `, [proc.id, userId]);

    console.log(`Created defined_process_version: ${ver.id}`);

    // Create Steps
    const { rows: [step1] } = await client.query(`
      INSERT INTO public.defined_process_steps (
        version_id, step_code, title, description, sequence_order, expected_duration_days, approval_required, consultation_required
      ) VALUES (
        $1, 'DEMO-001', 'Create Request', 'Initialize and document the internal demo process request.', 1, 1, false, false
      ) RETURNING id;
    `, [ver.id]);

    const { rows: [step2] } = await client.query(`
      INSERT INTO public.defined_process_steps (
        version_id, step_code, title, description, sequence_order, expected_duration_days, approval_required, consultation_required
      ) VALUES (
        $1, 'DEMO-002', 'Process Request', 'Execute the operational review and processing tasks.', 2, 1, false, false
      ) RETURNING id;
    `, [ver.id]);

    const { rows: [step3] } = await client.query(`
      INSERT INTO public.defined_process_steps (
        version_id, step_code, title, description, sequence_order, expected_duration_days, approval_required, consultation_required
      ) VALUES (
        $1, 'DEMO-003', 'Close Request', 'Verify deliverables, complete audit trail, and close the request.', 3, 1, false, false
      ) RETURNING id;
    `, [ver.id]);

    // Dependencies: 001 -> 002 -> 003
    await client.query(`
      INSERT INTO public.defined_process_step_dependencies (version_id, step_id, depends_on_step_id)
      VALUES
        ($1, $2, $3),
        ($1, $4, $2);
    `, [ver.id, step2.id, step1.id, step3.id]);

    // Step RACI: User is R and A on all steps (valid since approval_required = false)
    await client.query(`
      INSERT INTO public.defined_process_step_raci (step_id, raci_role, user_id)
      VALUES
        ($1, 'R', $4),
        ($1, 'A', $4),
        ($2, 'R', $4),
        ($2, 'A', $4),
        ($3, 'R', $4),
        ($3, 'A', $4);
    `, [step1.id, step2.id, step3.id, userId]);

    // Step Evidence definitions (optional for demo)
    await client.query(`
      INSERT INTO public.defined_process_step_evidence_defs (step_id, title, description, evidence_type, is_mandatory)
      VALUES
        ($1, 'Request Link or Notes', 'Reference link or summary note', 'text', false),
        ($2, 'Processing Notes', 'Summary of review actions', 'text', false);
    `, [step1.id, step2.id]);

    // Publish Version using RPC as user
    await client.query('SET LOCAL ROLE authenticated;');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub": "${userId}"}';`);

    const { rows: [pubRes] } = await client.query(`
      SELECT public.publish_defined_process_version($1) as res;
    `, [ver.id]);

    console.log(`Published version response:`, pubRes.res);

    await client.query('RESET ROLE;');
    await client.query('COMMIT');

    console.log('✓ Internal demo process successfully created and published!\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding demo process:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedDemoProcess();
