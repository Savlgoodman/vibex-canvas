import { definePluginWorker } from '@vibex/plugin-sdk/worker';
import { storage } from './storage.mjs';
import { createImageService } from './imageService.mjs';
import { createSidecar } from './sidecar.mjs';

export default definePluginWorker((registrar, environment) => {
  const imageService = createImageService(storage.dataDir);

  async function readConfig() {
    const local = storage.readConfig();
    if (local && typeof local === 'object' && !Array.isArray(local)) {
      return normalizeConfig(local);
    }
    const host = await environment.host.call('storage', 'settings.get', {});
    const config = normalizeConfig(host);
    storage.writeConfig(config);
    return config;
  }

  // Shared generation logic used by both worker handlers and sidecar API
  async function runGeneration(config, params) {
    const result = await imageService.generate(config, params);
    const recordId = crypto.randomUUID();
    const outputDir = params.outputDir;
    const targetDir = outputDir || storage.imagesDir;
    const imagePaths = [];

    for (let i = 0; i < result.imageUrls.length; i++) {
      const filePath = storage.saveImageToDisk(
        result.imageUrls[i],
        targetDir,
        outputDir ? `gen-${Date.now()}` : recordId,
        i,
      );
      imagePaths.push(filePath);
    }

    const record = {
      id: recordId,
      prompt: params.prompt,
      providerId: params.providerId || config.defaultProviderId,
      model: result.model,
      size: params.size || '1024x1024',
      quality: params.quality || 'auto',
      outputFormat: params.outputFormat || 'png',
      background: params.background || 'auto',
      status: 'success',
      imagePaths,
      source: params.source || 'agent',
      outputDir: params.outputDir || null,
      createdAt: Date.now(),
    };

    const data = storage.readData();
    if (record.source !== 'manual') {
      const dirKey = params.outputDir || '__default__';
      const agentRecords = storage.readAgentRecords();
      if (!agentRecords[dirKey]) agentRecords[dirKey] = [];
      agentRecords[dirKey].push(record);
      storage.writeAgentRecords(agentRecords);
    } else {
      let task = data.tasks.find((t) => t.id === data.activeTaskId);
      if (!task) {
        task = {
          id: crypto.randomUUID(),
          title: '默认任务',
          providerId: record.providerId,
          model: record.model,
          size: record.size,
          quality: record.quality,
          records: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        data.tasks.push(task);
        data.activeTaskId = task.id;
      }
      task.records.push({ ...record, taskId: task.id });
      task.updatedAt = Date.now();
      storage.writeData(data);
    }

    return { imagePaths, recordId, provider: result.provider, model: result.model };
  }

  const sidecar = createSidecar({ imageService, storage, readConfig, runGeneration });

  // --- Config handlers (for Tab UI) ---

  registrar.handle('config.get', async () => {
    return readConfig();
  });

  registrar.handle('config.save', async (config) => {
    storage.writeConfig(normalizeConfig(config));
    return { ok: true };
  });

  registrar.handle('runtime.status', async () => {
    try {
      return await sidecar.start();
    } catch {
      return sidecar.status();
    }
  });

  registrar.handle('runtime.restart', async () => sidecar.restart());

  registrar.handle('runtime.health', async () => {
    const status = sidecar.status();
    return { ok: status.state === 'running', ...status };
  });

  // --- Task handlers (for Tab UI) ---

  registrar.handle('task.list', async () => {
    return storage.readData();
  });

  registrar.handle('task.save', async (data) => {
    storage.writeData(data);
    return { ok: true };
  });

  // --- Image generation handlers (Skill + Tab) ---

  registrar.handle('image.listProviders', async () => {
    const config = await readConfig();
    return imageService.listProviders(config);
  });

  // --- Async generation (Tab UI bridge — avoids 30s worker invoke timeout) ---

  registrar.handle('image.generate.start', async (params) => {
    const genTaskId = crypto.randomUUID();
    const tasks = sidecar.apiRouter.asyncTasks;
    tasks.set(genTaskId, {
      id: genTaskId,
      status: 'pending',
      params,
      createdAt: Date.now(),
      result: null,
      error: null,
    });
    void sidecar.apiRouter.runGenerationTask(genTaskId);
    return { genTaskId };
  });

  registrar.handle('image.generate.status', async ({ genTaskId }) => {
    const task = sidecar.apiRouter.asyncTasks.get(genTaskId);
    if (!task) return { genTaskId, status: 'not_found' };
    const base = { genTaskId: task.id, status: task.status };
    if (task.status === 'success' && task.result) {
      return { ...base, imagePaths: task.result.imagePaths, provider: task.result.provider, model: task.result.model };
    }
    if (task.status === 'failed') {
      return { ...base, error: task.error || '生成失败' };
    }
    return base;
  });

  registrar.handle('image.generate', async (params) => {
    const config = await readConfig();
    return runGeneration(config, params);
  });

  registrar.handle('image.listRecords', async ({ limit = 20 } = {}) => {
    const data = storage.readData();
    return imageService.listRecords(data, limit);
  });

  registrar.handle('image.listAgentRecords', async () => {
    return storage.readAgentRecords();
  });

  registrar.handle('image.getImage', async ({ filePath }) => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const target = resolve(String(filePath));
    // Agent 生成的图片落在用户指定的 outputDir，不在插件目录内，因此只
    // 拒绝明显的敏感路径，不强制根目录白名单（否则 Agent 记录无法展示）。
    if (/(^|[\\/])\.\.([\\/]|$)/i.test(String(filePath)) || target.includes('\0')) {
      throw new Error('image_path_denied');
    }
    if (!existsSync(target)) return { dataUrl: undefined };
    const buffer = readFileSync(target);
    const ext = target.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  });

  registrar.handle('image.deleteImage', async ({ filePath }) => {
    const { existsSync, unlinkSync } = await import('node:fs');
    const { resolve, sep } = await import('node:path');
    const target = resolve(String(filePath));
    const roots = [resolve(storage.imagesDir), resolve(storage.agentImagesDir)];
    if (!roots.some((root) => target === root || target.startsWith(`${root}${sep}`))) {
      throw new Error('image_path_denied');
    }
    if (existsSync(target)) unlinkSync(target);
    return { ok: true };
  });

  // --- Image storage (for Tab UI bridge) ---

  registrar.handle('storage.saveImage', async ({ key, dataUrl }) => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    storage.ensureDirs();
    const ext = detectExt(dataUrl);
    const filePath = join(storage.imagesDir, `${safeImageKey(key)}${ext}`);
    const base64 = dataUrl.split(',')[1];
    writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { ok: true };
  });

  registrar.handle('storage.loadImage', async ({ key }) => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const candidates = [key, safeImageKey(key)];
    const imageKey = key.match(/^(.+):img:(\d+)$/);
    if (imageKey) candidates.push(`${imageKey[1]}-${imageKey[2]}`);
    const thumbKey = key.match(/^(.+):thumb$/);
    if (thumbKey) candidates.push(`${thumbKey[1]}-0`);
    for (const candidate of candidates) {
      for (const ext of ['.png', '.jpg', '.webp', '.gif']) {
        const filePath = join(storage.imagesDir, `${candidate}${ext}`);
        if (existsSync(filePath)) {
          const buffer = readFileSync(filePath);
          const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png';
          return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
        }
      }
    }
    return { dataUrl: undefined };
  });

  registrar.handle('storage.deleteImage', async ({ key }) => {
    const { unlinkSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const candidate of [key, safeImageKey(key)]) {
      for (const ext of ['.png', '.jpg', '.webp', '.gif']) {
        const filePath = join(storage.imagesDir, `${candidate}${ext}`);
        if (existsSync(filePath)) unlinkSync(filePath);
      }
    }
    return { ok: true };
  });

  // --- Model fetching / connection test ---

  registrar.handle('image.fetchModels', async ({ baseUrl, apiKey, protocol }) => {
    const { bearerHeaders, providerBase } = await import('./protocols/http.mjs');
    const provider = { baseUrl, apiKey, protocol: protocol || 'gpt' };
    const base = providerBase(provider);
    const res = await fetch(`${base}/v1/models`, {
      headers: bearerHeaders(provider),
    });
    if (!res.ok) throw new Error(`获取模型失败：${res.status}`);
    const json = await res.json();
    const all = (json.data ?? []).map((m) => m.id);
    const imageModels = all.filter((id) => /image|imagine|banana|gpt|flux|imagen|dall/i.test(id));
    return { models: imageModels.length > 0 ? imageModels : all };
  });

  registrar.handle('image.testConnection', async ({ baseUrl, apiKey, protocol }) => {
    const { bearerHeaders, providerBase } = await import('./protocols/http.mjs');
    const provider = { baseUrl, apiKey, protocol: protocol || 'gpt' };
    const base = providerBase(provider);
    try {
      const res = await fetch(`${base}/v1/models`, {
        headers: bearerHeaders(provider),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  // --- Tab surface handler ---

  registrar.handle('surface.createSession', async () => {
    return { ok: true };
  });

  registrar.onDispose(() => sidecar.stop());

  // Auto-start sidecar so the skill HTTP API is available without opening the UI
  void sidecar.start().catch(() => {});
});

function detectExt(dataUrl) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif)/);
  if (!match) return '.png';
  const mime = match[1];
  return mime === 'jpeg' || mime === 'jpg' ? '.jpg' : `.${mime}`;
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config_invalid');
  }
  const config = value;
  return {
    providers: Array.isArray(config.providers) ? config.providers : [],
    defaultProviderId: typeof config.defaultProviderId === 'string' ? config.defaultProviderId : null,
    settings: config.settings && typeof config.settings === 'object' && !Array.isArray(config.settings)
      ? config.settings
      : {},
  };
}

function safeImageKey(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, '-');
}
