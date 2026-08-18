import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed += 1;
  } else {
    console.error(`  [FAIL] ${message}${details ? ` - ${details}` : ''}`);
    failed += 1;
  }
}

async function collectSourceFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, files);
    } else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

async function main() {
  console.log('======================================================================');
  console.log('SNS Projects — PostgREST Relationship Embed Regression Verification');
  console.log('======================================================================\n');

  const sourceFiles = await collectSourceFiles(srcRoot);
  const invalidEmbeds = [];

  for (const file of sourceFiles) {
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\b[A-Za-z_][A-Za-z0-9_]*:phase_id\s*\(/.test(line)
        || /\btask_lists:task_list_id\s*\(/.test(line)) {
        invalidEmbeds.push(`${path.relative(repoRoot, file)}:${index + 1}`);
      }
    });
  }

  assert(
    invalidEmbeds.length === 0,
    'Active frontend contains no column-name relationship hints for composite Phase/Task List embeds',
    invalidEmbeds.join(', '),
  );

  const myWork = await readFile(path.join(srcRoot, 'pages', 'MyWorkPage.jsx'), 'utf8');
  const useTasks = await readFile(path.join(srcRoot, 'hooks', 'useTasks.js'), 'utf8');
  const useProcessInstance = await readFile(
    path.join(srcRoot, 'hooks', 'useProcessInstance.js'),
    'utf8',
  );

  assert(
    countMatches(myWork, /phases:phases!fk_tasks_phase\s*\(/g) === 3,
    'My Work uses fk_tasks_phase for RACI, direct-assignee, and Subtask-parent task payloads',
  );
  assert(
    countMatches(myWork, /task_lists:task_lists!fk_tasks_task_list\s*\(/g) === 3,
    'My Work disambiguates all three task-list embeds with fk_tasks_task_list',
  );
  assert(
    countMatches(useTasks, /phases:phases!fk_tasks_phase\s*\(/g) === 1,
    'Project task loading uses fk_tasks_phase',
  );
  assert(
    countMatches(useTasks, /task_lists:task_lists!fk_tasks_task_list\s*\(/g) === 1,
    'Project task loading disambiguates task lists with fk_tasks_task_list',
  );
  assert(
    countMatches(useProcessInstance, /phases:phases!fk_task_lists_phase\s*\(/g) === 1,
    'Defined Process task-list loading uses fk_task_lists_phase',
  );

  const migration = await readFile(
    path.join(
      repoRoot,
      'supabase',
      'migrations',
      '20260817115837_p2_01_controlled_milestone_phase_rename.sql',
    ),
    'utf8',
  );

  for (const constraint of ['fk_tasks_phase', 'fk_tasks_task_list', 'fk_task_lists_phase']) {
    assert(
      migration.includes(`ADD CONSTRAINT ${constraint}`),
      `Explicit relationship target ${constraint} exists in the canonical P2-01 migration`,
    );
  }

  console.log('\n======================================================================');
  console.log(`PostgREST Embed Verification: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Unhandled verification error:', error);
  process.exit(1);
});
