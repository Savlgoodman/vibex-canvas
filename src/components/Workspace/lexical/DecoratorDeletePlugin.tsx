import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from 'lexical';
import { $isRefTagNode } from './RefTagNode';
import { $isCommentBlockNode } from './CommentBlockNode';

/**
 * Intercepts backspace/delete on decorator nodes (ref tags, comment blocks).
 * First press: selects the node (visual highlight).
 * Second press: removes it and calls the onDelete callback.
 */
export function DecoratorDeletePlugin({
  onCommentDelete,
}: {
  onCommentDelete?: (hash: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        // If a decorator node is selected, delete it with confirmation for comments
        const nodes = selection.getNodes();
        for (const node of nodes) {
          if ($isCommentBlockNode(node)) {
            if (event) event.preventDefault();
            const hash = node.getHash();
            if (onCommentDelete) {
              onCommentDelete(hash);
            }
            node.remove();
            return true;
          }
          if ($isRefTagNode(node)) {
            if (event) event.preventDefault();
            node.remove();
            return true;
          }
        }

        // Check if cursor is right after a decorator node
        if (selection.isCollapsed()) {
          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();
          const offset = anchor.offset;

          // Check previous sibling
          if (offset === 0) {
            const prev = anchorNode.getPreviousSibling();
            if (prev && $isCommentBlockNode(prev)) {
              if (event) event.preventDefault();
              const hash = prev.getHash();
              if (onCommentDelete) {
                onCommentDelete(hash);
              }
              prev.remove();
              return true;
            }
            if (prev && $isRefTagNode(prev)) {
              if (event) event.preventDefault();
              prev.remove();
              return true;
            }
          }
        }

        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, onCommentDelete]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        const nodes = selection.getNodes();
        for (const node of nodes) {
          if ($isCommentBlockNode(node)) {
            if (event) event.preventDefault();
            const hash = node.getHash();
            if (onCommentDelete) {
              onCommentDelete(hash);
            }
            node.remove();
            return true;
          }
          if ($isRefTagNode(node)) {
            if (event) event.preventDefault();
            node.remove();
            return true;
          }
        }

        // Check if cursor is right before a decorator node
        if (selection.isCollapsed()) {
          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();
          const offset = anchor.offset;
          const textLen = anchorNode.getTextContent().length;

          if (offset === textLen) {
            const next = anchorNode.getNextSibling();
            if (next && $isCommentBlockNode(next)) {
              if (event) event.preventDefault();
              const hash = next.getHash();
              if (onCommentDelete) {
                onCommentDelete(hash);
              }
              next.remove();
              return true;
            }
            if (next && $isRefTagNode(next)) {
              if (event) event.preventDefault();
              next.remove();
              return true;
            }
          }
        }

        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, onCommentDelete]);

  return null;
}
