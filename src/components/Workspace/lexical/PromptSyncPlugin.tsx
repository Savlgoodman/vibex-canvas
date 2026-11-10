import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { $getRoot, $createParagraphNode, $createTextNode, type EditorState } from 'lexical';
import { $createRefTagNode } from './RefTagNode';
import { $createCommentBlockNode } from './CommentBlockNode';
import { parsePrompt } from '../../../services/promptSerialization';

/**
 * Bidirectional sync between the external prompt string and the Lexical editor.
 *
 * Editor -> string: OnChangePlugin fires only on real content edits (not on
 * selection changes), which is what stops the "每移动坐标就多出换行" loop.
 *
 * String -> editor: only when the incoming value differs from the text the
 * editor currently holds. Comparing against the live content instead of a ref
 * means our own echo is a no-op and the tree is never rebuilt mid-typing.
 */
export function PromptSyncPlugin({
  prompt,
  onInternalChange,
}: {
  prompt: string;
  onInternalChange: (text: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const lastEmitted = useRef<string | null>(null);

  // Load the initial value once.
  useEffect(() => {
    loadPromptIntoEditor(editor, prompt);
    lastEmitted.current = prompt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external changes in — but never our own echo.
  useEffect(() => {
    if (prompt === lastEmitted.current) return;
    let current = '';
    editor.getEditorState().read(() => {
      current = $getTextFromRoot();
    });
    if (prompt === current) {
      lastEmitted.current = prompt;
      return;
    }
    loadPromptIntoEditor(editor, prompt);
    lastEmitted.current = prompt;
  }, [prompt, editor]);

  const handleChange = (editorState: EditorState) => {
    editorState.read(() => {
      const text = $getTextFromRoot();
      if (text === lastEmitted.current) return;
      lastEmitted.current = text;
      onInternalChange(text);
    });
  };

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
}

function $getTextFromRoot(): string {
  return $getRoot()
    .getChildren()
    .map((child) => child.getTextContent())
    .join('\n');
}

/**
 * Rebuild the editor from the wire format.
 *
 * Round-trip fidelity matters: this text is compared against the editor's own
 * output, so dropping a trailing empty paragraph (or a blank line) would make
 * every keystroke look like an external change and rebuild the tree.
 */
export function loadPromptIntoEditor(
  editor: import('lexical').LexicalEditor,
  prompt: string,
) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();

      let paragraph = $createParagraphNode();

      for (const seg of parsePrompt(prompt)) {
        if (seg.kind === 'text') {
          const lines = seg.value.split('\n');
          lines.forEach((line, i) => {
            if (i > 0) {
              root.append(paragraph);
              paragraph = $createParagraphNode();
            }
            if (line) paragraph.append($createTextNode(line));
          });
        } else if (seg.kind === 'ref') {
          paragraph.append($createRefTagNode(seg.hash));
        } else if (seg.kind === 'comment') {
          if (paragraph.getChildren().length > 0) {
            root.append(paragraph);
            paragraph = $createParagraphNode();
          }
          root.append($createCommentBlockNode(seg.hash, seg.lines));
        }
      }

      root.append(paragraph);
    },
    { tag: 'external-sync' },
  );
}
