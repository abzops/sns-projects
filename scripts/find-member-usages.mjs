import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const srcDir = path.join(process.cwd(), 'src');

async function searchInDir(dir, query) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await searchInDir(fullPath, query));
    } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
      const content = await readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes(query)) {
          results.push({
            file: path.relative(srcDir, fullPath),
            line: idx + 1,
            content: line.trim(),
          });
        }
      });
    }
  }
  return results;
}

async function main() {
  console.log('=== USAGES OF useMembers ===');
  console.table(await searchInDir(srcDir, 'useMembers'));

  console.log('\n=== USAGES OF profiles or profile on members ===');
  console.table(await searchInDir(srcDir, '.profiles'));

  console.log('\n=== USAGES OF Avatar ===');
  console.table(await searchInDir(srcDir, '<Avatar'));
}

main().catch(console.error);
