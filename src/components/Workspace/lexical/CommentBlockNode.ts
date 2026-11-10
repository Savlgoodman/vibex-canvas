import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement,
} from 'lexical';
import { createElement, type ReactNode } from 'react';

export type SerializedCommentBlockNode = SerializedLexicalNode & {
  type: 'comment-block';
  version: 1;
  hash: string;
  lines: string;
};

// Global registry for rendering context
const commentBlockRenderContext = {
  refHashes: [] as string[],
  onCommentDelete: undefined as ((hash: string) => void) | undefined,
  onCommentClick: undefined as ((hash: string) => void) | undefined,
};

export function setCommentBlockContext(
  refHashes: string[],
  onCommentDelete?: (hash: string) => void,
  onCommentClick?: (hash: string) => void,
) {
  commentBlockRenderContext.refHashes = refHashes;
  commentBlockRenderContext.onCommentDelete = onCommentDelete;
  commentBlockRenderContext.onCommentClick = onCommentClick;
}

export class CommentBlockNode extends DecoratorNode<ReactNode> {
  __hash: string;
  __lines: string;

  static getType(): string {
    return 'comment-block';
  }

  static clone(node: CommentBlockNode): CommentBlockNode {
    return new CommentBlockNode(node.__hash, node.__lines, node.__key);
  }

  constructor(hash: string, lines: string, key?: NodeKey) {
    super(key);
    this.__hash = hash;
    this.__lines = lines;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div');
    div.className = 'pe-comment-block-wrapper';
    div.contentEditable = 'false';
    return div;
  }

  updateDOM(prevNode: CommentBlockNode): boolean {
    return prevNode.__hash !== this.__hash || prevNode.__lines !== this.__lines;
  }

  decorate(): ReactNode {
    const idx = commentBlockRenderContext.refHashes.indexOf(this.__hash);
    const imageLabel = idx >= 0 ? `image${idx + 1}` : '已删除';
    const deleted = idx < 0;
    return createElement('div', {
      className: `pe-comment-block ${deleted ? 'pe-comment-block-deleted' : ''}`,
      onClick: () => !deleted && commentBlockRenderContext.onCommentClick?.(this.__hash),
    },
      createElement('div', { className: 'pe-comment-block-header' },
        createElement('span', { className: 'pe-comment-block-label' }, imageLabel),
        createElement('button', {
          className: 'pe-comment-block-delete',
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            if (window.confirm('确定删除该图片的所有评论？')) {
              commentBlockRenderContext.onCommentDelete?.(this.__hash);
            }
          },
          title: '删除评论',
        },
          createElement('svg', { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
            createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
            createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
          ),
        ),
      ),
      createElement('div', { className: 'pe-comment-block-body' }, this.__lines.trim()),
    );
  }

  getHash(): string {
    return this.__hash;
  }

  getLines(): string {
    return this.__lines;
  }

  static importJSON(json: SerializedCommentBlockNode): CommentBlockNode {
    return $createCommentBlockNode(json.hash, json.lines);
  }

  exportJSON(): SerializedCommentBlockNode {
    return {
      ...super.exportJSON(),
      hash: this.__hash,
      lines: this.__lines,
      type: 'comment-block',
      version: 1,
    };
  }

  getTextContent(): string {
    return `'''comment-${this.__hash}\n${this.__lines}'''`;
  }

  isInline(): boolean {
    return false;
  }
}

export function $createCommentBlockNode(hash: string, lines: string): CommentBlockNode {
  return $applyNodeReplacement(new CommentBlockNode(hash, lines));
}

export function $isCommentBlockNode(node: LexicalNode | null | undefined): node is CommentBlockNode {
  return node instanceof CommentBlockNode;
}
