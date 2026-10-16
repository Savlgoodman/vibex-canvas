import type { Provider } from '../types';
import { bearerHeaders, imageFromPayload, postJson, providerBase } from './http';
import type { ImageRequest, ProtocolAdapter } from './types';

function generationsUrl(base: string): string {
  if (base.endsWith('/images/generations')) return base;
  if (base.endsWith('/openai')) return `${base}/images/generations`;
  if (base.endsWith('/v1beta')) return `${base}/openai/images/generations`;
  return `${base}/v1beta/openai/images/generations`;
}

async function requestOne(provider: Provider, request: ImageRequest): Promise<{ imageUrls: string[] }> {
  const base = providerBase(provider);
  const format = String(request.options.responseFormat || 'b64_json');
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    n: 1,
    size: request.size || '1024x1024',
    response_format: format,
  };
  if (request.options.aspectRatio) body.aspect_ratio = request.options.aspectRatio;
  const res = await postJson(generationsUrl(base), bearerHeaders(provider), body);
  const json = await res.json();
  const item = json.data?.[0];
  if (!item) throw new Error('响应中没有图片数据');
  return { imageUrls: [imageFromPayload(item)] };
}

export const geminiAdapter: ProtocolAdapter = {
  id: 'gemini',
  label: 'Gemini',
  requestOne,
};
