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
    try {
      do {
        queued = false;
        await link();
      } while (queued);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    } finally {
      linking = false;
    }
  }, 400);
};

const watcher = watch(root, { recursive: true }, (_event, filename) => {
  const name = String(filename ?? '').replaceAll('\\', '/');
  if (!name || name.startsWith('node_modules/') || name.startsWith('dist/') || name.startsWith('app/') || name.startsWith('.git/')) {
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
