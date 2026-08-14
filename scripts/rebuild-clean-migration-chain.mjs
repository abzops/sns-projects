import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const archiveDir = path.join(repoRoot, 'supabase', 'archived-legacy-migrations');

const legacyMigrationOrder = [
  { legacyFile: '20260814_01_day0_foundation.sql', name: 'day0_foundation' },
  { legacyFile: '20260814_02_security_hardening.sql', name: 'security_hardening' },
  { legacyFile: '20260814_03_hierarchy_alignment.sql', name: 'hierarchy_alignment' },
  { legacyFile: '20260814_04_day0_notifications_go_live.sql', name: 'day0_notifications_go_live' },
  { legacyFile: '20260814_05_reorder_kanban_tasks.sql', name: 'reorder_kanban_tasks' },
  { legacyFile: '20260814173224_enforce_deterministic_kanban_ordering.sql', name: 'enforce_deterministic_kanban_ordering' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildChain() {
  console.log('=== REBUILDING CANONICAL MIGRATION CHAIN ===\n');

  // 1. Create archive directory
  await mkdir(archiveDir, { recursive: true });

  // 2. Read legacy files contents & copy to archive
  const legacyContents = {};
  for (const item of legacyMigrationOrder) {
    const srcPath = path.join(migrationsDir, item.legacyFile);
    const destPath = path.join(archiveDir, item.legacyFile);
    const content = await readFile(srcPath, 'utf8');
    legacyContents[item.legacyFile] = content;
    await copyFile(srcPath, destPath);
    console.log(`Archived: ${item.legacyFile} -> supabase/archived-legacy-migrations/`);
  }

  // 3. Remove all files from supabase/migrations
  const currentFilesInMigrations = await readdir(migrationsDir);
  for (const file of currentFilesInMigrations) {
    const filePath = path.join(migrationsDir, file);
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
    console.log(`Cleared from migrations directory: ${file}`);
  }

  // 4. Generate new migration files sequentially with supabase migration new
  const generatedChain = [];

  for (let i = 0; i < legacyMigrationOrder.length; i++) {
    const item = legacyMigrationOrder[i];
    console.log(`\nGenerating new migration for: ${item.name}...`);
    
    // Run CLI to create new migration
    execSync(`npx supabase migration new ${item.name}`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    // Find the newly generated file
    const currentFiles = await readdir(migrationsDir);
    const newFile = currentFiles
      .filter((f) => f.endsWith(`_${item.name}.sql`))
      .sort()
      .pop();

    if (!newFile) {
      throw new Error(`Failed to locate newly created migration for ${item.name}`);
    }

    const newFilePath = path.join(migrationsDir, newFile);
    const legacySql = legacyContents[item.legacyFile];

    // Write exact legacy SQL into the new file
    await writeFile(newFilePath, legacySql, 'utf8');

    const version = newFile.split('_')[0];
    generatedChain.push({
      index: i + 1,
      name: item.name,
      legacyFile: item.legacyFile,
      newFile,
      version,
      bytes: legacySql.length,
    });

    console.log(`✓ Created: ${newFile} (Version: ${version}, Size: ${legacySql.length} bytes)`);

    // Ensure at least 1.2s delay so next timestamp is strictly distinct and sequential
    await sleep(1500);
  }

  console.log('\n=== CANONICAL MIGRATION CHAIN CREATED ===');
  console.table(generatedChain);
}

rebuildChain().catch((err) => {
  console.error(err);
  process.exit(1);
});
