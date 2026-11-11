import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useStore } from '../../store/useStore';
import {
  BATCH_COUNTS,
  type ImageBackground,
  type OutputFormat,
} from '../../types';
import { useHasAlpha } from '../../hooks/useHasAlpha';
import { useImageUrl } from '../../hooks/useImageUrl';
import { resolveModelCaps } from '../../services/modelCaps';
import { panelSpec, protocolOf } from '../../protocols/registry';
import { ProtocolIcon } from '../ui/ProtocolIcon';
import { maskToOverlay } from '../../services/maskImage';
import { ImagePreview } from '../ui/ImagePreview';
import { SelectMenu } from '../ui/SelectMenu';
import { SizeField } from './SizeField';
import { MaskEditor } from './MaskEditor';
import { Tooltip } from '../ui/Tooltip';
import { RichPromptField } from './RichPromptField';
import { PromptEditorModal } from './PromptEditorModal';
import { hashImageDataUrl } from '../../services/imageHash';
import { parsePrompt, serializePromptToAPI, hasUnresolvedRefs, removeComment as removeCommentSeg, buildPromptText } from '../../services/promptSerialization';

interface Props {
  initialPrompt: string;
  initialReferenceImages?: string[];
  initialMask?: string;
  refAppend?: { n: number; url: string } | null;
  onRecordCreated?: (recordId: string) => void;
}

export function ParamsPanel({ initialPrompt, initialReferenceImages, initialMask, refAppend, onRecordCreated }: Props) {
  const tasks = useStore((s) => s.tasks);
  const providers = useStore((s) => s.providers);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const updateTaskMeta = useStore((s) => s.updateTaskMeta);
  const runGeneration = useStore((s) => s.runGeneration);
  const loadImage = useStore((s) => s.loadImage);
  const collapseSetting = useStore((s) => s.settings.collapseAdvancedParams);

  const task = tasks.find((t) => t.id === activeTaskId);
  const rawProvider = providers.find((p) => p.id === task?.providerId);
  const provider = rawProvider ?? providers.find((p) => p.isDefault) ?? providers[0];
  const providerModels = provider?.models ?? [];
  const caps = resolveModelCaps(provider, task?.model ?? '');
  const protocol = protocolOf(provider?.protocol);

  if (task && !rawProvider && provider) {
    updateTaskMeta(task.id, {
      providerId: provider.id,
      model: provider.models[0] ?? task.model,
    });
  }

  const [prompt, setPrompt] = useState(initialPrompt);
  const fileRef = useRef<HTMLInputElement>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>(initialReferenceImages ?? []);
  const [maskImage, setMaskImage] = useState<string | undefined>(initialMask);
  const resolvedMask = useImageUrl(maskImage);
  const [maskOverlay, setMaskOverlay] = useState<string | undefined>();
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | undefined>(undefined);
  const [formatNote, setFormatNote] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(!collapseSetting);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const resolvedRefs = useResolvedList(referenceImages, loadImage);

  // Hash computation for reference images
  const [refHashes, setRefHashes] = useState<string[]>([]);
  const hashCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setPrompt(initialPrompt);
    setReferenceImages(initialReferenceImages ?? []);
    setMaskImage(initialMask);
    setPreviewSrc(undefined);
  }, [task?.id, initialPrompt, initialReferenceImages?.join('|'), initialMask]);

  // Recompute hashes when resolved refs change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hashes: string[] = [];
      for (const url of resolvedRefs) {
        const cached = hashCacheRef.current.get(url);
        if (cached) { hashes.push(cached); continue; }
        try {
          const h = await hashImageDataUrl(url);
          hashCacheRef.current.set(url, h);
          hashes.push(h);
        } catch {
          hashes.push('');
        }
      }
      if (!cancelled) setRefHashes(hashes);
    })();
    return () => { cancelled = true; };
  }, [resolvedRefs.join(',')]);

  const maskRef = useRef(maskImage);
  maskRef.current = maskImage;
  useEffect(() => {
    if (!refAppend || maskRef.current) return;
    setReferenceImages((prev) => [...prev, refAppend.url]);
  }, [refAppend]);

  useEffect(() => {
    if (!resolvedMask) {
      setMaskOverlay(undefined);
      return;
    }
    let cancelled = false;
    maskToOverlay(resolvedMask).then((url) => {
      if (!cancelled) setMaskOverlay(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [resolvedMask]);

  useEffect(() => {
    if (!task || protocol !== 'gpt') return;
    if (!caps.extendedQuality && (task.quality === 'xhigh' || task.quality === 'max')) {
      updateTaskMeta(task.id, { quality: 'high' });
    }
    if (!caps.transparent && task.background === 'transparent') {
      updateTaskMeta(task.id, { background: 'auto' });
    }
  }, [task?.id, task?.model, protocol, caps.extendedQuality, caps.transparent]);

  useEffect(() => {
    if (!formatNote) return;
    const timer = window.setTimeout(() => setFormatNote(''), 2600);
    return () => window.clearTimeout(timer);
  }, [formatNote]);

  if (!task) {
    return (
      <div className="params-panel params-empty">
        <div className="params-empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <p>创建一个任务开始使用</p>
      </div>
    );
  }

  const generating = task.records.some((r) => r.status === 'pending');
  const format = task.outputFormat ?? 'png';
  const background = task.background ?? 'auto';
  const spec = panelSpec(protocol, task.model, caps, format);
  const transparent = background === 'transparent' && caps.transparent;
  const maskLocked = !!maskImage && spec.allowMask;
  const canAddRefs = spec.sendReferences && resolvedRefs.length < spec.maxReferenceImages && !maskLocked;

  // Check for unresolved @ refs
  const hasUnresolved = hasUnresolvedRefs(parsePrompt(prompt), refHashes);

  const fieldValue = (key: string) => {
    if (key === 'quality') {
      const allowed = spec.fields.find((field) => field.key === 'quality')?.options?.map((option) => option.value) ?? [];
      return allowed.includes(task.quality) ? task.quality : (allowed[0] ?? task.quality);
    }
    if (key === 'outputFormat') return format;
    if (key === 'background') return background;
    const stored = task.protocolOptions?.[key];
    if (stored != null && stored !== '') return String(stored);
    return spec.fields.find((field) => field.key === key)?.options?.[0]?.value ?? '';
  };

  const setField = (key: string, next: string) => {
    if (key === 'quality') {
      updateTaskMeta(task.id, { quality: next });
      return;
    }
    if (key === 'outputFormat') {
      if (transparent && next === 'jpeg') {
        setFormatNote('透明背景仅支持 PNG 和 WebP');
        return;
      }
      updateTaskMeta(task.id, { outputFormat: next as OutputFormat });
      return;
    }
    if (key === 'background') {
      if (next === 'transparent' && format === 'jpeg') {
        updateTaskMeta(task.id, { background: 'transparent', outputFormat: 'png' });
        setFormatNote('透明背景仅支持 PNG 和 WebP，已切换为 PNG');
        return;
      }
      updateTaskMeta(task.id, { background: next as ImageBackground });
      return;
    }
    updateTaskMeta(task.id, { protocolOptions: { ...task.protocolOptions, [key]: next } });
  };

  const handleGenerate = () => {
    if (!provider || generating || hasUnresolved) return;
    const images = resolvedRefs.length
      ? resolvedRefs
      : referenceImages.filter((img) => !img.startsWith('idb:') && !img.startsWith('store:') && !img.startsWith('file:'));
    // Serialize prompt: strip markers, resolve @ refs and comments
    const serializedPrompt = serializePromptToAPI(parsePrompt(prompt), refHashes);
    const recordId = runGeneration(task.id, provider, {
      prompt: serializedPrompt,
      providerId: task.providerId,
      model: task.model,
      size: task.size,
      quality: task.quality,
      outputFormat: format,
      background: transparent ? 'transparent' : background,
      outputCompression: format === 'png' ? undefined : (task.outputCompression ?? 80),
      referenceImages: images,
      maskImage: images.length === 1 ? maskImage : undefined,
      protocolOptions: task.protocolOptions,
      count: task.imageCount ?? 1,
    });
    onRecordCreated?.(recordId);
  };

  const addFiles = (files: FileList | File[]) => {
    if (maskLocked) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setReferenceImages((prev) => [...prev, url]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setReferenceImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length !== 1) setMaskImage(undefined);
      return next;
    });
  };

  const reorderRefs = useCallback((next: string[]) => {
    setReferenceImages(next);
  }, []);

  const setTransparent = (on: boolean) => {
    if (!caps.transparent) return;
    if (on) {
      updateTaskMeta(task.id, {
        background: 'transparent',
        outputFormat: format === 'jpeg' ? 'png' : format,
      });
      if (format === 'jpeg') setFormatNote('透明背景仅支持 PNG 和 WebP，已切换为 PNG');
      return;
    }
    updateTaskMeta(task.id, { background: 'auto' });
  };

  // Ref tile drag handlers
  const handleRefDragStart = (e: React.DragEvent, index: number) => {
    setDragIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleRefDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIdx(index);
  };
  const handleRefDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === index) return;
    setReferenceImages((prev) => {
      const next = [...prev];
      const [item] = next.splice(dragIdx, 1);
      next.splice(index, 0, item);
      return next;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleRefDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="params-panel">
      <div className="params-scroll">
      <div className="param-group">
        <div className="param-label-row">
          <label className="param-label">提示词</label>
          <button
            type="button"
            className="param-expand-btn"
            onClick={() => setPromptEditorOpen(true)}
            title="高级提示词编辑"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
        </div>
        <RichPromptField
          value={prompt}
          onChange={setPrompt}
          refHashes={refHashes}
          onRefClick={(hash) => {
            const idx = refHashes.indexOf(hash);
            if (idx >= 0) setPreviewSrc(resolvedRefs[idx]);
          }}
          onCommentClick={(hash) => {
            const idx = refHashes.indexOf(hash);
            if (idx >= 0) {
              setPromptEditorOpen(true);
            }
          }}
          onCommentDelete={(hash) => {
            const segments = parsePrompt(prompt);
            setPrompt(buildPromptText(removeCommentSeg(segments, hash)));
          }}
          placeholder="描述你想生成的图片..."
        />
      </div>

      <div className="param-group">
        <label className="param-label">供应商</label>
        <SelectMenu
          value={task.providerId}
          options={providers.map((p) => ({
            value: p.id,
            label: p.name,
            icon: <ProtocolIcon protocol={protocolOf(p.protocol)} />,
          }))}
          onChange={(providerId) => {
            const p = providers.find((x) => x.id === providerId);
            const keep = p?.models.includes(task.model);
            updateTaskMeta(task.id, {
              providerId,
              model: keep ? task.model : (p?.models[0] ?? task.model),
            });
          }}
        />
      </div>
      <div className="param-group">
        <label className="param-label">模型</label>
        <SelectMenu
          value={task.model}
          options={(providerModels.length ? providerModels : [task.model]).map((m) => ({ value: m, label: m }))}
          onChange={(model) => updateTaskMeta(task.id, { model })}
        />
      </div>

      {/* Advanced parameters (collapsible) */}
      {!advancedOpen && (
        <div className="advanced-fade">
          <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
            展开更多高级参数
          </button>
        </div>
      )}
      <div className={`advanced-params ${advancedOpen ? '' : 'is-collapsed'}`}>
        <div className="param-fields">
          {spec.fields.filter((field) => field.visible && field.kind !== 'check' && field.kind !== 'range').map((field) => (
            <div className="param-group" key={field.key}>
              <label className="param-label">{field.label}</label>
              {field.kind === 'size' ? (
                <SizeField value={task.size} onChange={(size) => updateTaskMeta(task.id, { size })} />
              ) : (
                <SelectMenu
                  value={fieldValue(field.key)}
                  options={field.options ?? []}
                  onChange={(next) => setField(field.key, next)}
                />
              )}
            </div>
          ))}
          <div className="param-group">
            <label className="param-label">数量</label>
            <SelectMenu
              value={String(task.imageCount ?? 1)}
              options={BATCH_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(count) => updateTaskMeta(task.id, { imageCount: Number(count) })}
            />
          </div>
        </div>
        {spec.fields.filter((field) => field.visible && field.kind === 'check').map((field) => (
          <label className="param-check" key={field.key}>
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            {field.label}
            {field.hint && <span className="param-optional">{field.hint}</span>}
          </label>
        ))}
        {spec.fields.filter((field) => field.visible && field.kind === 'range').map((field) => (
          <div className="param-group" key={field.key}>
            <label className="param-label">压缩 <span className="param-optional">{task.outputCompression ?? 80}</span></label>
            <input
              className="param-range"
              type="range"
              min={0}
              max={100}
              value={task.outputCompression ?? 80}
              onChange={(e) => updateTaskMeta(task.id, { outputCompression: Number(e.target.value) })}
            />
          </div>
        ))}
        {advancedOpen && (
          <button type="button" className="advanced-toggle advanced-toggle-up" onClick={() => setAdvancedOpen(false)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 15l-6-6-6 6" />
            </svg>
            收起高级参数
          </button>
        )}
      </div>

      {spec.refNote && protocol === 'gpt' && <p className="param-hint">{spec.refNote}</p>}
      {formatNote && <div className="param-bubble">{formatNote}</div>}

      <div className="param-group">
        <label className="param-label">
          参考图 <span className="param-optional">{spec.sendReferences ? (spec.maxReferenceImages > 1 ? `最多 ${spec.maxReferenceImages} 张` : '可选') : '本次不发送'}</span>
        </label>
        <div
          className={`param-ref-grid ${resolvedRefs.length ? 'has-image' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            // Only accept file drops from outside (not ref reorder)
            if (e.dataTransfer.types.includes('Files')) return;
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes('Files') && canAddRefs) {
              addFiles(e.dataTransfer.files);
            }
          }}
        >
          {resolvedRefs.map((url, index) => (
            <div
              key={`${index}-${url.slice(0, 32)}`}
              draggable
              onDragStart={(e) => handleRefDragStart(e, index)}
              onDragOver={(e) => handleRefDragOver(e, index)}
              onDrop={(e) => handleRefDrop(e, index)}
              onDragEnd={handleRefDragEnd}
              className={`param-ref-drag-wrapper ${dragIdx === index ? 'dragging' : ''} ${dragOverIdx === index ? 'drag-over' : ''}`}
            >
              <RefTile url={url} index={index} onOpen={() => setPreviewSrc(url)}>
                {index === 0 && maskOverlay && <img src={maskOverlay} alt="" className="param-ref-mask-overlay" />}
                {spec.allowMask && resolvedRefs.length === 1 && (
                  <Tooltip content={maskImage ? '编辑遮罩' : '添加遮罩'}>
                    <button
                      type="button"
                      className="param-ref-tool param-ref-mask-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMaskEditorOpen(true);
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 19l7-7 2 2-7 7-2 0 0-2z" />
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="移除参考图">
                  <button
                    type="button"
                    className="param-ref-tool param-ref-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(index);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </Tooltip>
              </RefTile>
            </div>
          ))}
          {canAddRefs && (
            <button type="button" className="param-ref-add" onClick={() => fileRef.current?.click()}>
              {resolvedRefs.length ? '添加参考图' : '拖拽图片或点击上传'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {spec.refNote && protocol !== 'gpt' && <p className="param-hint">{spec.refNote}</p>}
        {maskImage && (
          <button type="button" className="param-ref-clear" onClick={() => setMaskImage(undefined)}>
            删除遮罩
          </button>
        )}
      </div>

      </div>

      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={generating || !prompt.trim() || !provider || hasUnresolved}
      >
        {hasUnresolved ? '请先处理已删除的引用' : generating ? (
          <span className="generate-loading">
            <span className="spinner spinner-light" />
            生成中...
          </span>
        ) : (
          <>生成</>
        )}
      </button>

      {previewSrc && (
        <ImagePreview imageMarker={previewSrc} onClose={() => setPreviewSrc(undefined)} />
      )}
      {maskEditorOpen && resolvedRefs[0] && (
        <MaskEditor
          imageUrl={resolvedRefs[0]}
          initialMask={resolvedMask}
          onClose={() => setMaskEditorOpen(false)}
          onSave={(url) => {
            setMaskImage(url);
            setMaskEditorOpen(false);
          }}
        />
      )}
      {promptEditorOpen && (
        <PromptEditorModal
          open={promptEditorOpen}
          onClose={() => setPromptEditorOpen(false)}
          prompt={prompt}
          onPromptChange={setPrompt}
          resolvedRefs={resolvedRefs}
          refMarkers={referenceImages}
          onReorderRefs={reorderRefs}
          refHashes={refHashes}
          onDeleteRef={removeImage}
          onMaskRef={() => setMaskEditorOpen(true)}
        />
      )}
    </div>
  );
}

function RefTile({ url, index, onOpen, children }: {
  url: string;
  index: number;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const hasAlpha = useHasAlpha(url);
  return (
    <div className={`param-ref-tile ${hasAlpha ? 'checkerboard' : ''}`} onClick={onOpen}>
      <img src={url} alt={`参考图 ${index + 1}`} className="param-ref-preview" />
      {children}
    </div>
  );
}

function useResolvedList(markers: string[], loadImage: (key: string) => Promise<string | undefined>): string[] {
  const cache = useStore((s) => s.imageCache);
  const [urls, setUrls] = useState<string[]>([]);
  const key = markers.join('\n');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: string[] = [];
      for (const marker of markers) {
        if (!marker) continue;
        if (!marker.startsWith('idb:') && !marker.startsWith('store:') && !marker.startsWith('file:')) {
          out.push(marker);
          continue;
        }
        const id = marker.startsWith('idb:') ? marker.slice(4) : marker.startsWith('store:') ? marker.slice(6) : marker;
        out.push(cache[id] || (await loadImage(id)) || '');
      }
      if (!cancelled) setUrls(out.filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [key, cache, loadImage]);

  return urls;
}
