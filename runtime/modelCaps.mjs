/** Sunburst and Flare unlock transparent output and the higher quality tiers. */
export function defaultModelCaps(model) {
  const name = model.toLowerCase();
  const premium = name.includes('sunburst') || name.includes('flare');
  return { transparent: premium, extendedQuality: premium };
}

export function resolveModelCaps(provider, model) {
  if ((provider?.protocol ?? 'gpt') !== 'gpt') return { transparent: false, extendedQuality: false };
  const saved = provider?.modelCaps?.[model];
  if (saved) return saved;
  return defaultModelCaps(model);
}
