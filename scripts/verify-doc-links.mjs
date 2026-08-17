import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, 'Documentation');

async function getFilesRecursively(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getFilesRecursively(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function verifyDocLinks() {
  console.log('================================================================');
  console.log('SNS Projects — Documentation Link Integrity & Portability Audit');
  console.log('================================================================\n');

  const files = await getFilesRecursively(docsRoot);
  console.log(`Auditing ${files.length} Markdown documentation files in Documentation/...\n`);

  let totalLinks = 0;
  let brokenLinks = 0;
  let localUriErrors = 0;

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const relFile = path.relative(docsRoot, file);

    // Check for hardcoded active local user paths (not generic explanatory text)
    const activeLocalPathRegex = /(file:\/\/\/[A-Za-z]:\/Users\/[A-Za-z0-9_.-]+|[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\)/gi;
    const localMatches = content.match(activeLocalPathRegex);
    if (localMatches) {
      for (const m of localMatches) {
        console.error(`[NON-PORTABLE PATH] in ${relFile}: Contains active local user path '${m}'`);
        localUriErrors++;
      }
    }

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const linkText = match[1];
      const linkTarget = match[2];

      // Explicitly reject file:/// links in href targets
      if (linkTarget.startsWith('file:///')) {
        console.error(`[FORBIDDEN LOCAL URI] in ${relFile}: [${linkText}](${linkTarget}) -> Local machine file:/// URIs are forbidden.`);
        brokenLinks++;
        continue;
      }

      // Skip external URLs, anchor-only links, or mailto
      if (linkTarget.startsWith('http://') || linkTarget.startsWith('https://') || linkTarget.startsWith('#') || linkTarget.startsWith('mailto:')) {
        continue;
      }

      totalLinks++;

      const cleanTarget = linkTarget.split('#')[0].split('?')[0];
      if (!cleanTarget) continue;

      const targetPath = path.resolve(path.dirname(file), cleanTarget);

      try {
        await stat(targetPath);
      } catch {
        console.error(`[BROKEN LINK] in ${relFile}: [${linkText}](${linkTarget}) -> Target not found: ${targetPath}`);
        brokenLinks++;
      }
    }
  }

  console.log(`\nAudit Results: ${totalLinks} relative links checked, ${brokenLinks} link errors, ${localUriErrors} non-portable path mentions.`);
  if (brokenLinks > 0 || localUriErrors > 0) {
    console.error('❌ Documentation audit failed: Non-portable file URIs or broken relative links detected.');
    process.exit(1);
  } else {
    console.log('✅ 100% of documentation links are portable, relative, and resolved successfully!');
  }
}

verifyDocLinks().catch(console.error);
