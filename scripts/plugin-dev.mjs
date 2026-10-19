import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const devFile = path.join(root, '.vibex-plugin', 'app-dev.json');
const viteCache = path.join(root, 'node_modules', '.vite-app');

await rm(viteCache, { recursive: true, force: true });

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
  if (process.platform === 'win32') {
    const commandLine = [command, ...args].map((value) => {
      const text = String(value);
      return /[\s"]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
    }).join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd: root,
      stdio: 'inherit',
      windowsVerbatimArguments: true,
      ...options,
    });
  }
  return spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
}

await new Promise((resolve, reject) => {
  const build = run('npm', ['run', 'build']);
  build.once('error', reject);
  build.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`app_build_failed_${code}`)));
});

const port = await freePort();
await mkdir(path.dirname(devFile), { recursive: true });
await writeFile(devFile, `${JSON.stringify({ origin: `http://127.0.0.1:${port}` }, null, 2)}\n`);

const vite = run('npm', [
  'run', 'dev', '--', '--config', 'vite.app.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
]);
const plugin = run('npx', ['vibex-plugin', 'dev']);
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
