import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Annotorious,
  ImageAnnotator,
  ImageAnnotationPopup,
  W3CImageFormat,
  useAnnotations,
  useAnnotator,
  UserSelectAction,
  type ImageAnnotation,
  type PopupProps,
} from '@annotorious/react';

export interface ImageAnnotationPoint {
  id: string;
  /** Normalized 0–1, relative to the image box. */
  x: number;
  y: number;
  text: string;
}

interface Props {
  imageUrl: string;
  /** Points to display. The layer does not own them. */
  annotations: ImageAnnotationPoint[];
  editable?: boolean;
  /** Called whenever the user adds, moves, edits or deletes a pin. */
  onChange?: (next: ImageAnnotationPoint[]) => void;
  /** Called when a pin is opened for viewing. */
  onOpen?: (annotation: ImageAnnotationPoint) => void;
}

// Annotorious 3.x has no point selector, so a pin is a near-zero rectangle.
const PIN_EPSILON = 0.002;

function toImageAnnotation(p: ImageAnnotationPoint): ImageAnnotation {
  return {
    id: p.id,
    target: {
      annotation: p.id,
      selector: {
        type: 'RECTANGLE',
        geometry: {
          x: p.x,
          y: p.y,
          w: PIN_EPSILON,
          h: PIN_EPSILON,
          bounds: {
            minX: p.x,
            minY: p.y,
            maxX: p.x + PIN_EPSILON,
            maxY: p.y + PIN_EPSILON,
          },
        },
      },
    },
    bodies: p.text
      ? [{ id: `${p.id}-body`, type: 'TextualBody', purpose: 'commenting', value: p.text }]
      : [],
  } as unknown as ImageAnnotation;
}

function toPoints(annotations: ImageAnnotation[]): ImageAnnotationPoint[] {
  return annotations.map((a) => {
    const bounds = (a.target as unknown as {
      selector: { geometry: { bounds: { minX: number; minY: number } } };
    }).selector.geometry.bounds;
    const body = a.bodies.find((b) => b.purpose === 'commenting');
    return {
      id: a.id,
      x: bounds.minX,
      y: bounds.minY,
      text: typeof body?.value === 'string' ? body.value : '',
    };
  });
}

function signature(points: ImageAnnotationPoint[]): string {
  return points.map((p) => `${p.id}:${p.x.toFixed(4)}:${p.y.toFixed(4)}:${p.text}`).join('|');
}

export function AnnotationLayer({ imageUrl, annotations, editable = true, onChange, onOpen }: Props) {
  const imageId = useMemo(() => `ref-${simpleHash(imageUrl)}.png`, [imageUrl]);

  return (
    <div className="anno-layer" data-editable={editable}>
      <Annotorious>
        <ImageAnnotator
          adapter={W3CImageFormat(imageId)}
          userSelectAction={editable ? UserSelectAction.EDIT : UserSelectAction.NONE}
          drawingEnabled={editable}
          drawingMode="click"
          style={() => ({ fill: '#4f8cff', fillOpacity: 0.9, stroke: '#ffffff', strokeWidth: 1.5 })}
        >
          <img src={imageUrl} alt="" draggable={false} />
        </ImageAnnotator>
        <ImageAnnotationPopup
          popup={(props) => (
            <CommentPopup
              {...props}
              onOpen={onOpen}
            />
          )}
        />
        <StoreBridge annotations={annotations} onChange={onChange} onOpen={onOpen} />
      </Annotorious>
    </div>
  );
}

function CommentPopup({
  annotation,
  editable,
  onCreateBody,
  onUpdateBody,
  onDeleteBody,
  onOpen,
}: PopupProps & { onOpen?: (a: ImageAnnotationPoint) => void }) {
  const commentBody = annotation.bodies.find((b) => b.purpose === 'commenting');
  const initial = typeof commentBody?.value === 'string' ? commentBody.value : '';
  const [text, setText] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initial);
    if (editable) taRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation.id]);

  const point = toPoints([annotation as ImageAnnotation])[0];

  const commit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed === initial) return;
    if (!trimmed) {
      if (commentBody) onDeleteBody(commentBody.id);
      return;
    }
    if (commentBody) onUpdateBody(commentBody, { value: trimmed });
    else onCreateBody({ purpose: 'commenting', type: 'TextualBody', value: trimmed });
    if (point) onOpen?.({ ...point, text: trimmed });
  }, [text, initial, commentBody, onUpdateBody, onCreateBody, onDeleteBody, onOpen, point]);

  if (!editable) {
    return (
      <div className="anno-popup anno-popup-readonly">{initial || '（空评论）'}</div>
    );
  }

  return (
    <div className="anno-popup" onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        ref={taRef}
        className="anno-popup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
            taRef.current?.blur();
          }
        }}
        placeholder="输入评论..."
        rows={2}
      />
      <button
        className="anno-popup-delete"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (commentBody) onDeleteBody(commentBody.id);
        }}
        title="删除评论"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Keeps our `annotations` prop and the Annotorious store in step.
 *
 * Annotorious owns the interaction state (which pin is selected, mid-drag
 * positions). This bridge only reconciles when the two sides genuinely differ,
 * which avoids the classic echo loop.
 */
function StoreBridge({
  annotations,
  onChange,
  onOpen,
}: {
  annotations: ImageAnnotationPoint[];
  onChange?: (next: ImageAnnotationPoint[]) => void;
  onOpen?: (a: ImageAnnotationPoint) => void;
}) {
  const anno = useAnnotator();
  const store = useAnnotations();
  const lastIn = useRef('');
  const lastOut = useRef('');

  // Props -> store
  useEffect(() => {
    if (!anno) return;
    const sig = signature(annotations);
    if (sig === lastIn.current) return;
    const live = signature(toPoints(store as ImageAnnotation[]));
    if (live === sig) {
      lastIn.current = sig;
      return;
    }
    lastIn.current = sig;
    lastOut.current = sig;
    anno.setAnnotations(annotations.map(toImageAnnotation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, anno]);

  // Store -> props
  useEffect(() => {
    if (!anno || !onChange) return;
    const points = toPoints(store as ImageAnnotation[]);
    const sig = signature(points);
    if (sig === lastOut.current) return;
    lastOut.current = sig;
    lastIn.current = sig;
    onChange(points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, anno, onChange]);

  // Report selection upward so the host can react to pin clicks.
  useEffect(() => {
    if (!anno) return;
    anno.on('selectionChanged', (selected: unknown[]) => {
      const first = selected[0] as ImageAnnotation | undefined;
      if (!first) return;
      const p = toPoints([first])[0];
      if (p) onOpen?.(p);
    });
  }, [anno, onOpen]);

  return null;
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(input.length, 512); i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
