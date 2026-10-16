import type { Provider } from '../types';

export function providerBase(provider: Provider): string {
  return provider.baseUrl.replace(/\/+$/, '');
}

export function proxyUrl(target: string): string {
  return `/api-proxy?url=${encodeURIComponent(target)}`;
}

export function bearerHeaders(provider: Provider): Record<string, string> {
  return { Authorization: `Bearer ${provider.apiKey}` };
}

export function isGoogleHost(base: string): boolean {
  return /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/i.test(base);
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const res = await fetch(proxyUrl(url), {
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

export function dataUrl(b64: string, mime = 'image/png'): string {
  const type = mime.startsWith('image/') ? mime : 'image/png';
  return `data:${type};base64,${b64}`;
}

export function splitDataUrl(url: string): { mime: string; data: string } {
  const match = url.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('参考图需要是本地图片');
  return { mime: match[1] || 'image/png', data: match[2] };
}

export function dataURLtoBlob(dataURL: string): Blob {
  const [header, base64] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function imageFromPayload(
  data: { b64_json?: string; url?: string; mime_type?: string },
  fallbackMime = 'image/png',
): string {
  if (data.b64_json) return dataUrl(data.b64_json, data.mime_type || fallbackMime);
  if (data.url) return data.url;
  throw new Error('响应中没有图片数据');
}
