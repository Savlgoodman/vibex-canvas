/** Build a display overlay: drawn (editable) regions are translucent red. */
export async function maskToOverlay(maskUrl: string): Promise<string> {
  const img = await loadImage(maskUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return maskUrl;
  ctx.drawImage(img, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < frame.data.length; i += 4) {
    if (frame.data[i + 3] < 128) {
      out.data[i] = 239;
      out.data[i + 1] = 68;
      out.data[i + 2] = 68;
      out.data[i + 3] = 110;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取遮罩'));
    img.src = url;
  });
}
