import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
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
  return path.resolve(fileURLToPath(new URL('./app/', import.meta.url)));
}

const DEV_FILE = fileURLToPath(new URL('../.vibex-plugin/app-dev.json', import.meta.url));

async function devOrigin() {
  try {
    if (!existsSync(DEV_FILE)) return undefined;
    const data = JSON.parse(await readFile(DEV_FILE, 'utf8'));
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

async function serveStatic(root, request, response) {
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

// --- API helpers ---

function jsonResponse(response, status, body) {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'access-control-allow-origin': '*',
  });
  response.end(json);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    request.on('error', reject);
  });
}

function checkAuth(request, token) {
  const header = request.headers['authorization'] || '';
  return header === `Bearer ${token}`;
}

function proxyRequest(target, request, response) {
  const url = new URL(request.url, target);
  const proxyReq = httpRequest(url, { method: request.method, headers: request.headers }, (proxyRes) => {
    response.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(response);
  });
  proxyReq.on('error', () => {
    response.writeHead(502);
    response.end('proxy error');
  });
  request.pipe(proxyReq);
}

// --- API router ---

function createApiRouter(deps) {
  const { imageService, storage, readConfig, runGeneration } = deps;
  /** @type {Map<string, { id: string, status: string, params: any, createdAt: number, result: any, error: string | null }>} */
  const asyncTasks = new Map();

  async function handleApi(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    // GET /api/providers
    if (request.method === 'GET' && pathname === '/api/providers') {
      const config = await readConfig();
      return jsonResponse(response, 200, imageService.listProviders(config));
    }

    // POST /api/generate
    if (request.method === 'POST' && pathname === '/api/generate') {
      let params;
      try { params = await parseBody(request); } catch { return jsonResponse(response, 400, { error: 'Invalid JSON' }); }
      if (!params.prompt) return jsonResponse(response, 400, { error: 'prompt is required' });

      const taskId = randomUUID();
      asyncTasks.set(taskId, {
        id: taskId,
        status: 'pending',
        params,
        createdAt: Date.now(),
        result: null,
        error: null,
      });
      void runGenerationTask(taskId);
      return jsonResponse(response, 202, { taskId });
    }

    // GET /api/generate/:taskId
    if (request.method === 'GET' && pathname.startsWith('/api/generate/')) {
      const taskId = pathname.slice('/api/generate/'.length);
      const task = asyncTasks.get(taskId);
      if (!task) return jsonResponse(response, 404, { error: 'Task not found' });
      const base = { taskId: task.id, status: task.status };
      if (task.status === 'success' && task.result) {
        return jsonResponse(response, 200, { ...base, imagePaths: task.result.imagePaths, provider: task.result.provider, model: task.result.model });
      }
      if (task.status === 'failed') {
        return jsonResponse(response, 200, { ...base, error: task.error || '生成失败' });
      }
      return jsonResponse(response, 200, base);
    }

    // GET /api/records
    if (request.method === 'GET' && pathname === '/api/records') {
      const limit = Number(url.searchParams.get('limit')) || 20;
      const data = storage.readData();
      return jsonResponse(response, 200, imageService.listRecords(data, limit));
    }

    return jsonResponse(response, 404, { error: 'Not found' });
  }

  async function runGenerationTask(taskId) {
    const entry = asyncTasks.get(taskId);
    if (!entry) return;
    try {
      entry.status = 'generating';
      const config = await readConfig();
      const params = entry.params;
      const result = await runGeneration(config, params);
      entry.status = 'success';
      entry.result = { imagePaths: result.imagePaths, provider: result.provider, model: result.model, recordId: result.recordId };
    } catch (err) {
      entry.status = 'failed';
      entry.error = err instanceof Error ? err.message : String(err);
    }
  }

  // Expose for worker bridge to also use the same task map
  Object.defineProperty(handleApi, 'asyncTasks', { get: () => asyncTasks });
  Object.defineProperty(handleApi, 'runGenerationTask', { get: () => runGenerationTask });

  return handleApi;
}

// --- Sidecar factory ---

export function createSidecar({ imageService, storage, readConfig, runGeneration }) {
  let server;
  let startPromise;
  let state = 'stopped';
  let origin;
  let token;
  let lastError;
  let apiRouter;

  const snapshot = () => ({ state, origin, lastError });

  async function start() {
    if (state === 'running' && server) return snapshot();
    if (startPromise) return startPromise;
    startPromise = new Promise((resolve, reject) => {
      state = 'starting';
      token = randomUUID();
      apiRouter = createApiRouter({ imageService, storage, readConfig, runGeneration });

      const next = createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
          if (!checkAuth(request, token)) {
            return jsonResponse(response, 401, { error: 'Unauthorized' });
          }
          void apiRouter(request, response).catch((err) => {
            jsonResponse(response, 500, { error: err instanceof Error ? err.message : String(err) });
          });
          return;
        }
        void devOrigin().then((devUrl) => {
          if (devUrl) {
            proxyRequest(devUrl, request, response);
          } else {
            void serveStatic(appRoot(), request, response);
          }
        });
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
        writeRuntimeFile();
        resolve(snapshot());
      });
    }).finally(() => {
      startPromise = undefined;
    });
    return startPromise;
  }

  function writeRuntimeFile() {
    try {
      storage.ensureDirs();
      const filePath = path.join(storage.dataDir, 'runtime.json');
      writeFileSync(filePath, JSON.stringify({ origin, token, state }, null, 2));
    } catch {
      // non-critical
    }
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
    get token() { return token; },
    get apiRouter() { return apiRouter; },
    start,
    async restart() {
      await stop();
      return start();
    },
    stop,
  };
}
