import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
  console.log('SNS Projects — Documentation Link Integrity & Inventory Checker');
  console.log('================================================================\n');

  const files = await getFilesRecursively(docsRoot);
  console.log(`Found ${files.length} Markdown documentation files in Documentation/.\n`);

  let totalLinks = 0;
  let brokenLinks = 0;

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const relFile = path.relative(docsRoot, file);
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const linkText = match[1];
      const linkTarget = match[2];

      // Skip external links, anchor-only links, or mailto
      if (linkTarget.startsWith('http://') || linkTarget.startsWith('https://') || linkTarget.startsWith('#') || linkTarget.startsWith('mailto:')) {
        continue;
      }

      totalLinks++;

      let targetPath;
      if (linkTarget.startsWith('file:///')) {
        try {
          targetPath = fileURLToPath(linkTarget);
        } catch {
          targetPath = linkTarget.replace('file:///', '');
        }
      } else {
        const cleanTarget = linkTarget.split('#')[0].split('?')[0];
        if (!cleanTarget) continue;
        targetPath = path.resolve(path.dirname(file), cleanTarget);
      }

      try {
        await stat(targetPath);
      } catch {
        console.error(`[BROKEN LINK] in ${relFile}: [${linkText}](${linkTarget}) -> Target not found: ${targetPath}`);
        brokenLinks++;
      }
    }
  }

  console.log(`\nLink Integrity Results: ${totalLinks} links checked, ${brokenLinks} broken links found.`);
  if (brokenLinks > 0) {
    process.exit(1);
  } else {
    console.log('✅ 100% of internal documentation links resolved successfully!');
  }
}

verifyDocLinks().catch(console.error);
