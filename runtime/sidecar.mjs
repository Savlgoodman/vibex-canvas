import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function appRoot() {
  const bundled = path.resolve(fileURLToPath(new URL('./app/', import.meta.url)));
  if (existsSync(bundled)) return bundled;
  return path.resolve(fileURLToPath(new URL('../dist/app/', import.meta.url)));
}

async function devOrigin() {
  try {
    const file = fileURLToPath(new URL('../.vibex-plugin/app-dev.json', import.meta.url));
    const data = JSON.parse(await readFile(file, 'utf8'));
    return typeof data.origin === 'string' && data.origin.startsWith('http://127.0.0.1:')
      ? data.origin.replace(/\/$/, '')
      : undefined;
  } catch {
    return undefined;
  }
}

function safePath(root, requestUrl) {
  const raw = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  const relative = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`)
    ? resolved
    : null;
}

async function serve(root, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const filePath = safePath(root, request.url || '/');
  if (!filePath) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not_file');
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'cache-control': 'no-cache',
      'content-length': info.size,
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
}

export function createSidecar() {
  let server;
  let startPromise;
  let state = 'stopped';
  let origin;
  let lastError;

  const snapshot = () => ({ state, origin, lastError });

  async function start() {
    if (state === 'running' && server) return snapshot();
    if (startPromise) return startPromise;
    startPromise = new Promise((resolve, reject) => {
      state = 'starting';
      void devOrigin().then((originOverride) => {
        if (originOverride) {
          origin = originOverride;
          state = 'running';
          lastError = undefined;
          resolve(snapshot());
          return;
        }
      const next = createServer((request, response) => {
        void serve(appRoot(), request, response);
      });
      next.once('error', (error) => {
        state = 'failed';
        lastError = error instanceof Error ? error.message : String(error);
        reject(error);
      });
      next.listen(0, '127.0.0.1', () => {
        const address = next.address();
        if (!address || typeof address === 'string') {
          const error = new Error('sidecar_address_unavailable');
          state = 'failed';
          lastError = error.message;
          next.close();
          reject(error);
          return;
        }
        server = next;
        origin = `http://127.0.0.1:${address.port}`;
        state = 'running';
        lastError = undefined;
        resolve(snapshot());
      });
      });
    }).finally(() => {
      startPromise = undefined;
    });
    return startPromise;
  }

  async function stop() {
    const current = server;
    server = undefined;
    origin = undefined;
    state = 'stopped';
    if (current) await new Promise((resolve) => current.close(resolve));
  }

  return {
    status: () => snapshot(),
    start,
    async restart() {
      await stop();
      return start();
    },
    stop,
  };
}
