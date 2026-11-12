import http from 'node:http';
import https from 'node:https';

const nativeFetch = globalThis.fetch.bind(globalThis);

function proxyFromEnv() {
  const raw =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (!raw) return null;
  try {
    const proxy = new URL(raw);
    if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') return null;
    return proxy;
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function headerObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function flattenHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

function describeFetchError(error, url) {
  const cause = error?.cause;
  const detail = cause?.code || cause?.message || error?.message || '网络错误';
  return `请求供应商失败：${detail}（${url.origin}）`;
}

function requestBuffer(options, body) {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: flattenHeaders(res.headers),
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

function connectTunnel(proxy, targetHost) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: targetHost,
      headers: { host: targetHost },
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理连接失败 ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchViaProxy(proxy, url, method, headers, body) {
  if (url.protocol === 'https:') {
    const socket = await connectTunnel(proxy, `${url.hostname}:${url.port || 443}`);
    const result = await requestBuffer(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        socket,
        agent: false,
      },
      body,
    );
    return new Response(result.body, { status: result.status, headers: result.headers });
  }

  const result = await requestBuffer(
    {
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method,
      path: url.href,
      headers: { ...headers, host: url.host },
    },
    body,
  );
  return new Response(result.body, { status: result.status, headers: result.headers });
}

export function installProxyFetch() {
  if (globalThis.__vibexCanvasProxyFetch) return;
  globalThis.__vibexCanvasProxyFetch = true;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const proxy = proxyFromEnv();
    if (!proxy || isLocalHost(url.hostname) || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      try {
        return await nativeFetch(request);
      } catch (error) {
        throw new Error(describeFetchError(error, url), { cause: error });
      }
    }
    const method = request.method || 'GET';
    const body =
      method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(await request.arrayBuffer());
    try {
      return await fetchViaProxy(proxy, url, method, headerObject(request.headers), body);
    } catch (error) {
      throw new Error(describeFetchError(error, url), { cause: error });
    }
  };
}
