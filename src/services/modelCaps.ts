import type { ModelCaps, Provider } from '../types';

/** Sunburst and Flare unlock transparent output and the higher quality tiers. */
export function defaultModelCaps(model: string): ModelCaps {
  const name = model.toLowerCase();
  const premium = name.includes('sunburst') || name.includes('flare');
  return { transparent: premium, extendedQuality: premium };
}

export function resolveModelCaps(provider: Provider | undefined, model: string): ModelCaps {
  if ((provider?.protocol ?? 'gpt') !== 'gpt') return { transparent: false, extendedQuality: false };
  const saved = provider?.modelCaps?.[model];
  if (saved) return saved;
  return defaultModelCaps(model);
}
