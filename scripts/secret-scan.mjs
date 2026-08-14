import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', '.tempmediaStorage']);
const SENSITIVE_PATTERNS = [
  /postgres:\/\/[^:]+:[^@]+@/i,
  /service_role/i,
  /sb_secret/i,
  /"f,u2\?@e&F\+!FzL_K"/,
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{50,}/,
];

async function scanDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const issues = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(repoRoot, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        issues.push(...await scanDir(fullPath));
      }
      continue;
    }

    // Skip .env and .env.admin which are gitignored
    if (entry.name === '.env' || entry.name === '.env.admin' || entry.name.endsWith('.pdf')) {
      continue;
    }

    const content = await readFile(fullPath, 'utf8');
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(content)) {
        // Exclude test references that check for absence or schema definitions
        if (relPath.includes('security') && content.includes('service_role=X/postgres')) {
          continue;
        }
        issues.push({ file: relPath, pattern: pattern.toString() });
      }
    }
  }

  return issues;
}

async function main() {
  console.log('Scanning repository for accidental hardcoded secrets...');
  const issues = await scanDir(repoRoot);
  if (issues.length === 0) {
    console.log('✅ Secret Scan Clean: No credentials, service_role keys, or db passwords found in repository files.');
  } else {
    console.warn('⚠️ Potential secrets found:', issues);
  }
}

main().catch(console.error);
