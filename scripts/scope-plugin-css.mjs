import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const scope = '.vibex-canvas-root';

const sources = [
  'src/index.css',
  'src/App.css',
  'src/components/TopBar.css',
  'src/components/Settings/SettingsModal.css',
  'src/components/TaskList/AgentRecordsPanel.css',
  'src/components/TaskList/TaskListPanel.css',
  'src/components/ui/ImagePreview.css',
  'src/components/ui/ProtocolIcon.css',
  'src/components/ui/SelectMenu.css',
  'src/components/ui/Tooltip.css',
  'src/components/Workspace/AnnotationLayer.css',
  'src/components/Workspace/MaskEditor.css',
  'src/components/Workspace/OutputPanel.css',
  'src/components/Workspace/ParamsPanel.css',
  'src/components/Workspace/PromptEditorModal.css',
  'src/components/Workspace/PromptRenderer.css',
  'src/components/Workspace/RichPromptField.css',
  'src/components/Workspace/Workspace.css',
  require.resolve('@annotorious/react/annotorious-react.css'),
];

function prefixSelector(selector) {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.startsWith(scope)) return trimmed;
  if (trimmed === ':root' || trimmed === 'html' || trimmed === 'body' || trimmed === '#root') {
    return scope;
  }
  if (trimmed === '*') return `${scope}, ${scope} *`;
  if (trimmed.startsWith('html ') || trimmed.startsWith('body ') || trimmed.startsWith(':root ')) {
    return `${scope}${trimmed.replace(/^(html|body|:root)/, '')}`;
  }
  return `${scope} ${trimmed}`;
}

const chunks = [];
for (const source of sources) {
  const path = source.startsWith('src/') ? join(root, source) : source;
  const css = await readFile(path, 'utf8');
  chunks.push(`/* ${source.startsWith('src/') ? source : 'annotorious-react.css'} */\n${css}`);
}

const parsed = postcss.parse(chunks.join('\n\n'));
const keyframes = new Map();
parsed.walkAtRules('keyframes', (rule) => {
  const next = `vibex-canvas-${rule.params}`;
  keyframes.set(rule.params, next);
  rule.params = next;
});
parsed.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return;
  rule.selectors = rule.selectors.map(prefixSelector);
});
parsed.walkDecls((decl) => {
  if (decl.prop !== 'animation' && decl.prop !== 'animation-name') return;
  for (const [from, to] of keyframes) {
    decl.value = decl.value.replaceAll(from, to);
  }
});

const shell = `${scope}{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}${scope}>.app{flex:1;min-height:0;width:100%}`;
const css = `${shell}\n${parsed.toString()}\n`;
await mkdir(join(root, 'app'), { recursive: true });
await mkdir(join(root, 'runtime'), { recursive: true });
await writeFile(join(root, 'app', 'styles.css'), css);
await writeFile(join(root, 'runtime', 'app.css'), css);
console.log(`scoped plugin css ${css.length} bytes`);
