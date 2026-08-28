import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const indexPath = path.join(distDir, 'index.html');
const fallbackPath = path.join(distDir, '404.html');

if (!fs.existsSync(indexPath)) {
  console.error('Error: dist/index.html not found. Run "vite build" first.');
  process.exit(1);
}

fs.copyFileSync(indexPath, fallbackPath);
console.log('✓ Successfully created dist/404.html SPA fallback from dist/index.html');
