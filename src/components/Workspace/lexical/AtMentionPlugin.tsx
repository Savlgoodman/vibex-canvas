import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import { $createRefTagNode } from './RefTagNode';

interface Props {
  refHashes: string[];
  onSelect?: (hash: string) => void;
}

export function AtMentionPlugin({ refHashes, onSelect }: Props) {
  const [editor] = useLexicalComposerContext();
  const [menuState, setMenuState] = useState<{
    open: boolean;
    query: string;
    selectedIdx: number;
    top: number;
    left: number;
  }>({ open: false, query: '', selectedIdx: 0, top: 0, left: 0 });

  const menuRef = useRef<HTMLDivElement>(null);
  const atNodeStartOffset = useRef<number>(0);

  const filteredOptions = refHashes
    .map((h, i) => ({ hash: h, label: `Image ${i + 1}`, index: i }))
    .filter((o) => o.label.toLowerCase().includes(menuState.query.toLowerCase()));

  // Listen for text changes to detect @ trigger
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has('skip-dom')) return;
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setMenuState((s) => ({ ...s, open: false }));
          return;
        }
        const anchor = selection.anchor;
        if (anchor.type !== 'text') {
          setMenuState((s) => ({ ...s, open: false }));
          return;
        }
        const node = anchor.getNode();
        const text = node.getTextContent();
        const offset = anchor.offset;

        // Scan backward from cursor for @
        let i = offset - 1;
        while (i >= 0 && text[i] !== '@' && text[i] !== '\n' && text[i] !== ' ') {
          i--;
        }
        if (i < 0 || text[i] !== '@') {
          setMenuState((s) => ({ ...s, open: false }));
          return;
        }
        const query = text.slice(i + 1, offset);
        atNodeStartOffset.current = i;

        // Approximate caret position
        const lineHeight = 20;
        const linesBefore = text.slice(0, i).split('\n');
        const lineNum = linesBefore.length - 1;
        const colNum = linesBefore[linesBefore.length - 1].length;

        setMenuState({
          open: true,
          query,
          selectedIdx: 0,
          top: (lineNum + 1) * lineHeight + 4,
          left: Math.min(colNum * 7.8 + 10, 200),
        });
      });
    });
  }, [editor]);

  // Keyboard navigation
  useEffect(() => {
    if (!menuState.open || filteredOptions.length === 0) return;

    const removeDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        setMenuState((s) => ({ ...s, selectedIdx: Math.min(s.selectedIdx + 1, filteredOptions.length - 1) }));
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    const removeUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        setMenuState((s) => ({ ...s, selectedIdx: Math.max(s.selectedIdx - 1, 0) }));
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        selectOption(filteredOptions[menuState.selectedIdx].hash);
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    const removeEsc = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        setMenuState((s) => ({ ...s, open: false }));
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );

    return () => {
      removeDown();
      removeUp();
      removeEnter();
      removeEsc();
    };
  }, [editor, menuState.open, menuState.selectedIdx, filteredOptions]);

  const selectOption = useCallback((hash: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const anchor = selection.anchor;
      if (anchor.type !== 'text') return;
      const node = anchor.getNode();
      const text = node.getTextContent();
      const offset = anchor.offset;

      // Find the @ position
      let atIdx = offset - 1;
      while (atIdx >= 0 && text[atIdx] !== '@') atIdx--;
      if (atIdx < 0) return;

      // Remove the @ and query text, insert ref tag
      const before = text.slice(0, atIdx);
      const after = text.slice(offset);
      const newText = before + after;

      // Clear the text node
      node.setTextContent(newText);

      // Create selection at the position where @ was
      if (newText.length > 0) {
        const refNode = $createRefTagNode(hash);
        if (atIdx === 0) {
          node.insertBefore(refNode);
        } else {
          // Split text at atIdx
          const beforeNode = $createTextNode(before);
          node.replace(beforeNode);
          beforeNode.insertAfter(refNode);
          if (after) {
            const afterNode = $createTextNode(after);
            refNode.insertAfter(afterNode);
          }
        }
      } else {
        const refNode = $createRefTagNode(hash);
        node.replace(refNode);
        if (after) {
          const afterNode = $createTextNode(after);
          refNode.insertAfter(afterNode);
        }
      }

      onSelect?.(hash);
    });
    setMenuState((s) => ({ ...s, open: false }));
  }, [editor, onSelect]);

  return menuState.open && filteredOptions.length > 0 ? (
    <div
      ref={menuRef}
      className="pe-at-menu"
      style={{ top: menuState.top, left: menuState.left }}
    >
      {filteredOptions.map((opt, i) => (
        <div
          key={opt.hash}
          className={`pe-at-option ${i === menuState.selectedIdx ? 'active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            selectOption(opt.hash);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          {opt.label}
        </div>
      ))}
    </div>
  ) : null;
}
