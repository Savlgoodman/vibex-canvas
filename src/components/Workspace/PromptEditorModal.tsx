import { useState, useRef, useCallback, useEffect } from 'react';
import { useBackdropDismiss } from '../ui/useBackdropDismiss';
import { AnnotationLayer, type ImageAnnotationPoint } from './AnnotationLayer';
import { RichPromptField } from './RichPromptField';
import {
  parsePrompt, buildPromptText, insertComment, removeComment,
} from '../../services/promptSerialization';
import './PromptEditorModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  resolvedRefs: string[];        // resolved data URLs
  refMarkers: string[];          // original markers (for reordering)
  onReorderRefs: (nextMarkers: string[]) => void;
  refHashes: string[];           // SHA hashes in order
  onDeleteRef: (index: number) => void;
  onMaskRef?: (index: number) => void;
}

interface CommentSet {
  [hash: string]: ImageAnnotationPoint[];
}

/** Read comment pins back out of the prompt wire format. */
function parseCommentsFromPrompt(prompt: string): CommentSet {
  const result: CommentSet = {};
  for (const seg of parsePrompt(prompt)) {
    if (seg.kind !== 'comment') continue;
    result[seg.hash] = seg.lines
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line, i) => {
        const m = line.match(/\(x:\s*([\d.]+)%,\s*y:\s*([\d.]+)%\)\s*(.*)/);
        return m
          ? { id: `${seg.hash}-${i}`, x: parseFloat(m[1]) / 100, y: parseFloat(m[2]) / 100, text: m[3] }
          : { id: `${seg.hash}-${i}`, x: 0.5, y: 0.5, text: line };
      });
  }
  return result;
}

export function PromptEditorModal({
  open, onClose, prompt, onPromptChange,
  resolvedRefs, refMarkers, onReorderRefs, refHashes, onDeleteRef, onMaskRef,
}: Props) {
  const dismiss = useBackdropDismiss(onClose);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refAreaCollapsed, setRefAreaCollapsed] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);

  // Pins live in local state so a freshly placed (still empty) pin survives.
  // The prompt string only ever holds pins that have text.
  const [pinsByHash, setPinsByHash] = useState<CommentSet>(() => parseCommentsFromPrompt(prompt));
  const lastEmittedPrompt = useRef(prompt);

  useEffect(() => {
    if (prompt === lastEmittedPrompt.current) return;
    lastEmittedPrompt.current = prompt;
    setPinsByHash(parseCommentsFromPrompt(prompt));
  }, [prompt]);

  const currentHash = refHashes[selectedIndex] ?? '';
  const currentPins = currentHash ? (pinsByHash[currentHash] ?? []) : [];

  useEffect(() => {
    if (selectedIndex >= resolvedRefs.length) {
      setSelectedIndex(Math.max(0, resolvedRefs.length - 1));
    }
  }, [resolvedRefs.length, selectedIndex]);

  const goTo = useCallback((idx: number) => {
    setSelectedIndex(Math.max(0, Math.min(idx, resolvedRefs.length - 1)));
  }, [resolvedRefs.length]);

  // Write this image's pins into the prompt's comment block.
  const commitPins = useCallback((hash: string, pins: ImageAnnotationPoint[]) => {
    setPinsByHash((prev) => ({ ...prev, [hash]: pins }));
    const lines = pins
      .filter((p) => p.text.trim())
      .map((p, i) => `${i + 1}.(x: ${(p.x * 100).toFixed(1)}%, y: ${(p.y * 100).toFixed(1)}%) ${p.text.trim()}`)
      .join('\n');
    const segments = parsePrompt(prompt);
    const next = lines
      ? insertComment(segments, hash, lines)
      : removeComment(segments, hash);
    const text = buildPromptText(next);
    lastEmittedPrompt.current = text;
    onPromptChange(text);
  }, [prompt, onPromptChange]);

  const handleAnnotationsChange = useCallback((next: ImageAnnotationPoint[]) => {
    if (!currentHash) return;
    commitPins(currentHash, next);
  }, [currentHash, commitPins]);

  const handleCommentDelete = useCallback((hash: string) => {
    const segments = parsePrompt(prompt);
    const next = removeComment(segments, hash);
    onPromptChange(buildPromptText(next));
  }, [prompt, onPromptChange]);

  // Strip list drag reorder
  const handleStripDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }, []);
  const handleStripDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);
  const handleStripDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...refMarkers];
    const [item] = next.splice(dragIdx, 1);
    next.splice(idx, 0, item);
    onReorderRefs(next);
    // Adjust selection
    if (dragIdx === selectedIndex) setSelectedIndex(idx);
    else if (idx === selectedIndex) setSelectedIndex(dragIdx);
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, selectedIndex, refMarkers, onReorderRefs]);

  // Delete current image
  const handleDeleteCurrent = useCallback(() => {
    if (!resolvedRefs.length) return;
    onDeleteRef(selectedIndex);
  }, [resolvedRefs.length, selectedIndex, onDeleteRef]);

  if (!open) return null;

  return (
    <div className="pem-overlay" {...dismiss}>
      <div className="pem-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pem-header">
          <h2 className="pem-title">高级提示词编辑</h2>
          <button className="pem-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="pem-body">
          {/* Left: Reference viewer */}
          {!refAreaCollapsed && (
            <div className="pem-left">
              <div className="pem-image-area">
                {resolvedRefs.length > 0 ? (
                  <div className="pem-image-container">
                    <AnnotationLayer
                      key={currentHash || selectedIndex}
                      imageUrl={resolvedRefs[selectedIndex]}
                      annotations={currentPins}
                      editable={drawingMode}
                      onChange={handleAnnotationsChange}
                    />
                    {resolvedRefs.length > 1 && (
                      <>
                        <button
                          className="pem-nav-btn pem-nav-left"
                          onClick={(e) => { e.stopPropagation(); goTo(selectedIndex - 1); }}
                          disabled={selectedIndex === 0}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </button>
                        <button
                          className="pem-nav-btn pem-nav-right"
                          onClick={(e) => { e.stopPropagation(); goTo(selectedIndex + 1); }}
                          disabled={selectedIndex === resolvedRefs.length - 1}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="pem-image-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <span>无参考图</span>
                  </div>
                )}
                {/* Action buttons */}
                {resolvedRefs.length > 0 && (
                  <div className="pem-actions">
                    <button
                      className={`pem-action-btn ${drawingMode ? 'active' : ''}`}
                      onClick={() => setDrawingMode(!drawingMode)}
                      title={drawingMode ? '退出评论模式' : '进入评论模式'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      {drawingMode ? '退出评论' : '评论'}
                    </button>
                    {onMaskRef && (
                      <button className="pem-action-btn" onClick={() => onMaskRef(selectedIndex)} title="添加遮罩">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 19l7-7 2 2-7 7-2 2 0-2z" />
                          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                        </svg>
                        遮罩
                      </button>
                    )}
                    <button className="pem-action-btn pem-action-delete" onClick={handleDeleteCurrent} title="删除当前参考图">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                      删除
                    </button>
                  </div>
                )}
              </div>
              {/* Reference strip */}
              {resolvedRefs.length > 0 && (
                <div className="pem-strip">
                  {resolvedRefs.map((url, i) => (
                    <div
                      key={i}
                      className={`pem-strip-item ${i === selectedIndex ? 'active' : ''} ${dragOverIdx === i ? 'drag-over' : ''}`}
                      draggable
                      onClick={() => goTo(i)}
                      onDragStart={(e) => handleStripDragStart(e, i)}
                      onDragOver={(e) => handleStripDragOver(e, i)}
                      onDrop={(e) => handleStripDrop(e, i)}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    >
                      <img src={url} alt={`参考图 ${i + 1}`} draggable={false} />
                      <span className="pem-strip-label">Image {i + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Collapse toggle */}
          <button
            className="pem-collapse-toggle"
            onClick={() => setRefAreaCollapsed(!refAreaCollapsed)}
            title={refAreaCollapsed ? '展开参考图' : '收起参考图'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {refAreaCollapsed
                ? <path d="M9 18l6-6-6-6" />
                : <path d="M15 18l-6-6 6-6" />
              }
            </svg>
          </button>

          {/* Right: Prompt editor */}
          <div className="pem-right">
            <label className="pem-prompt-label">提示词</label>
            <RichPromptField
              value={prompt}
              onChange={onPromptChange}
              refHashes={refHashes}
              onRefClick={(hash) => {
                const idx = refHashes.indexOf(hash);
                if (idx >= 0) {
                  setRefAreaCollapsed(false);
                  goTo(idx);
                }
              }}
              onCommentClick={(hash) => {
                const idx = refHashes.indexOf(hash);
                if (idx >= 0) {
                  setRefAreaCollapsed(false);
                  goTo(idx);
                }
              }}
              onCommentDelete={handleCommentDelete}
              placeholder="描述你想生成的图片..."
              className="pem-prompt-field"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
