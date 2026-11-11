import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '../../store/useStore';
import { useImageUrl } from '../../hooks/useImageUrl';
import { downloadImage, downloadImages } from '../../services/download';
import { AlphaImage } from '../ui/AlphaImage';
import { ImagePreview } from '../ui/ImagePreview';

interface Props {
  imageMarkers?: string[];
  currentError: string | undefined;
  generating?: boolean;
  pendingCount?: number;
  partialUrl?: string;
  onSelectRecord: (recordId: string) => void;
  selectedRecordId: string | null;
  onAddToReference: (imageUrl: string) => void;
  referenceMarker?: string;
}

export function OutputPanel({ imageMarkers = [], currentError, generating, pendingCount, partialUrl, onSelectRecord, selectedRecordId, onAddToReference, referenceMarker }: Props) {
  const loadImage = useStore((s) => s.loadImage);
  const tasks = useStore((s) => s.tasks);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const task = tasks.find((t) => t.id === activeTaskId);
  const records = task?.records ?? [];
  const [previewMarker, setPreviewMarker] = useState<string | undefined>(undefined);
  const [comparing, setComparing] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const currentImageMarker = imageMarkers[0];
  const readyMarkers = imageMarkers.filter(Boolean);
  const canCompare = readyMarkers.length === 1 && !!referenceMarker && !generating;
  const slots = generating ? Math.min(9, Math.max(readyMarkers.length, pendingCount ?? 1, 1)) : readyMarkers.length;
  const showBoard = imageMarkers.length > 0 || Boolean(generating);
  const boardClass = comparing ? 'compare' : slots > 1 ? 'gallery' : 'single';
  const gallery = galleryShape(slots);

  useEffect(() => {
    if (!canCompare) setComparing(false);
  }, [canCompare, selectedRecordId]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !selectedRecordId) return;
    const el = strip.querySelector(`[data-record-id="${selectedRecordId}"]`) as HTMLElement | null;
    if (!el) return;
    const stripRect = strip.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.left < stripRect.left) {
      strip.scrollLeft -= stripRect.left - elRect.left;
    } else if (elRect.right > stripRect.right) {
      strip.scrollLeft += elRect.right - stripRect.right;
    }
  }, [selectedRecordId, records.length]);

  if (!task) return null;

  const resolveMarker = async (marker: string) => {
    if (marker.startsWith('idb:')) return loadImage(marker.slice(4));
    if (marker.startsWith('store:')) return loadImage(marker.slice(6));
    if (marker.startsWith('file:')) return loadImage(marker);
    return marker;
  };

  const downloadMarker = async (marker: string, name: string) => {
    const url = await resolveMarker(marker);
    if (url) downloadImage(url, name.includes('.') ? name : `${name}.${url.startsWith('data:image/jpeg') ? 'jpg' : url.startsWith('data:image/webp') ? 'webp' : 'png'}`);
  };

  const downloadDisplayed = async () => {
    const urls: string[] = [];
    for (const marker of imageMarkers.filter(Boolean)) {
      const url = await resolveMarker(marker);
      if (url) urls.push(url);
    }
    if (urls.length) await downloadImages(urls, 'super-canvas');
  };

  return (
    <div className="output-panel">
      <div className="output-toolbar">
        {canCompare && (
          <button
            type="button"
            className={`output-download-all ${comparing ? 'active' : ''}`}
            onClick={() => setComparing((v) => !v)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="18" />
              <rect x="14" y="3" width="7" height="18" />
            </svg>
            {comparing ? '退出对比' : '对比原图'}
          </button>
        )}
        <button
          type="button"
          className="output-download-all"
          disabled={!readyMarkers.length}
          onClick={downloadDisplayed}
        >
          全部下载
        </button>
      </div>
      <div className="output-preview">
        {showBoard ? (
          <div
            className={`output-board ${boardClass}`}
            style={boardClass === 'gallery' ? {
              '--board-cols': String(gallery.cols),
              '--board-rows': String(gallery.rows),
            } as CSSProperties : undefined}
          >
            {comparing && referenceMarker && currentImageMarker ? (
              <>
                <ResultTile
                  label="原图"
                  marker={referenceMarker}
                  onOpen={setPreviewMarker}
                  onDownload={() => downloadMarker(referenceMarker, 'super-canvas-original')}
                  onAddToReference={() => onAddToReference(referenceMarker)}
                />
                <ResultTile
                  label="当前"
                  marker={currentImageMarker}
                  onOpen={setPreviewMarker}
                  onDownload={() => downloadMarker(currentImageMarker, 'super-canvas')}
                  onAddToReference={() => onAddToReference(currentImageMarker)}
                />
              </>
            ) : generating ? (
              Array.from({ length: slots }, (_, index) => {
                const marker = imageMarkers[index];
                if (marker) {
                  return (
                    <ResultTile
                      key={marker}
                      marker={marker}
                      onOpen={setPreviewMarker}
                      onDownload={() => downloadMarker(marker, `super-canvas-${index + 1}`)}
                      onAddToReference={() => onAddToReference(marker)}
                    />
                  );
                }
                if (index === 0 && partialUrl) {
                  return <ResultTile key="partial" marker={partialUrl} badge="生成中" onOpen={setPreviewMarker} />;
                }
                return <PendingTile key={`pending-${index}`} index={index} total={slots} />;
              })
            ) : readyMarkers.length > 0 ? (
              readyMarkers.map((marker, index) => (
                <ResultTile
                  key={`${marker}-${index}`}
                  marker={marker}
                  onOpen={setPreviewMarker}
                  onDownload={() => downloadMarker(marker, `super-canvas-${index + 1}`)}
                  onAddToReference={() => onAddToReference(marker)}
                />
              ))
            ) : null}
          </div>
        ) : currentError ? (
          <div className="output-error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span className="output-error-text">{currentError}</span>
          </div>
        ) : (
          <div className="output-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span>生成的图片会显示在这里</span>
          </div>
        )}
      </div>

      {records.length > 0 && (
        <div className="output-history">
          <div className="output-history-label">历史记录</div>
          <div className="history-strip" ref={stripRef}>
            {records.map((rec) => (
              <HistoryItem
                key={rec.id}
                record={rec}
                selected={rec.id === selectedRecordId}
                onSelect={() => onSelectRecord(rec.id)}
              />
            ))}
          </div>
        </div>
      )}

      {previewMarker && (
        <ImagePreview
          imageMarker={previewMarker}
          onClose={() => setPreviewMarker(undefined)}
          onAddToReference={() => {
            onAddToReference(previewMarker);
            setPreviewMarker(undefined);
          }}
        />
      )}
    </div>
  );
}

function PendingTile({ index, total }: { index: number; total: number }) {
  const label = total > 1 ? `第 ${index + 1} 张` : '生成中...';
  return (
    <div className="output-tile output-tile-pending" aria-label={total > 1 ? `${label}生成中` : '生成中'}>
      <div className="output-tile-stage output-slot-pending">
        <div className="spinner" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function galleryShape(count: number) {
  if (count <= 2) return { cols: Math.max(1, count), rows: 1 };
  return { cols: 3, rows: Math.min(3, Math.ceil(count / 3)) };
}

function ResultTile({ marker, label, badge, onOpen, onDownload, onAddToReference }: {
  marker: string;
  label?: string;
  badge?: string;
  onOpen: (marker: string) => void;
  onDownload?: () => void;
  onAddToReference?: () => void;
}) {
  const url = useImageUrl(marker);
  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const hasActions = Boolean(onDownload && onAddToReference);

  useEffect(() => {
    setNatural(null);
    setBox(null);
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !natural) return;
    const fit = () => {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (!sw || !sh) return;
      const scale = Math.min(sw / natural.w, sh / natural.h);
      const w = natural.w * scale;
      const h = natural.h * scale;
      setBox((prev) => (prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [natural]);

  return (
    <div className="output-tile" onClick={() => onOpen(marker)}>
      {label && <div className="output-tile-label">{label}</div>}
      <div className="output-tile-stage" ref={stageRef}>
        {url && (
          <div className={`output-tile-shot ${box ? 'sized' : ''}`} style={box ? { width: box.w, height: box.h } : undefined}>
            <AlphaImage src={url} alt={label || '生成结果'} draggable={false} />
            {hasActions && (
              <div className="output-tile-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="output-tile-btn" title="放大" aria-label="放大" onClick={() => onOpen(marker)}>
                  <ExpandIcon />
                  <span>放大</span>
                </button>
                <button type="button" className="output-tile-btn" title="下载" aria-label="下载" onClick={onDownload}>
                  <DownloadIcon />
                  <span>下载</span>
                </button>
                <button type="button" className="output-tile-btn" title="添加到参考图" aria-label="添加到参考图" onClick={onAddToReference}>
                  <PlusIcon />
                  <span>添加到参考图</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {badge && <div className="output-partial-badge">{badge}</div>}
    </div>
  );
}

function HistoryItem({ record, selected, onSelect }: {
  record: { id: string; status: string; imageUrl?: string; imageUrls?: string[]; count?: number };
  selected: boolean;
  onSelect: () => void;
}) {
  const imageUrl = useImageUrl(record.imageUrl);
  const missing = record.status !== 'failed' && Boolean(record.imageUrl) && !imageUrl;
  const count = record.imageUrls?.length || record.count || (record.imageUrl ? 1 : 0);

  return (
    <div
      className={`history-item ${selected ? 'selected' : ''} ${count > 1 ? 'stacked' : ''}`}
      data-record-id={record.id}
      onClick={onSelect}
    >
      {imageUrl && record.status !== 'failed' ? (
        <AlphaImage src={imageUrl} alt="" className="history-thumb" small />
      ) : record.status === 'failed' ? (
        <div className="history-fail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      ) : missing ? (
        <div className="history-missing" title="图片已丢失或删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <line x1="4" y1="4" x2="20" y2="20" />
          </svg>
        </div>
      ) : (
        <div className="history-pending">
          <div className="spinner" />
        </div>
      )}
      {count > 1 && <span className="history-count">{count}</span>}
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
