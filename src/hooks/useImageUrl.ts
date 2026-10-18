import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

/**
 * Resolve a stored image marker (IDB or Worker file) to a real data URL.
 * Returns undefined while loading. Pass-through for real URLs.
 */
export function useImageUrl(marker: string | undefined): string | undefined {
  const loadImage = useStore((s) => s.loadImage);
  const cache = useStore((s) => s.imageCache);
  const isIdb = marker?.startsWith('idb:');
  const isWorker = marker?.startsWith('store:');
  const isStored = isIdb || isWorker || marker?.startsWith('file:');
  const key = isIdb ? marker?.slice(4) : isWorker ? marker?.slice(6) : isStored ? marker : undefined;
  const cached = key ? cache[key] : undefined;
  const [resolved, setResolved] = useState<string | undefined>(
    cached ?? (marker && !isStored ? marker : undefined),
  );

  useEffect(() => {
    if (!marker) { setResolved(undefined); return; }
    if (!isStored) { setResolved(marker); return; }
    if (cached) { setResolved(cached); return; }

    let cancelled = false;
    loadImage(key!).then((url) => {
      if (!cancelled) setResolved(url);
    }).catch((error) => {
      console.error('[vibexCanvas] image load failed', { marker, error });
      if (!cancelled) setResolved(undefined);
    });
    return () => { cancelled = true; };
  }, [marker, cached, key, isStored, loadImage]);

  return resolved;
}
