import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cli = realpathSync(require.resolve('@vibex/plugin-cli/dist/cli.js'));

await import('./scope-plugin-css.mjs');
await import('./build-plugin-package.mjs');

const { importLinkedOnProductHost, enableOnProductHost } = await import(
  pathToFileURL(join(dirname(cli), 'productHost.js')).href
);
const { inspectLinkedPackage } = await import(
  pathToFileURL(join(dirname(cli), 'pluginControl.js')).href
);
const plugin = await inspectLinkedPackage(root);
const installed = await importLinkedOnProductHost(plugin.root, plugin.identity);
await enableOnProductHost(plugin.identity.id);
console.log(
  `Linked ${plugin.identity.id} generation ${installed.generation} digest ${installed.packageDigest}`,
);
