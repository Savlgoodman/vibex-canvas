import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

/**
 * Resolve an IDB image marker (e.g. "idb:abc123") to a real data URL.
 * Returns undefined while loading. Pass-through for real URLs.
 */
export function useImageUrl(marker: string | undefined): string | undefined {
  const loadImage = useStore((s) => s.loadImage);
  const cache = useStore((s) => s.imageCache);
  const key = marker?.startsWith('idb:') ? marker.slice(4) : undefined;
  const cached = key ? cache[key] : undefined;
  const [resolved, setResolved] = useState<string | undefined>(
    cached ?? (marker && !marker.startsWith('idb:') ? marker : undefined),
  );

  useEffect(() => {
    if (!marker) { setResolved(undefined); return; }
    if (!marker.startsWith('idb:')) { setResolved(marker); return; }
    if (cached) { setResolved(cached); return; }

    let cancelled = false;
    loadImage(key!).then((url) => { if (!cancelled) setResolved(url); });
    return () => { cancelled = true; };
  }, [marker, cached, key, loadImage]);

  return resolved;
}
