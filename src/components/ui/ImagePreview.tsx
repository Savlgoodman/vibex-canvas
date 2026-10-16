import { useEffect, useRef, useState, useCallback } from 'react';
import { useImageUrl } from '../../hooks/useImageUrl';
import { AlphaImage } from './AlphaImage';
import './ImagePreview.css';

interface Props {
  imageMarker: string | undefined;
  onClose: () => void;
  onAddToReference?: () => void;
}

export function ImagePreview({ imageMarker, onClose, onAddToReference }: Props) {
  const url = useImageUrl(imageMarker);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const hasDragged = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.max(0.1, Math.min(10, prev + delta)));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    hasDragged.current = false;
    setDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.x - position.x;
    const dy = e.clientY - dragStart.y - position.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setDragging(false);
    // If no drag happened, treat as click-to-close
    if (!hasDragged.current) onClose();
  };

  const handleMouseLeave = () => setDragging(false);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  if (!url) return null;

  return (
    <div className="image-preview-overlay" onClick={onClose}>
      <div
        className="image-preview-container"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <AlphaImage
          src={url}
          alt="预览"
          className="image-preview-img"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
          draggable={false}
        />
        <div className="image-preview-toolbar" onClick={(e) => e.stopPropagation()}>
          <div className="image-preview-zoom">
            <button onClick={() => setScale((s) => Math.max(0.1, s - 0.2))}>−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => Math.min(10, s + 0.2))}>+</button>
            <button onClick={handleDoubleClick} title="重置">↺</button>
          </div>
          {onAddToReference && (
            <button className="image-preview-ref-btn" onClick={onAddToReference}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
              添加到参考图
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
