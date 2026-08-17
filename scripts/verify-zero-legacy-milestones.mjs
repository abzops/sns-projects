import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message} ${details ? '- ' + details : ''}`);
    failed++;
  }
}

async function getAllFiles(dir, fileList = []) {
  const files = await readdir(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        await getAllFiles(fullPath, fileList);
      }
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

async function runZeroLegacyMilestoneVerification() {
  console.log('======================================================================');
  console.log('SNS Projects — Package 2 / P2-01: Zero-Legacy Milestone Verifier');
  console.log('======================================================================\n');

  // 1. Audit src/ directory (Active Frontend Application Code)
  console.log('--- 1. Active Frontend Source Code Audit (src/) ---');
  const srcFiles = await getAllFiles(path.join(repoRoot, 'src'));
  const srcViolations = [];

  for (const file of srcFiles) {
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/milestone/i.test(line)) {
        srcViolations.push({
          file: path.relative(repoRoot, file),
          line: idx + 1,
          content: line.trim(),
        });
      }
    });
  }

  if (srcViolations.length > 0) {
    console.error('Found active milestone references in src/:');
    srcViolations.forEach(v => console.error(`  - ${v.file}:${v.line} -> ${v.content}`));
  }
  assert(srcViolations.length === 0, `Active frontend code contains 0 milestone references (found ${srcViolations.length})`);

  // 2. Audit Active Canonical Database Schema (supabase/schema.sql)
  console.log('\n--- 2. Canonical Database Schema Audit (supabase/schema.sql) ---');
  const schemaPath = path.join(repoRoot, 'supabase', 'schema.sql');
  const schemaContent = await readFile(schemaPath, 'utf8');
  const schemaLines = schemaContent.split(/\r?\n/);
  const schemaViolations = [];

  schemaLines.forEach((line, idx) => {
    if (/milestone/i.test(line)) {
      schemaViolations.push({
        line: idx + 1,
        content: line.trim(),
      });
    }
  });

  if (schemaViolations.length > 0) {
    console.error('Found active milestone references in supabase/schema.sql:');
    schemaViolations.forEach(v => console.error(`  - Line ${v.line}: ${v.content}`));
  }
  assert(schemaViolations.length === 0, `Canonical schema.sql contains 0 milestone references (found ${schemaViolations.length})`);

  // 3. Verify Specific Phase Replacements in src/
  console.log('\n--- 3. Required Phase Files & Hooks Existence ---');
  const usePhasesExists = await stat(path.join(repoRoot, 'src', 'hooks', 'usePhases.js')).then(() => true).catch(() => false);
  let useMilestonesExists = true;
  try {
    await stat(path.join(repoRoot, 'src', 'hooks', 'useMilestones.js'));
  } catch (e) {
    useMilestonesExists = false;
  }

  assert(usePhasesExists, 'src/hooks/usePhases.js is present');
  assert(!useMilestonesExists, 'src/hooks/useMilestones.js is deleted');

  // 4. Verify P2-01 Migration Integrity
  console.log('\n--- 4. Migration Architecture Classification ---');
  const p201MigPath = path.join(repoRoot, 'supabase', 'migrations', '20260817115837_p2_01_controlled_milestone_phase_rename.sql');
  const p201Content = await readFile(p201MigPath, 'utf8');

  assert(p201Content.includes('ALTER TABLE public.milestones RENAME TO phases;'),
    'P2-01 migration contains ALTER TABLE public.milestones RENAME TO phases');
  assert(p201Content.includes('DROP CONSTRAINT IF EXISTS fk_tasks_milestone;'),
    'P2-01 migration explicitly drops fk_tasks_milestone');
  assert(p201Content.includes('ALTER TABLE public.tasks DROP COLUMN IF EXISTS milestone_id;'),
    'P2-01 migration explicitly drops tasks.milestone_id');
  assert(p201Content.includes('ALTER TABLE public.task_lists DROP COLUMN IF EXISTS milestone_id;'),
    'P2-01 migration explicitly drops task_lists.milestone_id');

  console.log('\n======================================================================');
  console.log(`Zero-Legacy Milestone Verification: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runZeroLegacyMilestoneVerification().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
