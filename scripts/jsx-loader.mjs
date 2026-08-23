import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && context.parentURL) {
      for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
        try {
          const testPath = fileURLToPath(new URL(specifier + ext, context.parentURL));
          if (fs.existsSync(testPath)) {
            return nextResolve(specifier + ext, context);
          }
        } catch {}
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const result = await nextLoad(url, { ...context, format: 'module' });
    let source = result.source.toString();
    source = source.replace(
      /<AuthContext\.Provider value=\{value\}>\s*\{!loading && children\}\s*<\/AuthContext\.Provider>/g,
      'React.createElement(AuthContext.Provider, { value }, !loading && children)'
    );
    if (!source.includes("import React from 'react'") && !source.includes('import React,')) {
      source = "import React from 'react';\n" + source;
    }
    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }
  return nextLoad(url, context);
}
