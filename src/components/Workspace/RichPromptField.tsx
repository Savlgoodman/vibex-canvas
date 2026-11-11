import { useCallback, useMemo, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { RefTagNode, setRefTagContext } from './lexical/RefTagNode';
import { CommentBlockNode, setCommentBlockContext } from './lexical/CommentBlockNode';
import { promptEditorTheme } from './lexical/theme';
import { AtMentionPlugin } from './lexical/AtMentionPlugin';
import { PromptSyncPlugin } from './lexical/PromptSyncPlugin';
import { DecoratorDeletePlugin } from './lexical/DecoratorDeletePlugin';

interface Props {
  value: string;
  onChange: (value: string) => void;
  refHashes: string[];
  onRefClick?: (hash: string) => void;
  onCommentDelete?: (hash: string) => void;
  onCommentClick?: (hash: string) => void;
  placeholder?: string;
  className?: string;
}

function Placeholder({ text }: { text: string }) {
  return <div className="pe-placeholder">{text}</div>;
}

/** Plugin to sync render context for decorator nodes */
function ContextSyncPlugin({
  refHashes,
  onRefClick,
  onCommentDelete,
  onCommentClick,
}: {
  refHashes: string[];
  onRefClick?: (hash: string) => void;
  onCommentDelete?: (hash: string) => void;
  onCommentClick?: (hash: string) => void;
}) {
  // Update global context before every render
  setRefTagContext(refHashes, onRefClick);
  setCommentBlockContext(refHashes, onCommentDelete, onCommentClick);
  return null;
}

export function RichPromptField({
  value, onChange, refHashes, onRefClick, onCommentDelete, onCommentClick,
  placeholder = '', className = '',
}: Props) {
  const initialConfig = useMemo(() => ({
    namespace: 'PromptEditor',
    theme: promptEditorTheme,
    onError: (error: Error) => { console.error(error); throw error; },
    nodes: [RefTagNode, CommentBlockNode],
    editable: true,
  }), []);

  // Sync context on every render (so decorators have latest hash index map)
  setRefTagContext(refHashes, onRefClick);
  setCommentBlockContext(refHashes, onCommentDelete, onCommentClick);

  // Hold the latest onChange in a ref so the editor's update listener never has
  // to be torn down and re-registered (that churn is what fed the sync loop).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleInternalChange = useCallback((text: string) => {
    onChangeRef.current(text);
  }, []);

  return (
    <div className={`rich-prompt-field ${className}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <PlainTextPlugin
          contentEditable={<ContentEditable className="pe-editor" />}
          placeholder={<Placeholder text={placeholder} />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ContextSyncPlugin
          refHashes={refHashes}
          onRefClick={onRefClick}
          onCommentDelete={onCommentDelete}
          onCommentClick={onCommentClick}
        />
        <PromptSyncPlugin prompt={value} onInternalChange={handleInternalChange} />
        <AtMentionPlugin refHashes={refHashes} />
        <DecoratorDeletePlugin onCommentDelete={onCommentDelete} />
      </LexicalComposer>
    </div>
  );
}
