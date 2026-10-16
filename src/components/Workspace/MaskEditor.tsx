import { useEffect, useRef, useState } from 'react';
import './MaskEditor.css';

interface Props {
  imageUrl: string;
  initialMask?: string;
  onClose: () => void;
  onSave: (maskUrl: string) => void;
}

interface Point { x: number; y: number }

export function MaskEditor({ imageUrl, initialMask, onClose, onSave }: Props) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const tintRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const [tool, setTool] = useState<'pen' | 'brush'>('pen');
  const [brushSize, setBrushSize] = useState(28);
  const [points, setPoints] = useState<Point[]>([]);
  const [ready, setReady] = useState(false);
  const undoRef = useRef<ImageData[]>([]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const mask = document.createElement('canvas');
      mask.width = img.naturalWidth;
      mask.height = img.naturalHeight;
      maskRef.current = mask;
      const paint = () => {
        setReady(true);
        drawView(pointsRef.current);
      };
      if (!initialMask) {
        paint();
        return;
      }
      const overlay = new Image();
      overlay.onload = () => {
        const ctx = mask.getContext('2d');
        if (ctx) {
          ctx.drawImage(overlay, 0, 0, mask.width, mask.height);
          const frame = ctx.getImageData(0, 0, mask.width, mask.height);
          const painted = ctx.createImageData(mask.width, mask.height);
          for (let i = 0; i < frame.data.length; i += 4) {
            if (frame.data[i + 3] < 128) painted.data[i + 3] = 255;
          }
          ctx.clearRect(0, 0, mask.width, mask.height);
          ctx.putImageData(painted, 0, 0);
        }
        paint();
      };
      overlay.onerror = paint;
      overlay.src = initialMask;
    };
    img.src = imageUrl;
  }, [imageUrl, initialMask]);

  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    if (ready) drawView(points);
  }, [points, ready, tool]);

  const snapshot = () => {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !ctx) return;
    undoRef.current.push(ctx.getImageData(0, 0, mask.width, mask.height));
    if (undoRef.current.length > 20) undoRef.current.shift();
  };

  const drawView = (path: Point[]) => {
    const view = viewRef.current;
    const img = imgRef.current;
    const mask = maskRef.current;
    if (!view || !img || !mask) return;
    const maxW = Math.min(860, window.innerWidth - 80);
    const maxH = Math.min(640, window.innerHeight - 160);
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    view.width = Math.max(1, Math.round(img.naturalWidth * scale));
    view.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, view.width, view.height);
    // Tint only painted mask pixels. Doing this on the view canvas would replace the reference image.
    if (!tintRef.current) tintRef.current = document.createElement('canvas');
    const tint = tintRef.current;
    tint.width = view.width;
    tint.height = view.height;
    const tctx = tint.getContext('2d');
    if (tctx) {
      tctx.drawImage(mask, 0, 0, view.width, view.height);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
      tctx.fillRect(0, 0, tint.width, tint.height);
      ctx.drawImage(tint, 0, 0);
    }
    if (path.length) {
      const sx = view.width / img.naturalWidth;
      const sy = view.height / img.naturalHeight;
      ctx.strokeStyle = '#111827';
      ctx.fillStyle = '#111827';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      path.forEach((p, i) => {
        const x = p.x * sx;
        const y = p.y * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      path.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x * sx, p.y * sy, i === 0 ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };

  const toImagePoint = (e: React.PointerEvent): Point => {
    const view = viewRef.current!;
    const img = imgRef.current!;
    const rect = view.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * img.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * img.naturalHeight,
    };
  };

  const paintBrush = (p: Point) => {
    const mask = maskRef.current;
    const img = imgRef.current;
    const view = viewRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !img || !view || !ctx) return;
    const radius = (brushSize / 2) * (img.naturalWidth / view.getBoundingClientRect().width);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    drawView(pointsRef.current);
  };

  const commitPolygon = (path: Point[]) => {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !ctx || path.length < 3) return;
    snapshot();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    setPoints([]);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === 'brush') {
      snapshot();
      drawing.current = true;
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      paintBrush(toImagePoint(e));
      return;
    }
    const p = toImagePoint(e);
    const path = pointsRef.current;
    if (path.length >= 3) {
      const first = path[0];
      const view = viewRef.current!;
      const img = imgRef.current!;
      const threshold = 12 * (img.naturalWidth / view.getBoundingClientRect().width);
      const dx = p.x - first.x;
      const dy = p.y - first.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
        commitPolygon(path);
        return;
      }
    }
    setPoints([...path, p]);
  };

  const undo = () => {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    const prev = undoRef.current.pop();
    if (!mask || !ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    drawView(pointsRef.current);
  };

  const clear = () => {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !ctx) return;
    snapshot();
    ctx.clearRect(0, 0, mask.width, mask.height);
    setPoints([]);
    drawView([]);
  };

  const save = () => {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !ctx) return;
    if (pointsRef.current.length >= 3) commitPolygon(pointsRef.current);
    const painted = ctx.getImageData(0, 0, mask.width, mask.height);
    const out = document.createElement('canvas');
    out.width = mask.width;
    out.height = mask.height;
    const octx = out.getContext('2d');
    if (!octx) return;
    const frame = octx.createImageData(out.width, out.height);
    for (let i = 0; i < painted.data.length; i += 4) {
      const edited = painted.data[i + 3] > 0;
      frame.data[i] = 0;
      frame.data[i + 1] = 0;
      frame.data[i + 2] = 0;
      frame.data[i + 3] = edited ? 0 : 255;
    }
    octx.putImageData(frame, 0, 0);
    onSave(out.toDataURL('image/png'));
  };

  return (
    <div className="mask-editor-overlay" onClick={onClose}>
      <div className="mask-editor" onClick={(e) => e.stopPropagation()}>
        <div className="mask-editor-toolbar">
          <button type="button" className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')}>钢笔</button>
          <button type="button" className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>涂抹</button>
          {tool === 'brush' && (
            <label className="mask-brush-size">
              粗细
              <input type="range" min={8} max={72} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
            </label>
          )}
          <button type="button" onClick={undo}>撤销</button>
          <button type="button" onClick={clear}>清除</button>
          <span className="mask-editor-hint">
            {tool === 'pen' ? '点击描点，再点起点闭合' : '按住拖动涂抹要修改的区域'}
          </span>
          <div className="mask-editor-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="primary" onClick={save}>完成</button>
          </div>
        </div>
        <div className="mask-editor-stage">
          <canvas
            ref={viewRef}
            className={`mask-canvas checkerboard ${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => {
              if (tool === 'brush' && drawing.current) paintBrush(toImagePoint(e));
            }}
            onPointerUp={() => { drawing.current = false; }}
            onPointerLeave={() => { drawing.current = false; }}
          />
        </div>
      </div>
    </div>
  );
}
