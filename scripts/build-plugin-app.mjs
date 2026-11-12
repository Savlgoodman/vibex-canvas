import { createRequire } from 'node:module';
import { realpathSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(realpathSync(join(root, 'node_modules', '@vibex', 'plugin-cli', 'package.json')));
const { build } = require('esbuild');
const outfile = join(root, 'app', 'main.js');
const cssPath = join(root, 'app', 'styles.css');
const css = readFileSync(cssPath, 'utf8');

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [join(root, 'runtime', 'app.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  alias: {
    'react-dom/client': join(root, 'runtime', 'reactDomShim.js'),
    'react-dom': join(root, 'runtime', 'reactDomShim.js'),
  },
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    '@vibex/plugin-sdk',
    '@vibex/plugin-sdk/app',
    '@vibex/plugin-sdk/worker',
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
    __VIBEX_CANVAS_CSS__: JSON.stringify(css),
  },
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
console.log(`built host app ${outfile}`);
