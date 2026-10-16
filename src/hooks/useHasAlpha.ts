import { useEffect, useState } from 'react';

/** True only when the image actually contains transparent pixels. */
export function useHasAlpha(url: string | undefined): boolean {
  const [hasAlpha, setHasAlpha] = useState(false);

  useEffect(() => {
    if (!url) {
      setHasAlpha(false);
      return;
    }
    if (url.startsWith('data:image/jpeg')) {
      setHasAlpha(false);
      return;
    }
    let cancelled = false;
    imageHasAlpha(url).then((value) => {
      if (!cancelled) setHasAlpha(value);
    });
    return () => { cancelled = true; };
  }, [url]);

  return hasAlpha;
}

function imageHasAlpha(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sample = 96;
      const scale = Math.min(1, sample / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(false);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) {
          resolve(true);
          return;
        }
      }
      resolve(false);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
