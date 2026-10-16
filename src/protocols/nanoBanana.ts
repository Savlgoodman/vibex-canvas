import type { Provider } from '../types';
import { bearerHeaders, dataUrl, isGoogleHost, postJson, providerBase, splitDataUrl } from './http';
import type { ImageRequest, ProtocolAdapter } from './types';

function interactionsUrl(base: string): string {
  if (base.endsWith('/interactions')) return base;
  if (base.endsWith('/v1beta')) return `${base}/interactions`;
  return `${base}/v1beta/interactions`;
}

async function requestOne(provider: Provider, request: ImageRequest): Promise<{ imageUrls: string[] }> {
  const base = providerBase(provider);
  const refs = request.referenceImages.filter(Boolean);
  const input = refs.length
    ? [
        { type: 'text', text: request.prompt },
        ...refs.map((url) => {
          const image = splitDataUrl(url);
          return { type: 'image', data: image.data, mime_type: image.mime };
        }),
      ]
    : request.prompt;
  const responseFormat: Record<string, string> = { type: 'image' };
  if (request.options.aspectRatio) responseFormat.aspect_ratio = String(request.options.aspectRatio);
  if (request.options.imageSize) responseFormat.image_size = String(request.options.imageSize);
  if (request.options.mimeType) responseFormat.mime_type = String(request.options.mimeType);
  const body: Record<string, unknown> = {
    model: request.model,
    input,
    response_format: responseFormat,
  };
  if (request.options.thinkingLevel) {
    body.generation_config = { thinking_level: request.options.thinkingLevel };
  }
  const headers = isGoogleHost(base)
    ? { 'x-goog-api-key': provider.apiKey }
    : bearerHeaders(provider);
  const res = await postJson(interactionsUrl(base), headers, body);
  const json = await res.json();
  const image = findImage(json);
  if (!image?.data) throw new Error('响应中没有图片数据');
  return { imageUrls: [dataUrl(image.data, image.mime_type || image.mime || 'image/png')] };
}

function findImage(json: Record<string, unknown>): { data?: string; mime_type?: string; mime?: string } | undefined {
  const direct = json.output_image as { data?: string; mime_type?: string } | undefined;
  if (direct?.data) return direct;
  const steps = (json.steps ?? json.outputs) as unknown[] | undefined;
  for (const step of steps ?? []) {
    if (!step || typeof step !== 'object') continue;
    const record = step as Record<string, unknown>;
    if (record.type === 'image' && typeof record.data === 'string') return record as { data: string; mime_type?: string };
    const blocks = (record.content ?? record.summary) as unknown[] | undefined;
    for (const block of blocks ?? []) {
      if (!block || typeof block !== 'object') continue;
      const item = block as { type?: string; data?: string; mime_type?: string };
      if (item.type === 'image' && item.data) return item;
    }
  }
  const data = json.data as { b64_json?: string; mime_type?: string }[] | undefined;
  if (data?.[0]?.b64_json) return { data: data[0].b64_json, mime_type: data[0].mime_type };
  return undefined;
}

export const nanoBananaAdapter: ProtocolAdapter = {
  id: 'nano-banana',
  label: 'Nano Banana',
  requestOne,
};
