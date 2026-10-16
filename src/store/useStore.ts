import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { AppSettings, Provider, Task, GenRecord } from '../types';
import { panelSpec, protocolOf } from '../protocols/registry';
import { resolveModelCaps } from '../services/modelCaps';
import { idbSet, idbSetMany, idbGet, idbDelete } from '../services/idb';
import { generateImage } from '../services/api';
import { configureRateLimit, normalizeRateLimit } from '../services/rateLimit';

function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  return {
    partialImages: raw?.partialImages ?? true,
    ...normalizeRateLimit(raw ?? undefined),
  };
}

const STORAGE_KEY = 'super-canvas-state';

interface StoreState {
  providers: Provider[];
  tasks: Task[];
  activeTaskId: string | null;
  settings: AppSettings;
  /** In-memory cache of image URLs keyed by record ID, loaded from IDB on demand */
  imageCache: Record<string, string>;
  /** Latest streamed partial, keyed by record id. Not persisted. */
  partialPreviews: Record<string, string>;

  // Provider actions
  addProvider: (p: Omit<Provider, 'id'>) => string;
  updateProvider: (id: string, p: Partial<Provider>) => void;
  deleteProvider: (id: string) => void;
  setDefaultProvider: (id: string) => void;

  // Task actions
  addTask: () => string;
  deleteTask: (id: string) => void;
  archiveTask: (id: string) => void;
  restoreTask: (id: string) => void;
  setActiveTask: (id: string) => void;

  // Record actions
  addRecord: (taskId: string, record: Omit<GenRecord, 'id' | 'createdAt'>) => string;
  /** Starts a generation that keeps running after the user switches tasks. */
  runGeneration: (taskId: string, provider: Provider, params: {
    prompt: string;
    providerId: string;
    model: string;
    size: string;
    quality: string;
    outputFormat?: GenRecord['outputFormat'];
    background?: GenRecord['background'];
    outputCompression?: number;
    referenceImages?: string[];
    maskImage?: string;
    protocolOptions?: GenRecord['protocolOptions'];
    count?: number;
  }) => string;
  updateSettings: (patch: Partial<AppSettings>) => void;
  updateRecord: (taskId: string, recordId: string, updates: Partial<GenRecord>) => void;
  updateTaskMeta: (taskId: string, updates: Partial<Task>) => void;

  // Image loading
  loadImage: (recordId: string) => Promise<string | undefined>;
}

/** Persist metadata only — strip image blobs, replace with IDB key markers */
function serializeForStorage(state: { providers: Provider[]; tasks: Task[]; activeTaskId: string | null; settings?: AppSettings }) {
  const tasks = state.tasks.map((t) => ({
    ...t,
    thumbnailUrl: t.thumbnailUrl ? `idb:${t.id}:thumb` : undefined,
    records: t.records.map((r) => ({
      ...r,
      imageUrl: (r.imageUrl || r.imageUrls?.length) ? `idb:${r.id}` : undefined,
      imageUrls: r.imageUrls?.length
        ? r.imageUrls.map((url, i) => (url ? `idb:${r.id}:img:${i}` : ''))
        : undefined,
      referenceImage: r.referenceImage ? `idb:${r.id}:ref` : undefined,
      referenceImages: r.referenceImages?.length
        ? r.referenceImages.map((_, i) => `idb:${r.id}:ref:${i}`)
        : undefined,
      maskImage: r.maskImage ? `idb:${r.id}:mask` : undefined,
    })),
  }));
  return JSON.stringify({
    providers: state.providers,
    tasks,
    activeTaskId: state.activeTaskId,
    settings: normalizeSettings(state.settings),
  });
}

function persist(state: StoreState) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeForStorage(state));
  } catch {
    console.warn('localStorage quota reached, trimming old data');
  }
}

async function saveGeneratedImages(taskId: string, recordId: string, urls: string[]) {
  const entries: [string, string][] = urls.map((url, i) => [`${recordId}:img:${i}`, url]);
  if (urls[0]) {
    entries.push([recordId, urls[0]], [`${taskId}:thumb`, urls[0]]);
  }
  await idbSetMany(entries);
  const cache: Record<string, string> = {};
  urls.forEach((url, i) => { cache[`${recordId}:img:${i}`] = url; });
  if (urls[0]) {
    cache[recordId] = urls[0];
    cache[`${taskId}:thumb`] = urls[0];
  }
  return {
    imageUrl: `idb:${recordId}`,
    imageUrls: urls.map((_, i) => `idb:${recordId}:img:${i}`),
    thumb: `idb:${taskId}:thumb`,
    cache,
  };
}

function saveRecordBlobs(recordId: string, record: Omit<GenRecord, 'id' | 'createdAt'>) {
  record.referenceImages?.forEach((img, i) => {
    if (img && !img.startsWith('idb:')) idbSet(`${recordId}:ref:${i}`, img).catch(console.error);
  });
  if (record.referenceImage && !record.referenceImage.startsWith('idb:')) {
    idbSet(`${recordId}:ref`, record.referenceImage).catch(console.error);
  }
  if (record.maskImage && !record.maskImage.startsWith('idb:')) {
    idbSet(`${recordId}:mask`, record.maskImage).catch(console.error);
  }
}

function loadState(): Partial<{ providers: Provider[]; tasks: Task[]; activeTaskId: string | null; settings: AppSettings }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // A reload cannot resume an in-flight request, so don't leave a permanent spinner.
    if (Array.isArray(parsed.providers)) {
      parsed.providers = parsed.providers.map((p: Provider) => ({ ...p, protocol: protocolOf(p.protocol) }));
    }
    if (Array.isArray(parsed.tasks)) {
      parsed.tasks = parsed.tasks.map((t: Task) => ({
        ...t,
        records: (t.records ?? []).map((r) => (
          r.status === 'pending' ? { ...r, status: 'failed', error: r.error || '生成已中断' } : r
        )),
      }));
    }
    parsed.settings = normalizeSettings(parsed.settings);
    return parsed;
  } catch {
    return {};
  }
}

export const useStore = create<StoreState>((set, get) => {
  const initial = loadState();
  const settings = normalizeSettings(initial.settings);
  configureRateLimit(settings);
  return {
    providers: initial.providers ?? [],
    tasks: initial.tasks ?? [],
    activeTaskId: initial.activeTaskId ?? null,
    settings,
    imageCache: {},
    partialPreviews: {},

    addProvider: (p) => {
      const id = uuid();
      set((s) => {
        const provider: Provider = { ...p, id };
        const providers = s.providers.length === 0
          ? [{ ...provider, isDefault: true }]
          : [...s.providers, provider];
        const next = { ...s, providers };
        persist(next);
        return next;
      });
      return id;
    },

    updateProvider: (id, p) =>
      set((s) => {
        const providers = s.providers.map((x) => (x.id === id ? { ...x, ...p } : x));
        const next = { ...s, providers };
        persist(next);
        return next;
      }),

    deleteProvider: (id) =>
      set((s) => {
        const providers = s.providers.filter((x) => x.id !== id);
        if (providers.length > 0 && !providers.some((x) => x.isDefault)) {
          providers[0].isDefault = true;
        }
        const next = { ...s, providers };
        persist(next);
        return next;
      }),

    setDefaultProvider: (id) =>
      set((s) => {
        const providers = s.providers.map((x) => ({ ...x, isDefault: x.id === id }));
        const next = { ...s, providers };
        persist(next);
        return next;
      }),

    addTask: () => {
      const id = uuid();
      const defaultProvider = get().providers.find((p) => p.isDefault) ?? get().providers[0];
      const now = Date.now();
      const task: Task = {
        id,
        title: '新任务',
        providerId: defaultProvider?.id ?? '',
        model: defaultProvider?.models[0] ?? 'gpt-image-2',
        size: '1024x1024',
        quality: 'medium',
        records: [],
        createdAt: now,
        updatedAt: now,
      };
      set((s) => {
        const next = { ...s, tasks: [task, ...s.tasks], activeTaskId: id };
        persist(next);
        return next;
      });
      return id;
    },

    deleteTask: (id) =>
      set((s) => {
        // Clean up IDB images for deleted task's records
        const task = s.tasks.find((t) => t.id === id);
        if (task) {
          task.records.forEach((r) => {
            idbDelete(r.id).catch(() => {});
            idbDelete(`${r.id}:ref`).catch(() => {});
            idbDelete(`${r.id}:mask`).catch(() => {});
            for (let i = 0; i < 16; i++) idbDelete(`${r.id}:ref:${i}`).catch(() => {});
          });
          idbDelete(`${id}:thumb`).catch(() => {});
        }
        const tasks = s.tasks.filter((t) => t.id !== id);
        const activeTaskId = s.activeTaskId === id ? (tasks[0]?.id ?? null) : s.activeTaskId;
        const next = { ...s, tasks, activeTaskId };
        persist(next);
        return next;
      }),

    archiveTask: (id) =>
      set((s) => {
        const tasks = s.tasks.map((t) => (t.id === id ? { ...t, archived: true } : t));
        const visible = tasks.filter((t) => !t.archived);
        const activeTaskId = s.activeTaskId === id ? (visible[0]?.id ?? null) : s.activeTaskId;
        const next = { ...s, tasks, activeTaskId };
        persist(next);
        return next;
      }),

    restoreTask: (id) =>
      set((s) => {
        const tasks = s.tasks.map((t) => (t.id === id ? { ...t, archived: false } : t));
        const next = { ...s, tasks };
        persist(next);
        return next;
      }),

    setActiveTask: (id) => set((s) => {
      const next = { ...s, activeTaskId: id };
      persist(next);
      return next;
    }),

    addRecord: (taskId, record) => {
      const id = uuid();
      set((s) => {
        const rec: GenRecord = { ...record, id, createdAt: Date.now() };
        const tasks = s.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const records = [rec, ...t.records];
          const title = rec.prompt ? rec.prompt.slice(0, 30) : t.title;
          const thumbnailUrl = rec.status === 'success' && rec.imageUrl
            ? `idb:${t.id}:thumb`
            : t.thumbnailUrl;
          return { ...t, records, title, thumbnailUrl, updatedAt: Date.now() };
        });

        // Save image to IDB
        if (record.imageUrl) {
          idbSet(id, record.imageUrl).catch(console.error);
          // Also save as task thumbnail
          const task = s.tasks.find((t) => t.id === taskId);
          if (task) {
            idbSet(`${taskId}:thumb`, record.imageUrl).catch(console.error);
          }
        }
        saveRecordBlobs(id, record);

        const next = { ...s, tasks };
        persist(next);
        return next;
      });
      return id;
    },

    updateSettings: (patch) =>
      set((s) => {
        const settings = normalizeSettings({ ...s.settings, ...patch });
        configureRateLimit(settings);
        const next = { ...s, settings };
        persist(next);
        return next;
      }),

    runGeneration: (taskId, provider, params) => {
      const protocol = protocolOf(provider.protocol);
      const spec = panelSpec(protocol, params.model, resolveModelCaps(provider, params.model), params.outputFormat ?? 'png');
      const qualityField = spec.fields.find((field) => field.key === 'quality');
      const allowedQuality = qualityField?.options?.map((option) => option.value) ?? [];
      const quality = !qualityField
        ? params.quality
        : (allowedQuality.includes(params.quality) ? params.quality : allowedQuality[0] ?? params.quality);
      const options = { ...(params.protocolOptions ?? {}) };
      for (const field of spec.fields) {
        if (field.kind !== 'select' || !field.options?.length) continue;
        if (field.key === 'quality' || field.key === 'outputFormat' || field.key === 'background') continue;
        if (options[field.key] == null || options[field.key] === '') options[field.key] = field.options[0].value;
      }
      const recordId = get().addRecord(taskId, {
        taskId,
        prompt: params.prompt,
        providerId: params.providerId,
        model: params.model,
        size: params.size,
        quality,
        outputFormat: params.outputFormat,
        background: params.background,
        outputCompression: params.outputCompression,
        referenceImages: params.referenceImages,
        maskImage: params.referenceImages?.length === 1 ? params.maskImage : undefined,
        protocolOptions: options,
        count: Math.min(9, Math.max(1, params.count ?? 1)),
        status: 'pending',
      });
      const count = Math.min(9, Math.max(1, params.count ?? 1));
      const sentRefs = spec.sendReferences ? (params.referenceImages ?? []).filter(Boolean).slice(0, spec.maxReferenceImages) : [];
      const partialImages = count === 1 && spec.allowPartials && get().settings.partialImages ? 3 : 0;
      // Not tied to the mounted panel, so switching tasks does not cancel it.
      generateImage(provider, {
        model: params.model,
        prompt: params.prompt,
        size: params.size,
        quality,
        outputFormat: params.outputFormat,
        background: params.background,
        outputCompression: params.outputCompression,
        referenceImages: sentRefs,
        maskImage: spec.allowMask && sentRefs.length === 1 ? params.maskImage : undefined,
        options,
        count,
        partialImages,
        onPartial: (url) => {
          set((s) => ({ partialPreviews: { ...s.partialPreviews, [recordId]: url } }));
        },
        onImage: async (index, url) => {
          if (!get().tasks.some((t) => t.id === taskId)) return;
          const marker = `idb:${recordId}:img:${index}`;
          const current = get().tasks.find((t) => t.id === taskId)?.records.find((r) => r.id === recordId);
          const entries: [string, string][] = [[`${recordId}:img:${index}`, url]];
          if (!current?.imageUrl) entries.push([recordId, url], [`${taskId}:thumb`, url]);
          await idbSetMany(entries);
          if (!get().tasks.some((t) => t.id === taskId)) return;
          set((s) => {
            const tasks = s.tasks.map((t) => {
              if (t.id !== taskId) return t;
              const records = t.records.map((r) => {
                if (r.id !== recordId || r.status !== 'pending') return r;
                const imageUrls = Array.from({ length: count }, (_, i) => r.imageUrls?.[i] ?? '');
                imageUrls[index] = marker;
                return { ...r, imageUrls, imageUrl: r.imageUrl || `idb:${recordId}` };
              });
              return {
                ...t,
                records,
                thumbnailUrl: t.thumbnailUrl || `idb:${taskId}:thumb`,
                updatedAt: Date.now(),
              };
            });
            const next = {
              ...s,
              tasks,
              imageCache: {
                ...s.imageCache,
                [`${recordId}:img:${index}`]: url,
                [recordId]: s.imageCache[recordId] || url,
                [`${taskId}:thumb`]: s.imageCache[`${taskId}:thumb`] || url,
              },
            };
            persist(next);
            return next;
          });
        },
      }).then(
        async (result) => {
          set((s) => {
            const partialPreviews = { ...s.partialPreviews };
            delete partialPreviews[recordId];
            return { partialPreviews };
          });
          if (!get().tasks.some((t) => t.id === taskId)) return;
          const saved = await saveGeneratedImages(taskId, recordId, result.imageUrls);
          set((s) => ({ imageCache: { ...s.imageCache, ...saved.cache } }));
          get().updateRecord(taskId, recordId, {
            status: 'success',
            imageUrl: saved.imageUrl,
            imageUrls: saved.imageUrls,
          });
          get().updateTaskMeta(taskId, {
            thumbnailUrl: saved.thumb,
            title: params.prompt.slice(0, 30) || get().tasks.find((t) => t.id === taskId)?.title,
          });
        },
        (err: { message?: string }) => {
          set((s) => {
            const partialPreviews = { ...s.partialPreviews };
            delete partialPreviews[recordId];
            return { partialPreviews };
          });
          if (!get().tasks.some((t) => t.id === taskId)) return;
          get().updateRecord(taskId, recordId, {
            status: 'failed',
            error: err?.message || '生成失败',
          });
        },
      );
      return recordId;
    },

    updateRecord: (taskId, recordId, updates) => {
      set((s) => {
        const tasks = s.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const records = t.records.map((r) => (r.id === recordId ? { ...r, ...updates } : r));
          const current = records.find((r) => r.id === recordId);
          let thumbnailUrl = t.thumbnailUrl;
          if (current?.status === 'success' && current.imageUrl) {
            thumbnailUrl = `idb:${t.id}:thumb`;
          }
          return { ...t, records, thumbnailUrl, updatedAt: Date.now() };
        });

        // Save image to IDB
        const urls = updates.imageUrls?.length ? updates.imageUrls : updates.imageUrl ? [updates.imageUrl] : [];
        urls.forEach((url, i) => {
          if (!url || url.startsWith('idb:')) return;
          idbSet(`${recordId}:img:${i}`, url).catch(console.error);
          if (i === 0) {
            idbSet(recordId, url).catch(console.error);
            idbSet(`${taskId}:thumb`, url).catch(console.error);
          }
        });

        const next = { ...s, tasks };
        persist(next);
        return next;
      });
    },

    updateTaskMeta: (taskId, updates) =>
      set((s) => {
        // If thumbnailUrl is a real data URL (from API), save to IDB
        if (updates.thumbnailUrl && !updates.thumbnailUrl.startsWith('idb:')) {
          idbSet(`${taskId}:thumb`, updates.thumbnailUrl).catch(console.error);
          updates = { ...updates, thumbnailUrl: `idb:${taskId}:thumb` };
        }
        const tasks = s.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
        const next = { ...s, tasks };
        persist(next);
        return next;
      }),

    loadImage: async (key: string) => {
      // Check cache first
      const cached = get().imageCache[key];
      if (cached) return cached;

      try {
        const url = await idbGet(key);
        if (url) {
          set((s) => ({ imageCache: { ...s.imageCache, [key]: url } }));
          return url;
        }
      } catch {
        // IDB unavailable
      }
      return undefined;
    },
  };
});
