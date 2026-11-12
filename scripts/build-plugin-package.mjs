import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cli = realpathSync(require.resolve('@vibex/plugin-cli/dist/cli.js'));

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, 'build', root], { cwd: root, stdio: 'inherit' });
  child.once('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`vibex-plugin build exited ${code}`));
  });
  child.once('error', reject);
});
await import('./build-plugin-app.mjs');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, 'validate', root], { cwd: root, stdio: 'inherit' });
  child.once('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`vibex-plugin validate exited ${code}`));
  });
  child.once('error', reject);
});
