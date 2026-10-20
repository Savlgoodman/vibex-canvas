/**
 * Bridge abstraction layer.
 *
 * In VibeX Host: `window.__vibex_bridge` is set by the Federation runtime,
 * providing `invoke(handler, input)` that routes to the Worker.
 *
 * Standalone (npm run dev): no bridge available, falls back to localStorage + IDB.
 *
 * All store/services code imports from this module instead of calling
 * localStorage/IDB directly.
 */

import { idbSet, idbSetMany, idbGet, idbDelete } from '../services/idb';

const STORAGE_KEY = 'super-canvas-state';

interface Bridge {
  invoke(handler: string, input?: unknown): Promise<unknown>;
}

function getBridge(): Bridge | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__vibex_bridge as Bridge | undefined ?? null;
}

// --- Config (providers + settings) ---

export async function loadConfig(): Promise<{
  providers: unknown[];
  defaultProviderId?: string | null;
  settings: unknown;
  tasks?: unknown[];
  activeTaskId?: string | null;
} | null> {
  const bridge = getBridge();
  if (bridge) {
    return bridge.invoke('config.get') as Promise<ReturnType<typeof loadConfig>>;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveConfig(data: {
  providers: unknown[];
  defaultProviderId?: string | null;
  settings: unknown;
}): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.invoke('config.save', data);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota
  }
}

export async function loadTasks(): Promise<{
  tasks: unknown[];
  activeTaskId: string | null;
}> {
  const bridge = getBridge();
  if (bridge) {
    return bridge.invoke('task.list') as Promise<{ tasks: unknown[]; activeTaskId: string | null }>;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { tasks: parsed.tasks ?? [], activeTaskId: parsed.activeTaskId ?? null };
  } catch {
    return { tasks: [], activeTaskId: null };
  }
}

export async function saveTasks(data: { tasks: unknown[]; activeTaskId: string | null }): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.invoke('task.save', data);
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...data }));
  } catch {
    // quota
  }
}

// --- Providers (stored inside config) ---
// Providers are part of config, so no separate bridge calls needed.

// --- Image storage ---

export async function saveImage(key: string, dataUrl: string): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.invoke('storage.saveImage', { key, dataUrl });
    return;
  }
  await idbSet(key, dataUrl);
}

export async function saveImages(entries: [string, string][]): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    for (const [key, dataUrl] of entries) {
      await bridge.invoke('storage.saveImage', { key, dataUrl });
    }
    return;
  }
  await idbSetMany(entries);
}

export async function loadImage(key: string): Promise<string | undefined> {
  const bridge = getBridge();
  if (bridge) {
    if (key.startsWith('file:')) {
      const result = await bridge.invoke('image.getImage', {
        filePath: key.slice(5),
      }) as { dataUrl?: string };
      return result?.dataUrl;
    }
    const result = await bridge.invoke('storage.loadImage', { key }) as { dataUrl?: string };
    return result?.dataUrl ?? idbGet(key);
  }
  return idbGet(key);
}

export async function deleteImage(key: string): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    if (key.startsWith('file:')) {
      await bridge.invoke('image.deleteImage', { filePath: key.slice(5) });
      return;
    }
    await bridge.invoke('storage.deleteImage', { key });
    return;
  }
  await idbDelete(key);
}

// --- Image generation ---

const GEN_POLL_INTERVAL_MS = 2_000;

export async function generateImage(params: Record<string, unknown>): Promise<{
  imagePaths: string[];
  recordId: string;
  provider: string;
  model: string;
}> {
  const bridge = getBridge();
  if (bridge) {
    // Async path: start generation, then poll for result.
    // Each bridge invoke is short (< 1s) so it stays within the host's 30s
    // worker-invoke timeout. The actual image generation runs in the worker
    // background and may take minutes for large prompts.
    const { genTaskId } = await bridge.invoke('image.generate.start', params) as { genTaskId: string };
    return pollGenerationResult(bridge, genTaskId);
  }
  // Standalone: call local API (for dev without Host)
  throw new Error('生图需要 VibeX Host 连接。请先运行 vibex plugin run dev。');
}

async function pollGenerationResult(
  bridge: Bridge,
  genTaskId: string,
): Promise<{ imagePaths: string[]; recordId: string; provider: string; model: string }> {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, GEN_POLL_INTERVAL_MS));
    const status = await bridge.invoke('image.generate.status', { genTaskId }) as {
      genTaskId: string;
      status: string;
      imagePaths?: string[];
      provider?: string;
      model?: string;
      recordId?: string;
      error?: string;
    };
    if (status.status === 'success') {
      return {
        imagePaths: status.imagePaths ?? [],
        recordId: status.recordId ?? '',
        provider: status.provider ?? '',
        model: status.model ?? '',
      };
    }
    if (status.status === 'failed') {
      throw new Error(status.error || '生成失败');
    }
    // 'not_found', 'pending', 'generating' — keep polling
  }
}

export async function listProviders(): Promise<{
  providers: unknown[];
  defaultProviderId: string | null;
}> {
  const bridge = getBridge();
  if (bridge) {
    return bridge.invoke('image.listProviders') as Promise<{
      providers: unknown[];
      defaultProviderId: string | null;
    }>;
  }
  return { providers: [], defaultProviderId: null };
}

// --- Helpers ---

export function hasBridge(): boolean {
  return getBridge() !== null;
}
