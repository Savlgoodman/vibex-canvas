import type { Provider } from '../types';
import { getAdapter, protocolOf } from '../protocols/registry';
import type { ImageRequest } from '../protocols/types';
import { bearerHeaders, providerBase, proxyUrl } from '../protocols/http';
import { withImageSlot } from './rateLimit';

export async function fetchModels(provider: Provider): Promise<string[]> {
  const base = providerBase(provider);
  const res = await fetch(proxyUrl(`${base}/v1/models`), {
    headers: bearerHeaders(provider),
  });
  if (!res.ok) throw new Error(`获取模型失败：${res.status}`);
  const json = await res.json();
  const all: string[] = (json.data ?? []).map((m: { id: string }) => m.id);
  const imageModels = all.filter((id: string) => /image|imagine|banana|gpt|flux|imagen|dall/i.test(id));
  return imageModels.length > 0 ? imageModels : all;
}

export interface GenerateRequest extends ImageRequest {
  count?: number;
  onImage?: (index: number, url: string) => void | Promise<void>;
}

export async function generateImage(
  provider: Provider,
  params: GenerateRequest,
): Promise<{ imageUrls: string[] }> {
  const count = Math.min(9, Math.max(1, params.count ?? 1));
  if (count > 1) {
    return generateMany(provider, { ...params, count: 1, partialImages: 0 }, count);
  }
  return withImageSlot(() => requestOne(provider, params));
}

async function requestOne(provider: Provider, params: GenerateRequest): Promise<{ imageUrls: string[] }> {
  const adapter = getAdapter(protocolOf(provider.protocol));
  const spec = await adapter.requestOne(provider, params);
  return { imageUrls: spec.imageUrls.slice(0, 1) };
}

async function generateMany(
  provider: Provider,
  params: GenerateRequest,
  count: number,
): Promise<{ imageUrls: string[] }> {
  const results = await Promise.allSettled(
    Array.from({ length: count }, async (_, index) => {
      const result = await generateImage(provider, {
        ...params,
        count: 1,
        onImage: undefined,
        onPartial: undefined,
      });
      const url = result.imageUrls[0];
      if (url && params.onImage) {
        try {
          await params.onImage(index, url);
        } catch (err) {
          console.error(err);
        }
      }
      return result;
    }),
  );
  const imageUrls = results.flatMap((result) => result.status === 'fulfilled' ? result.value.imageUrls : []);
  if (!imageUrls.length) {
    const failed = results.find((result) => result.status === 'rejected');
    throw failed?.status === 'rejected' ? failed.reason : new Error('生成失败');
  }
  return { imageUrls };
}

export async function testConnection(provider: Provider): Promise<boolean> {
  const res = await fetch(proxyUrl(`${providerBase(provider)}/v1/models`), {
    headers: bearerHeaders(provider),
  });
  return res.ok;
}
