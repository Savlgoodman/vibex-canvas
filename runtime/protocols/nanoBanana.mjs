import { bearerHeaders, dataUrl, isGoogleHost, postJson, providerBase, splitDataUrl } from './http.mjs';

function interactionsUrl(base) {
  if (base.endsWith('/interactions')) return base;
  if (base.endsWith('/v1beta')) return `${base}/interactions`;
  return `${base}/v1beta/interactions`;
}

async function requestOne(provider, request) {
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
  const responseFormat = { type: 'image' };
  if (request.options.aspectRatio) responseFormat.aspect_ratio = String(request.options.aspectRatio);
  if (request.options.imageSize) responseFormat.image_size = String(request.options.imageSize);
  if (request.options.mimeType) responseFormat.mime_type = String(request.options.mimeType);
  const body = {
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

function findImage(json) {
  const direct = json.output_image;
  if (direct?.data) return direct;
  const steps = json.steps ?? json.outputs;
  for (const step of steps ?? []) {
    if (!step || typeof step !== 'object') continue;
    if (step.type === 'image' && typeof step.data === 'string') return step;
    const blocks = step.content ?? step.summary;
    for (const block of blocks ?? []) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'image' && block.data) return block;
    }
  }
  const data = json.data;
  if (data?.[0]?.b64_json) return { data: data[0].b64_json, mime_type: data[0].mime_type };
  return undefined;
}

export const nanoBananaAdapter = { id: 'nano-banana', label: 'Nano Banana', requestOne };
