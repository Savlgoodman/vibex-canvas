import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

export interface ImageState {
  /** Resolved data/real URL, undefined while loading or when the image is gone. */
  url: string | undefined;
  /**
   * True once loading has settled without producing a URL — the file was
   * deleted, moved, or is otherwise unreachable. Callers should show a
   * "图片已丢失或删除" placeholder instead of an empty box.
   */
  missing: boolean;
}

/**
 * Resolve a stored image marker (IDB or Worker file) to a real data URL.
 * Pass-through for real URLs. Returns a missing signal once loading settles
 * without a URL, so callers can distinguish "still loading" from "gone".
 */
export function useImageState(marker: string | undefined): ImageState {
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
  const [settled, setSettled] = useState<boolean>(Boolean(cached) || Boolean(marker && !isStored));

  useEffect(() => {
    if (!marker) { setResolved(undefined); setSettled(true); return; }
    if (!isStored) { setResolved(marker); setSettled(true); return; }
    if (cached) { setResolved(cached); setSettled(true); return; }

    setResolved(undefined);
    setSettled(false);
    let cancelled = false;
    loadImage(key!).then((url) => {
      if (cancelled) return;
      setResolved(url);
      setSettled(true);
    }).catch((error) => {
      console.error('[vibexCanvas] image load failed', { marker, error });
      if (cancelled) return;
      setResolved(undefined);
      setSettled(true);
    });
    return () => { cancelled = true; };
  }, [marker, cached, key, isStored, loadImage]);

  return { url: resolved, missing: settled && !resolved };
}

/**
 * Back-compat shim: most callers only want the URL.
 */
export function useImageUrl(marker: string | undefined): string | undefined {
  return useImageState(marker).url;
}
