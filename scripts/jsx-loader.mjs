import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

export async function resolve(specifier, context, nextResolve) {
  try {
    const res = await nextResolve(specifier, context);
    if (res.url.endsWith('.jsx')) {
      return {
        ...res,
        format: 'module',
      };
    }
    return res;
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && context.parentURL) {
      for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
        try {
          const testPath = fileURLToPath(new URL(specifier + ext, context.parentURL));
          if (fs.existsSync(testPath)) {
            const res = await nextResolve(specifier + ext, context);
            return {
              ...res,
              format: 'module',
            };
          }
        } catch {}
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css') || url.includes('.css?')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (_, prop) => prop });',
    };
  }

  if (url.endsWith('.jsx')) {
    const filePath = fileURLToPath(url);
    let source = fs.readFileSync(filePath, 'utf8');

    // Specific transform for AuthContext if needed
    source = source.replace(
      /<AuthContext\.Provider value=\{value\}>\s*\{!loading && children\}\s*<\/AuthContext\.Provider>/g,
      'React.createElement(AuthContext.Provider, { value }, !loading && children)'
    );

    const transformed = await transformWithOxc(source, url, {
      jsx: { runtime: 'automatic' },
    });

    return {
      format: 'module',
      shortCircuit: true,
      source: transformed.code,
    };
  }

  return nextLoad(url, context);
}
