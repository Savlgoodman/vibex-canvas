export function providerBase(provider) {
  return provider.baseUrl.replace(/\/+$/, '');
}

export function bearerHeaders(provider) {
  return { Authorization: `Bearer ${provider.apiKey}` };
}

export function isGoogleHost(base) {
  return /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/i.test(base);
}

export async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`接口错误 ${res.status}：${text || res.statusText}`);
  }
  return res;
}

export function dataUrl(b64, mime = 'image/png') {
  const type = mime.startsWith('image/') ? mime : 'image/png';
  return `data:${type};base64,${b64}`;
}

export function splitDataUrl(url) {
  const match = url.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('参考图需要是本地图片');
  return { mime: match[1] || 'image/png', data: match[2] };
}

export function imageFromPayload(data, fallbackMime = 'image/png') {
  if (data.b64_json) return dataUrl(data.b64_json, data.mime_type || fallbackMime);
  if (data.url) return data.url;
  throw new Error('响应中没有图片数据');
}

export function dataUrlToBuffer(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const bytes = Buffer.from(base64, 'base64');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
  return { bytes, mime };
}
