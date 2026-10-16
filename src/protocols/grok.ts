import type { Provider } from '../types';
import { bearerHeaders, imageFromPayload, postJson, providerBase } from './http';
import type { ImageRequest, ProtocolAdapter } from './types';

const GROK_QUALITIES = new Set(['low', 'medium', 'auto']);

function imageRef(url: string) {
  return { url, type: 'image_url' };
}

async function requestOne(provider: Provider, request: ImageRequest): Promise<{ imageUrls: string[] }> {
  const base = providerBase(provider);
  const refs = request.referenceImages.filter(Boolean).slice(0, 5);
  const target = `${base}${refs.length ? '/v1/images/edits' : '/v1/images/generations'}`;
  const aspect = String(request.options.aspectRatio || 'auto');
  const resolution = String(request.options.resolution || '1k');
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    n: 1,
    aspect_ratio: aspect,
    resolution,
    response_format: 'b64_json',
  };
  if (request.model === 'grok-imagine-image-2.0' && request.quality && GROK_QUALITIES.has(request.quality)) {
    body.quality = request.quality;
  }
  if (refs.length === 1) body.image = imageRef(refs[0]);
  else if (refs.length > 1) body.images = refs.map(imageRef);

  const res = await postJson(target, bearerHeaders(provider), body);
  const json = await res.json();
  const item = json.data?.[0];
  if (!item) throw new Error('响应中没有图片数据');
  return { imageUrls: [imageFromPayload(item, item.mime_type || 'image/jpeg')] };
}

export const grokAdapter: ProtocolAdapter = {
  id: 'grok',
  label: 'Grok',
  requestOne,
};
