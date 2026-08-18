import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const sourceExtensions = new Set(['.js', '.jsx']);

async function collectSourceFiles(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, result);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      result.push(fullPath);
    }
  }
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectReferences(source, alias) {
  const escapedAlias = escapeRegExp(alias);
  const patterns = [
    new RegExp(`\\b${escapedAlias}\\.([A-Za-z_$][\\w$]*)`, 'g'),
    new RegExp(`\\b${escapedAlias}\\[\\s*(['"])([A-Za-z_$][\\w$-]*)\\1\\s*\\]`, 'g'),
    new RegExp(`\\b${escapedAlias}\\[\\s*\\\`([^\\\`$]+)\\\`\\s*\\]`, 'g'),
  ];
  const references = [];

  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of source.matchAll(pattern)) {
      references.push({
        className: patternIndex === 1 ? match[2] : match[1],
        line: lineNumberAt(source, match.index),
      });
    }
  }

  return references;
}

function collectSelectors(cssSource) {
  const selectors = new Set();
  for (const match of cssSource.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    selectors.add(match[1]);
  }
  return selectors;
}

const sourceFiles = await collectSourceFiles(sourceRoot);
const violations = [];
let moduleImportCount = 0;
let referenceCount = 0;

for (const sourcePath of sourceFiles) {
  const source = await readFile(sourcePath, 'utf8');
  const importPattern = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.module\.css)['"];?/g;

  for (const importMatch of source.matchAll(importPattern)) {
    moduleImportCount += 1;
    const [, alias, cssImport] = importMatch;
    const cssPath = path.resolve(path.dirname(sourcePath), cssImport);
    const cssSource = await readFile(cssPath, 'utf8');
    const selectors = collectSelectors(cssSource);
    const references = collectReferences(source, alias);
    referenceCount += references.length;

    for (const reference of references) {
      if (!selectors.has(reference.className)) {
        violations.push({
          sourcePath: path.relative(root, sourcePath),
          cssPath: path.relative(root, cssPath),
          ...reference,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('CSS Module contract verification: FAIL');
  for (const violation of violations) {
    console.error(
      `  ${violation.sourcePath}:${violation.line} references styles.${violation.className}, ` +
        `missing from ${violation.cssPath}`
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `CSS Module contract verification: PASS ` +
      `(${moduleImportCount} module imports, ${referenceCount} static references)`
  );
}
