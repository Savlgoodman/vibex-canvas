import { bearerHeaders, dataUrlToBuffer, imageFromPayload, postJson, providerBase } from './http.mjs';

async function requestOne(provider, request) {
  const base = providerBase(provider);
  const refs = request.referenceImages.filter(Boolean);
  const isEdit = refs.length > 0;
  const target = `${base}${isEdit ? '/v1/images/edits' : '/v1/images/generations'}`;
  const format = request.outputFormat ?? 'png';
  const partials = request.partialImages && request.partialImages > 0 ? request.partialImages : 0;
  const headers = bearerHeaders(provider);

  let res;
  if (isEdit) {
    const form = new FormData();
    form.append('prompt', request.prompt);
    form.append('model', request.model);
    form.append('size', request.size || '1024x1024');
    form.append('quality', request.quality || 'auto');
    form.append('n', '1');
    form.append('output_format', format);
    if (request.background) form.append('background', request.background);
    if (format !== 'png' && request.outputCompression != null) {
      form.append('output_compression', String(request.outputCompression));
    }
    refs.forEach((url, i) => {
      const { bytes, mime } = dataUrlToBuffer(url);
      form.append('image[]', new Blob([bytes], { type: mime }), `reference-${i}.png`);
    });
    if (refs.length === 1 && request.maskImage) {
      const { bytes, mime } = dataUrlToBuffer(request.maskImage);
      form.append('mask', new Blob([bytes], { type: mime }), 'mask.png');
    }
    if (partials > 0) {
      form.append('stream', 'true');
      form.append('partial_images', String(partials));
    }
    res = await fetch(target, { method: 'POST', headers, body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`接口错误 ${res.status}：${text || res.statusText}`);
    }
  } else {
    res = await postJson(target, headers, {
      model: request.model,
      prompt: request.prompt,
      size: request.size || '1024x1024',
      quality: request.quality || 'auto',
      n: 1,
      output_format: format,
      ...(request.background ? { background: request.background } : {}),
      ...(format !== 'png' && request.outputCompression != null
        ? { output_compression: request.outputCompression }
        : {}),
      ...(partials > 0 ? { stream: true, partial_images: partials } : {}),
    });
  }

  const contentType = res.headers.get('content-type') || '';
  if (partials > 0 && (contentType.includes('text/event-stream') || contentType.includes('text/plain')) && res.body) {
    const imageUrl = (await readImageStream(res, format, request.onPartial)).imageUrl;
    return { imageUrls: [imageUrl] };
  }

  const json = await res.json();
  const items = json.data ?? [];
  const imageUrls = items.map((item) =>
    imageFromPayload(item, format === 'jpeg' ? 'image/jpeg' : `image/${format}`),
  );
  if (!imageUrls.length) throw new Error('响应中没有图片数据');
  return { imageUrls: [imageUrls[0]] };
}

async function readImageStream(res, format, onPartial) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finalUrl = '';
  let lastPartial = '';

  const handleEvent = (event) => {
    if (event.error) {
      throw new Error(event.error.message || '生成失败');
    }
    const b64 = typeof event.b64_json === 'string' ? event.b64_json : '';
    if (!b64) return;
    const url = `data:image/${format === 'jpeg' ? 'jpeg' : format};base64,${b64}`;
    const type = String(event.type ?? '');
    if (type.includes('partial')) {
      lastPartial = url;
      onPartial?.(url, Number(event.partial_image_index ?? 0));
    } else {
      finalUrl = url;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const drained = drainSse(buf);
    buf = drained.rest;
    for (const event of drained.events) handleEvent(event);
  }
  if (buf.trim()) {
    const drained = drainSse(buf + '\n\n');
    for (const event of drained.events) handleEvent(event);
  }
  const imageUrl = finalUrl || lastPartial;
  if (!imageUrl) throw new Error('响应中没有图片数据');
  return { imageUrl };
}

function drainSse(buffer) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events = [];
  for (const part of parts) {
    const data = part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Ignore keep-alive or non-JSON chunks.
    }
  }
  return { events, rest };
}

export const gptAdapter = { id: 'gpt', label: 'GPT', requestOne };
export const otherAdapter = { id: 'other', label: '其他', requestOne };
