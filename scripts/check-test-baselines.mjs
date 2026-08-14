import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const scriptsDir = path.join(process.cwd(), 'scripts');

async function main() {
  const entries = await readdir(scriptsDir);
  for (const entry of entries) {
    if (entry.endsWith('.mjs') && !entry.startsWith('reseed') && !entry.startsWith('inspect')) {
      const fullPath = path.join(scriptsDir, entry);
      const content = await readFile(fullPath, 'utf8');
      if (content.includes('26') || content.includes('6 projects') || content.includes('6 baseline') || content.includes('projCount[0].c === 6')) {
        console.log(`Found references in: ${entry}`);
      }
    }
  }
}

main().catch(console.error);
