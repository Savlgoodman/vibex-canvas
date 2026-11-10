export async function hashImageDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
