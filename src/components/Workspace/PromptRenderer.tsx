import { useMemo } from 'react';
import { parsePrompt, type PromptSegment } from '../../services/promptSerialization';

interface Props {
  prompt: string;
  refHashes: string[];
  onRefClick?: (hash: string) => void;
  onCommentClick?: (hash: string) => void;
  onCommentDelete?: (hash: string) => void;
}

export function PromptRenderer({ prompt, refHashes, onRefClick, onCommentClick, onCommentDelete }: Props) {
  const segments = useMemo(() => parsePrompt(prompt), [prompt]);

  return (
    <span className="prompt-renderer">
      {segments.map((seg, i) => renderSegment(seg, i, refHashes, onRefClick, onCommentClick, onCommentDelete))}
    </span>
  );
}

function renderSegment(
  seg: PromptSegment,
  idx: number,
  refHashes: string[],
  onRefClick?: (hash: string) => void,
  onCommentClick?: (hash: string) => void,
  onCommentDelete?: (hash: string) => void,
) {
  if (seg.kind === 'text') {
    return <span key={idx} className="prompt-seg-text">{seg.value}</span>;
  }
  if (seg.kind === 'ref') {
    const pos = refHashes.indexOf(seg.hash);
    const deleted = pos < 0;
    return (
      <span
        key={idx}
        className={`prompt-seg-ref ${deleted ? 'prompt-seg-ref-deleted' : ''}`}
        onClick={() => !deleted && onRefClick?.(seg.hash)}
        title={deleted ? '参考图已删除' : `跳转到 Image ${pos + 1}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        {deleted ? '已删除' : `Image ${pos + 1}`}
      </span>
    );
  }
  if (seg.kind === 'comment') {
    const pos = refHashes.indexOf(seg.hash);
    const label = pos >= 0 ? `image${pos + 1}` : '已删除';
    const deleted = pos < 0;
    return (
      <span
        key={idx}
        className={`prompt-seg-comment ${deleted ? 'prompt-seg-comment-deleted' : ''}`}
        onClick={() => !deleted && onCommentClick?.(seg.hash)}
      >
        <span className="prompt-seg-comment-header">
          <span className="prompt-seg-comment-label">{label}</span>
          <button
            className="prompt-seg-comment-delete"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('确定删除该图片的所有评论？')) {
                onCommentDelete?.(seg.hash);
              }
            }}
            title="删除评论"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
        <span className="prompt-seg-comment-body">{seg.lines.trim()}</span>
      </span>
    );
  }
  return null;
}
