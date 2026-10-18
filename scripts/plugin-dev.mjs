import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const devFile = path.join(root, '.vibex-plugin', 'app-dev.json');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function run(command, args, options = {}) {
  return spawn(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
}

await new Promise((resolve, reject) => {
  const build = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
  build.once('error', reject);
  build.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`app_build_failed_${code}`)));
});

const port = await freePort();
await mkdir(path.dirname(devFile), { recursive: true });
await writeFile(devFile, `${JSON.stringify({ origin: `http://127.0.0.1:${port}` }, null, 2)}\n`);

const vite = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
]);
const plugin = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vibex-plugin', 'dev']);
let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  vite.kill('SIGTERM');
  plugin.kill('SIGTERM');
  await rm(devFile, { force: true });
  process.exitCode = code;
};
process.once('SIGINT', () => void stop(130));
process.once('SIGTERM', () => void stop(143));
vite.once('exit', (code) => { if (!stopping && code !== 0) void stop(code ?? 1); });
plugin.once('exit', (code) => { if (!stopping) void stop(code ?? 0); });
