import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement,
} from 'lexical';
import { createElement, type ReactNode } from 'react';

export type SerializedRefTagNode = SerializedLexicalNode & {
  type: 'ref-tag';
  version: 1;
  hash: string;
};

// Global registry for rendering context
const refTagRenderContext = {
  refHashes: [] as string[],
  onRefClick: undefined as ((hash: string) => void) | undefined,
};

export function setRefTagContext(refHashes: string[], onRefClick?: (hash: string) => void) {
  refTagRenderContext.refHashes = refHashes;
  refTagRenderContext.onRefClick = onRefClick;
}

export class RefTagNode extends DecoratorNode<ReactNode> {
  __hash: string;

  static getType(): string {
    return 'ref-tag';
  }

  static clone(node: RefTagNode): RefTagNode {
    return new RefTagNode(node.__hash, node.__key);
  }

  constructor(hash: string, key?: NodeKey) {
    super(key);
    this.__hash = hash;
  }

  isInline(): boolean {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.className = 'pe-ref-tag-wrapper';
    span.contentEditable = 'false';
    return span;
  }

  updateDOM(prevNode: RefTagNode): boolean {
    return prevNode.__hash !== this.__hash;
  }

  decorate(): ReactNode {
    const idx = refTagRenderContext.refHashes.indexOf(this.__hash);
    const deleted = idx < 0;
    return createElement('span', {
      className: `pe-ref-tag ${deleted ? 'pe-ref-tag-deleted' : ''}`,
      title: deleted ? '参考图已删除' : `跳转到 Image ${idx + 1}`,
      onClick: () => !deleted && refTagRenderContext.onRefClick?.(this.__hash),
    },
      createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
        createElement('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
        createElement('path', { d: 'M21 15l-5-5L5 21' }),
      ),
      deleted ? '已删除' : `Image ${idx + 1}`,
    );
  }

  getHash(): string {
    return this.__hash;
  }

  static importJSON(json: SerializedRefTagNode): RefTagNode {
    return $createRefTagNode(json.hash);
  }

  exportJSON(): SerializedRefTagNode {
    return {
      ...super.exportJSON(),
      hash: this.__hash,
      type: 'ref-tag',
      version: 1,
    };
  }

  getTextContent(): string {
    return `[@${this.__hash}]`;
  }
}

export function $createRefTagNode(hash: string): RefTagNode {
  return $applyNodeReplacement(new RefTagNode(hash));
}

export function $isRefTagNode(node: LexicalNode | null | undefined): node is RefTagNode {
  return node instanceof RefTagNode;
}
