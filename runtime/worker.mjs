import { definePluginWorker } from '@vibex/plugin-sdk/worker';
import { storage } from './storage.mjs';
import { createImageService } from './imageService.mjs';

export default definePluginWorker((registrar, environment) => {
  const imageService = createImageService(storage.dataDir);

  // --- Config handlers (for Tab UI) ---

  registrar.handle('config.get', async () => {
    return environment.host.call('storage.settings.get');
  });

  registrar.handle('config.save', async (config) => {
    await environment.host.call('storage.settings.put', config);
    return { ok: true };
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
    const config = await environment.host.call('storage.settings.get');
    return imageService.listProviders(config);
  });

  registrar.handle('image.generate', async (params) => {
    const config = await environment.host.call('storage.settings.get');
    const result = await imageService.generate(config, params);

    // Save images
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

    // Record the generation
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
      source: params.outputDir ? 'agent' : 'manual',
      outputDir: params.outputDir || null,
      createdAt: Date.now(),
    };

    // Save to task or agent records
    const data = storage.readData();
    if (params.outputDir) {
      // Agent record — save by outputDir
      const agentRecords = storage.readAgentRecords();
      if (!agentRecords[params.outputDir]) agentRecords[params.outputDir] = [];
      agentRecords[params.outputDir].push(record);
      storage.writeAgentRecords(agentRecords);
    } else {
      // Manual record — add to active task or create one
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

    return {
      imagePaths,
      recordId,
      provider: result.provider,
      model: result.model,
    };
  });

  registrar.handle('image.listRecords', async ({ limit = 20 } = {}) => {
    const data = storage.readData();
    return imageService.listRecords(data, limit);
  });

  registrar.handle('image.listAgentRecords', async () => {
    return storage.readAgentRecords();
  });

  registrar.handle('image.getImage', async ({ filePath }) => {
    const { readFileSync } = await import('node:fs');
    const buffer = readFileSync(filePath);
    const ext = filePath.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  });

  // --- Tab surface handler ---

  registrar.handle('surface.createSession', async () => {
    return { ok: true };
  });

  registrar.onDispose(() => {
    // Cleanup if needed
  });
});
