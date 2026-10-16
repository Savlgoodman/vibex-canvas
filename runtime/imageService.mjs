import { getAdapter, protocolOf } from './protocols/registry.mjs';
import { configureRateLimit, normalizeRateLimit, withImageSlot } from './rateLimit.mjs';
import { defaultModelCaps, resolveModelCaps } from './modelCaps.mjs';

export function createImageService(dataDir) {
  return { generate, listProviders, listRecords };

  function listProviders(config) {
    const providers = (config.providers || []).map((p) => ({
      id: p.id,
      name: p.name,
      protocol: p.protocol || 'gpt',
      models: (p.models || []).map((m) => typeof m === 'string' ? { id: m, name: m } : m),
      isDefault: p.id === config.defaultProviderId,
    }));
    return { providers, defaultProviderId: config.defaultProviderId };
  }

  async function generate(config, params) {
    const { providers, defaultProviderId } = listProviders(config);
    if (!providers.length) throw new Error('没有配置供应商，请先在设置中添加供应商');

    const providerId = params.providerId || defaultProviderId;
    if (!providerId) throw new Error('没有默认供应商，请指定 providerId');

    const providerConfig = providers.find((p) => p.id === providerId);
    if (!providerConfig) throw new Error(`找不到供应商: ${providerId}`);

    const rawProvider = (config.providers || []).find((p) => p.id === providerId);
    const model = params.model || providerConfig.models[0]?.id;
    if (!model) throw new Error(`供应商 ${providerConfig.name} 没有可用模型`);

    const protocol = protocolOf(rawProvider.protocol);
    const adapter = getAdapter(protocol);
    const caps = resolveModelCaps(rawProvider, model);

    const request = {
      model,
      prompt: params.prompt,
      referenceImages: params.referenceImages || [],
      maskImage: params.maskImage,
      quality: params.quality || 'auto',
      size: params.size || '1024x1024',
      outputFormat: params.outputFormat || 'png',
      background: params.background || 'auto',
      outputCompression: params.outputCompression,
      partialImages: 0,
      options: params.protocolOptions || {},
    };

    // Rate-limited generation
    const rateCfg = normalizeRateLimit(config.settings);
    configureRateLimit(rateCfg);

    const result = await withImageSlot(() => adapter.requestOne(rawProvider, request));
    return { imageUrls: result.imageUrls, provider: providerConfig.name, model };
  }

  function listRecords(data, limit = 20) {
    const allRecords = [];
    for (const task of data.tasks || []) {
      for (const record of task.records || []) {
        allRecords.push({
          id: record.id,
          taskId: task.id,
          prompt: record.prompt,
          providerId: record.providerId,
          model: record.model,
          status: record.status,
          imagePaths: record.imagePaths || [],
          source: record.source || 'manual',
          outputDir: record.outputDir,
          createdAt: record.createdAt,
        });
      }
    }
    allRecords.sort((a, b) => b.createdAt - a.createdAt);
    return allRecords.slice(0, limit);
  }
}
