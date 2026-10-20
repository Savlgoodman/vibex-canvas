import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { AppSettings, Provider, Task, GenRecord, AgentRecordGroups } from '../types';
import { panelSpec, protocolOf } from '../protocols/registry';
import { resolveModelCaps } from '../services/modelCaps';
import { idbSet, idbSetMany, idbDelete } from '../services/idb';
import { generateImage } from '../services/api';
import { configureRateLimit, normalizeRateLimit } from '../services/rateLimit';
import { saveConfig, loadConfig, loadTasks, saveTasks, saveImage, deleteImage as bridgeDeleteImage, loadImage as bridgeLoadImage, listAgentRecords } from '../services/bridge';
import { hasBridge } from '../services/bridge';

function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  return {
    partialImages: raw?.partialImages ?? true,
    ...normalizeRateLimit(raw ?? undefined),
  };
}

const STORAGE_KEY = 'super-canvas-state';
const migratedImageKeys = new Set<string>();

function storageMarker(key: string) {
  return hasBridge() ? `store:${key}` : `idb:${key}`;
}

interface StoreState {
  providers: Provider[];
  tasks: Task[];
  activeTaskId: string | null;
  settings: AppSettings;
  /** In-memory cache of image URLs keyed by record ID, loaded from IDB on demand */
  imageCache: Record<string, string>;
  /** Latest streamed partial, keyed by record id. Not persisted. */
  partialPreviews: Record<string, string>;
  /** Generations made through the Skill, grouped by outputDir. Read-only view. */
  agentRecords: AgentRecordGroups;
  /** False until the first loadAgentRecords() settles. */
  agentRecordsLoaded: boolean;

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

  // Agent records (read-only view over the Worker's records.json)
  loadAgentRecords: () => Promise<void>;
}

/** Persist metadata only — strip image blobs, replace with IDB key markers */
function serializeTaskState(state: { tasks: Task[]; activeTaskId: string | null }) {
  const tasks = state.tasks.map((t) => ({
    ...t,
    thumbnailUrl: t.thumbnailUrl?.startsWith('file:')
      ? t.thumbnailUrl
      : t.thumbnailUrl
        ? storageMarker(`${t.id}:thumb`)
        : undefined,
    records: t.records.map((r) => ({
      ...r,
      imageUrl: r.imageUrl?.startsWith('file:')
        ? r.imageUrl
        : (r.imageUrl || r.imageUrls?.length) ? storageMarker(r.id) : undefined,
      imageUrls: r.imageUrls?.length
        ? r.imageUrls.map((url, i) => (
          url?.startsWith('file:') ? url : url ? storageMarker(`${r.id}:img:${i}`) : ''
        ))
        : undefined,
      referenceImage: r.referenceImage ? storageMarker(`${r.id}:ref`) : undefined,
      referenceImages: r.referenceImages?.length
        ? r.referenceImages.map((_, i) => storageMarker(`${r.id}:ref:${i}`))
        : undefined,
      maskImage: r.maskImage ? storageMarker(`${r.id}:mask`) : undefined,
    })),
  }));
  return { tasks, activeTaskId: state.activeTaskId };
}

function serializeConfig(state: { providers: Provider[]; settings?: AppSettings }) {
  return {
    providers: state.providers,
    defaultProviderId: state.providers.find((provider) => provider.isDefault)?.id ?? null,
    settings: normalizeSettings(state.settings),
  };
}

function serializeForStorage(state: { providers: Provider[]; tasks: Task[]; activeTaskId: string | null; settings?: AppSettings }) {
  return JSON.stringify({ ...serializeConfig(state), ...serializeTaskState(state) });
}

async function persist(state: StoreState, scope: 'config' | 'tasks' | 'all' = 'all') {
  if (hasBridge()) {
    try {
      if (scope === 'config' || scope === 'all') await saveConfig(serializeConfig(state));
      if (scope === 'tasks' || scope === 'all') await saveTasks(serializeTaskState(state));
    } catch {
      // bridge unavailable or failed
    }
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, serializeForStorage(state));
  } catch {
    console.warn('localStorage quota reached, trimming old data');
  }
}

async function saveGeneratedImages(taskId: string, recordId: string, urls: string[]) {
  if (hasBridge()) {
    // In bridge mode, Worker already saved images to disk.
    // Keep paths as file markers; the bridge resolves them through image.getImage.
    const markers = urls.map((url) => url ? `file:${url}` : '');
    return {
      imageUrl: markers[0] || undefined,
      imageUrls: markers,
      thumb: markers[0] || undefined,
      cache: {},
    };
  }

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

async function saveRecordBlobs(recordId: string, record: Omit<GenRecord, 'id' | 'createdAt'>) {
  const entries: [string, string][] = [];
  record.referenceImages?.forEach((img, i) => {
    if (img && !img.startsWith('idb:')) entries.push([`${recordId}:ref:${i}`, img]);
  });
  if (record.referenceImage && !record.referenceImage.startsWith('idb:')) {
    entries.push([`${recordId}:ref`, record.referenceImage]);
  }
  if (record.maskImage && !record.maskImage.startsWith('idb:')) {
    entries.push([`${recordId}:mask`, record.maskImage]);
  }
  if (!entries.length) return;
  if (hasBridge()) {
    await Promise.all(entries.map(([key, dataUrl]) => saveImage(key, dataUrl)));
    return;
  }
  await idbSetMany(entries);
}

function loadState(): Partial<{ providers: Provider[]; tasks: Task[]; activeTaskId: string | null; settings: AppSettings }> {
  // Bridge mode: initial load is async, handled by initFromBridge()
  // For sync init, fall through to localStorage
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

/** When running inside VibeX Host, load initial state from bridge. */
export async function initFromBridge() {
  if (!hasBridge()) return;
  try {
    const [data, taskData] = await Promise.all([loadConfig(), loadTasks()]);
    if (!data) return;
    const parsed = data as { providers?: Provider[]; tasks?: Task[]; activeTaskId?: string | null; settings?: AppSettings };
    if (Array.isArray(parsed.providers)) {
      parsed.providers = parsed.providers.map((p) => ({ ...p, protocol: protocolOf(p.protocol) }));
    }
    const rawTasks: Task[] = Array.isArray(taskData.tasks) && taskData.tasks.length > 0
      ? taskData.tasks as Task[]
      : (parsed.tasks ?? []);
    if (Array.isArray(rawTasks)) {
      parsed.tasks = rawTasks.map((t) => ({
        ...t,
        records: (t.records ?? []).map((r) => (
          r.status === 'pending' ? { ...r, status: 'failed', error: r.error || '生成已中断' } : r
        )),
      }));
    }
    const settings = normalizeSettings(parsed.settings);
    configureRateLimit(settings);
    useStore.setState({
      providers: parsed.providers ?? [],
      tasks: parsed.tasks ?? [],
      activeTaskId: taskData.activeTaskId ?? parsed.activeTaskId ?? null,
      settings,
    });
    if (Array.isArray(data.tasks) && data.tasks.length > 0 && taskData.tasks.length === 0) {
      void saveTasks({ tasks: parsed.tasks ?? [], activeTaskId: taskData.activeTaskId ?? parsed.activeTaskId ?? null });
      void saveConfig(serializeConfig({ providers: parsed.providers ?? [], settings }));
    }
  } catch {
    // Bridge failed
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
    agentRecords: {},
    agentRecordsLoaded: false,

    addProvider: (p) => {
      const id = uuid();
      set((s) => {
        const provider: Provider = { ...p, id };
        const providers = s.providers.length === 0
          ? [{ ...provider, isDefault: true }]
          : [...s.providers, provider];
        const next = { ...s, providers };
        void persist(next, 'config');
        return next;
      });
      return id;
    },

    updateProvider: (id, p) =>
      set((s) => {
        const providers = s.providers.map((x) => (x.id === id ? { ...x, ...p } : x));
        const next = { ...s, providers };
        void persist(next, 'config');
        return next;
      }),

    deleteProvider: (id) =>
      set((s) => {
        const providers = s.providers.filter((x) => x.id !== id);
        if (providers.length > 0 && !providers.some((x) => x.isDefault)) {
          providers[0].isDefault = true;
        }
        const next = { ...s, providers };
        void persist(next, 'config');
        return next;
      }),

    setDefaultProvider: (id) =>
      set((s) => {
        const providers = s.providers.map((x) => ({ ...x, isDefault: x.id === id }));
        const next = { ...s, providers };
        void persist(next, 'config');
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
        void persist(next, 'tasks');
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
            if (hasBridge()) {
              const markers = [r.imageUrl, ...(r.imageUrls ?? []), r.referenceImage, ...(r.referenceImages ?? []), r.maskImage].filter(Boolean) as string[];
              void Promise.all(markers.map((marker) => {
                if (marker.startsWith('file:')) return bridgeDeleteImage(marker);
                const key = marker.startsWith('store:') ? marker.slice(6) : marker.startsWith('idb:') ? marker.slice(4) : marker;
                return bridgeDeleteImage(key);
              })).catch(() => {});
            }
            idbDelete(r.id).catch(() => {});
            idbDelete(`${r.id}:ref`).catch(() => {});
            idbDelete(`${r.id}:mask`).catch(() => {});
            for (let i = 0; i < 16; i++) idbDelete(`${r.id}:ref:${i}`).catch(() => {});
          });
          idbDelete(`${id}:thumb`).catch(() => {});
          if (hasBridge()) void bridgeDeleteImage(`${id}:thumb`).catch(() => {});
        }
        const tasks = s.tasks.filter((t) => t.id !== id);
        const activeTaskId = s.activeTaskId === id ? (tasks[0]?.id ?? null) : s.activeTaskId;
        const next = { ...s, tasks, activeTaskId };
        void persist(next, 'tasks');
        return next;
      }),

    archiveTask: (id) =>
      set((s) => {
        const tasks = s.tasks.map((t) => (t.id === id ? { ...t, archived: true } : t));
        const visible = tasks.filter((t) => !t.archived);
        const activeTaskId = s.activeTaskId === id ? (visible[0]?.id ?? null) : s.activeTaskId;
        const next = { ...s, tasks, activeTaskId };
        void persist(next, 'tasks');
        return next;
      }),

    restoreTask: (id) =>
      set((s) => {
        const tasks = s.tasks.map((t) => (t.id === id ? { ...t, archived: false } : t));
        const next = { ...s, tasks };
        void persist(next, 'tasks');
        return next;
      }),

    setActiveTask: (id) => set((s) => {
      const next = { ...s, activeTaskId: id };
      void persist(next, 'tasks');
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
            ? storageMarker(`${t.id}:thumb`)
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
        void saveRecordBlobs(id, record).catch(console.error);

        const next = { ...s, tasks };
        void persist(next, 'tasks');
        return next;
      });
      return id;
    },

    updateSettings: (patch) =>
      set((s) => {
        const settings = normalizeSettings({ ...s.settings, ...patch });
        configureRateLimit(settings);
        const next = { ...s, settings };
        void persist(next, 'config');
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
          const marker = hasBridge() ? url : `idb:${recordId}:img:${index}`;
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
                return { ...r, imageUrls, imageUrl: r.imageUrl || (hasBridge() ? url : `idb:${recordId}`) };
              });
              return {
                ...t,
                records,
                thumbnailUrl: t.thumbnailUrl || (hasBridge() ? url : `idb:${taskId}:thumb`),
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
            if (!hasBridge()) void persist(next, 'tasks');
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
            thumbnailUrl = current.imageUrl.startsWith('file:')
              ? current.imageUrl
              : storageMarker(`${t.id}:thumb`);
          }
          return { ...t, records, thumbnailUrl, updatedAt: Date.now() };
        });

        // Save image to IDB
        const urls = updates.imageUrls?.length ? updates.imageUrls : updates.imageUrl ? [updates.imageUrl] : [];
        urls.forEach((url, i) => {
          if (!url || url.startsWith('idb:') || url.startsWith('store:') || url.startsWith('file:')) return;
          idbSet(`${recordId}:img:${i}`, url).catch(console.error);
          if (i === 0) {
            idbSet(recordId, url).catch(console.error);
            idbSet(`${taskId}:thumb`, url).catch(console.error);
          }
        });

        const next = { ...s, tasks };
        void persist(next, 'tasks');
        return next;
      });
    },

    updateTaskMeta: (taskId, updates) =>
      set((s) => {
        // If thumbnailUrl is a real data URL (from API), save to IDB
        if (
          updates.thumbnailUrl &&
          !updates.thumbnailUrl.startsWith('idb:') &&
          !updates.thumbnailUrl.startsWith('store:') &&
          !updates.thumbnailUrl.startsWith('file:')
        ) {
          if (hasBridge()) void saveImage(`${taskId}:thumb`, updates.thumbnailUrl).catch(console.error);
          else idbSet(`${taskId}:thumb`, updates.thumbnailUrl).catch(console.error);
          updates = { ...updates, thumbnailUrl: storageMarker(`${taskId}:thumb`) };
        }
        const tasks = s.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
        const next = { ...s, tasks };
        void persist(next, 'tasks');
        return next;
      }),

    loadImage: async (key: string) => {
      // Check cache first
      const cached = get().imageCache[key];
      if (cached) return cached;

      try {
        const url = await bridgeLoadImage(key);
        if (url) {
          if (hasBridge() && !key.startsWith('file:') && !migratedImageKeys.has(key)) {
            migratedImageKeys.add(key);
            void saveImage(key, url).catch(() => {});
          }
          set((s) => ({ imageCache: { ...s.imageCache, [key]: url } }));
          return url;
        }
      } catch (error) {
        console.error('[vibexCanvas] bridge image load failed', { key, error });
      }
      return undefined;
    },

    loadAgentRecords: async () => {
      try {
        const groups = await listAgentRecords();
        set({ agentRecords: groups ?? {}, agentRecordsLoaded: true });
      } catch (error) {
        console.error('[vibexCanvas] agent records load failed', error);
        set({ agentRecordsLoaded: true });
      }
    },
  };
});
