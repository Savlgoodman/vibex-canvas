import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const linkScript = join(root, 'scripts', 'link-host.mjs');

function link() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [linkScript], { cwd: root, stdio: 'inherit' });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`link-host exited ${code}`));
    });
    child.once('error', reject);
  });
}

await link();
console.log('Watching plugin sources. Press Ctrl+C to stop.');

const ignoredPrefixes = ['node_modules/', 'dist/', 'app/', '.git/', '.vite-app/'];
const ignoredFiles = new Set([
  'runtime/app.css',
  '.vibex-plugin/package.lock.json',
  '.vibex-plugin/dev-remote.json',
  '.vibex-plugin/developer-link.json',
]);

function isSourceChange(filename) {
  const name = String(filename ?? '').replaceAll('\\', '/');
  if (!name || ignoredFiles.has(name)) return false;
  return !ignoredPrefixes.some((prefix) => name.startsWith(prefix));
}

let timer;
let linking = false;
let queued = false;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (linking) {
      queued = true;
      return;
    }
    linking = true;
    queued = false;
    try {
      await link();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    } finally {
      linking = false;
      if (queued) schedule();
    }
  }, 400);
};

const watcher = watch(root, { recursive: true }, (_event, filename) => {
  if (!isSourceChange(filename)) return;
  if (linking) {
    queued = true;
    return;
  }
  schedule();
});

const stop = () => {
  clearTimeout(timer);
  watcher.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
