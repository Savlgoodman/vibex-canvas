#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const RUNTIME_FILE = path.join(os.homedir(), '.vibex', 'vibex-canvas', 'runtime.json');

async function loadRuntime() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
  } catch {
    console.error('Cannot read sidecar runtime. Is the plugin enabled in VibeX?');
    process.exit(1);
  }
}

async function api(method, urlPath, body) {
  const rt = await loadRuntime();
  const res = await fetch(`${rt.origin}${urlPath}`, {
    method,
    headers: {
      'authorization': `Bearer ${rt.token}`,
      ...(body != null ? { 'content-type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`API error ${res.status}: ${text}`);
    process.exit(1);
  }
  return res.json();
}

async function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'list-providers': {
      const result = await api('GET', '/api/providers');
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'generate': {
      const prompt = args[0];
      if (!prompt) {
        console.error('Usage: generate-image generate "<prompt>" [--provider <id>] [--model <name>] [--size <WxH>]');
        process.exit(1);
      }
      const params = { prompt };
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const val = args[i + 1];
        params[key] = key === 'imageCount' ? Number(val) : val;
      }

      const { taskId } = await api('POST', '/api/generate', params);
      if (!taskId) { console.error('No taskId returned'); process.exit(1); }

      // Poll
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await api('GET', `/api/generate/${taskId}`);
        if (status.status === 'success') {
          console.log(JSON.stringify({
            imagePaths: status.imagePaths,
            provider: status.provider,
            model: status.model,
          }, null, 2));
          return;
        }
        if (status.status === 'failed') {
          console.error(`Failed: ${status.error}`);
          process.exit(1);
        }
        process.stderr.write('.');
      }
      console.error('\nTimeout');
      process.exit(1);
      break;
    }

    case 'list-records': {
      const limit = Number(args[0]) || 20;
      const result = await api('GET', `/api/records?limit=${limit}`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log('Commands: list-providers | generate | list-records');
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
