# Agent 生成记录面板 — 设计文档

> 状态：设计待实现
> 范围：`src/`、`runtime/worker.mjs`、`runtime/sidecar.mjs`、`contents/skills/`

---

## 一、需求

在任务列表头部、「归档」按钮左侧，增加一个 **「Agent 记录」** 按钮。点击后侧栏切换为 Agent 生图记录视图，按 **输出目录** 聚合展示 Agent 通过 Skill 生成的图片。

同时解决一个既有缺陷：**图片文件被删除或丢失时，界面显示「图片已丢失或删除」占位**，而不是留空。

---

## 二、前置阻塞问题（必须先修）

### 现状：无法识别「Agent 生成」这件事

`runtime/worker.mjs:49`：

```js
source: params.outputDir ? 'agent' : 'manual',
```

**`source` 不是一个判断结果，它是 `outputDir` 的别名。** 全仓库只有这一处赋值，其余全部是它的下游投影：

| 位置 | 代码 | 结果 |
|---|---|---|
| `worker.mjs:24` | `targetDir = outputDir \|\| storage.imagesDir` | 图片落盘目录 |
| `worker.mjs:32` | `outputDir ? \`gen-${Date.now()}\` : recordId` | 文件名前缀 |
| `worker.mjs:49` | `source: params.outputDir ? 'agent' : 'manual'` | source 字段 |
| `worker.mjs:50` | `outputDir: params.outputDir \|\| null` | outputDir 字段 |
| `worker.mjs:55` | `if (params.outputDir)` | 写入 `records.json` 还是 `data.json` |

**后果**：Agent 调用生图时若未传 `outputDir`，这条记录会被写进 `data.json`，`source` 为 `manual`，**和 UI 手动生成完全无法区分**。本功能将完全看不到它。

### 现状：Agent 几乎不会传 `outputDir`

- `contents/skills/generate-image/SKILL.md` — **全文 0 次**出现 `outputDir`
- `contents/skills/generate-image/build/index.js:55` — 参数是无过滤透传（`--foo bar` → `params.foo`），`outputDir` 只能靠 Agent 猜出来

验证（当前磁盘状态）：

```
~/.vibex/vibex-canvas/agent-records/records.json   ← 不存在
```

**从未有任何一条 Agent 记录被写入过。**

### 修复方案：反转默认值

不新增字段，把 `source` 的默认值反过来——**未声明即 Agent**：

**`runtime/worker.mjs:49`** — 默认改为 agent，显式 `source` 优先：

```js
source: params.source || 'agent',
```

**`src/store/useStore.ts:451`** — UI 的 `generateImage(provider, {...})` 调用点显式标注：

```ts
generateImage(provider, {
  source: 'manual',      // ← 新增这一行
  model: params.model,
  prompt: params.prompt,
  // ...其余不变
});
```

参数会一路透传到 worker 的 `runGeneration`（`src/services/api.ts` → `src/services/bridge.ts` → `image.generate.start` → sidecar `runGenerationTask` → `runGeneration`），中间无字段过滤。

**`runtime/worker.mjs:55`** — Agent 记录（含无目录的）写入保留组：

```js
const dirKey = params.outputDir || '__default__';
if (params.source !== 'manual') {
  const agentRecords = storage.readAgentRecords();
  if (!agentRecords[dirKey]) agentRecords[dirKey] = [];
  agentRecords[dirKey].push(record);
  storage.writeAgentRecords(agentRecords);
} else {
  // 原 UI 分支不变
}
```

### 为什么这个方向更好

| | 我原先的方案 | 反转默认值 |
|---|---|---|
| 新增字段 | Sidecar 标注 `params.source = 'agent'` | 无 |
| Sidecar 改动 | 需要 | 不需要 |
| 漏标的风险 | 新增 API 调用方忘了标 → 被当成手动 | 新增调用方忘了标 → **被当成 Agent**（安全侧） |
| Agent 感知 | — | SKILL.md 不提这个字段，Agent 无从传入 |

关键是失败方向：反转后，任何未知来源的调用都归入 Agent 记录面板，而不是混进用户的手动任务列表。这是期望的行为。

### 附带修复（同批做）

**`image.getImage` 未做路径检查**（`worker.mjs:175-181`）：`readFileSync(filePath)` 直接读取任意路径，可读取插件目录外的任意文件。`image.deleteImage`（`worker.mjs:183`）已经有根目录白名单校验，`getImage` 缺失同样的防护。

```js
registrar.handle('image.getImage', async ({ filePath }) => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { resolve, sep } = await import('node:path');
  const target = resolve(String(filePath));
  if (!existsSync(target)) return { dataUrl: undefined };  // ← 丢失文件返回 undefined，不抛错
  // ...根目录白名单校验同 image.deleteImage
});
```

`return { dataUrl: undefined }` 同时实现了「图片丢失」的检测——文件不存在时不抛 500，返回空即可。

---

## 三、数据层改动

### 3.1 Worker

`image.listAgentRecords` handler 已存在（`worker.mjs:171`），返回整个 `{ [dir]: record[] }` map，无需改动。

`plugin.json:64` 已声明 `image.listAgentRecords`，无需改动。

### 3.2 Bridge — `src/services/bridge.ts`

新增导出（模板参照同文件 `listProviders`，第 203-215 行）：

```ts
export async function listAgentRecords(): Promise<Record<string, AgentRecord[]>> {
  const bridge = getBridge();
  if (bridge) {
    return bridge.invoke('image.listAgentRecords') as Promise<Record<string, AgentRecord[]>>;
  }
  return {};
}
```

本地文件读取，一次性 invoke 即可，不需要异步轮询。

### 3.3 类型 — `src/types/index.ts`

```ts
export interface AgentRecord {
  id: string;
  prompt: string;
  providerId: string;
  model: string;
  size: string;
  status: 'success' | 'failed';
  imagePaths: string[];      // 绝对路径，非 URL
  source: 'agent';
  outputDir: string | null;
  createdAt: number;
}
```

### 3.4 Store — `src/store/useStore.ts`

新增独立切片（**不要**试图并入 `tasks`，Worker 刻意写在另一个文件）：

```ts
agentRecords: Record<string, AgentRecord[]>;
agentRecordsLoaded: boolean;
loadAgentRecords: () => Promise<void>;
```

`loadAgentRecords()` 调用 `listAgentRecords()` 后写入 store。不做持久化——记录以 `records.json` 为准，前端只是只读视图。

---

## 四、UI 设计

### 4.1 侧栏的两种模式

侧栏维持单列，内部切换。`App.css` 与 `App.tsx` **无需改动**。

```
┌─────────────────────┐
│ 任务     [Agent][归档][+] │  ← .task-list-header
├─────────────────────┤
│                     │
│   任务卡片列表        │  ← 默认态
│   （现有样式不变）    │
│                     │
└─────────────────────┘
```

点击 `[Agent]` 后，标题与内容区整体替换：

```
┌─────────────────────┐
│ Agent 记录    [返回]  │
├─────────────────────┤
│ ▾ D:\design\banner  │ 3 │
│   ┌───┐ ┌───┐ ┌───┐ │    ← 3 条以内平铺
│   └───┘ └───┘ └───┘ │
│ ▾ E:\assets          │ 7 │
│   ┌───┐ ┌───┐ ┌─+4┐ │    ← 第 4 条折叠为 +N
│   └───┘ └───┘ └───┘ │
│ ▸ 未指定目录         │ 2 │  ← __default__ 组，收起态
└─────────────────────┘
```

### 4.2 目录组（收拢/展开）

**折叠阈值 3 条**。这是关键设计点：超过 3 条才折叠，正好是侧栏宽度下**一行能完整显示的卡片数**，第 4 条起才需要收拢。

组头行：

```
▾  D:\design\banner          3
↑   ↑          ↑              ↑
│   │          │              └ 条数徽章（复用 --overlay 样式）
│   │          └ 目录路径，单行截断
│   └ 展开/收起箭头
└ 分组容器
```

路径显示规则：
- 完整路径单行显示，`text-overflow: ellipsis` 截断
- 鼠标悬停 `title` 展示完整路径（Windows 路径很长，截断是必然的）
- **不做路径归一化分组**。`D:/foo` 和 `D:\foo` 是两个组——它们确实来自 Agent 传入的不同字符串，合并需要引入路径规范化，而规范化本身有 Windows 盘符大小写、尾部斜杠、UNC 前缀等一串边界问题。YAGNI，留到真有用户反馈再说。用 `ponytail:` 注释标记这个天花板。

「未指定目录」组：`__default__` 的显示名，图标区别于真实路径（见 4.5）。

组的默认状态：**前 2 个组展开，其余收起**。避免首次打开就是一长串卡片墙。

### 4.3 卡片样式 — 与现有任务卡片一致

复用 `TaskCard` 的结构和类名前缀，保证视觉统一：

```
┌──────────┐
│ ▓▓▓▓▓▓▓▓ │  ← .agent-card-thumb  40×40
│ ▓▓▓▓▓▓▓▓ │
├──────────┤
│ 一只可爱的 │  ← .agent-card-title  单行截断
│ 2 分钟前  │  ← .agent-card-meta   provider · 时间
└──────────┘
```

与 `TaskCard` 的差异：
- **不可点击选中**（Agent 记录是只读视图，不参与任务切换）
- **无归档按钮**
- **多图记录**：缩略图右下角加 `history-count` 样式的小徽章显示张数（复用 `OutputPanel.css` 的 `.history-count` 视觉，但需要复制到新 CSS — 见 4.6）
- 缩略图只取 `imagePaths[0]`

### 4.4 图片丢失占位 — 你要求的功能

**这是新面板和现有 UI 都缺的。** 全仓库 `src/` 目前 0 个 `onError` 处理（`grep -rn "onError" src/` 无匹配），`useImageUrl` 加载失败时只是 `console.error` 后返回 `undefined`，界面静默留空。

新增 `src/hooks/useImageOrMissing.ts`（或在 `useImageUrl` 上加第二返回值）：

```ts
const { url, missing } = useImageOrMissing(`file:${path}`);
```

卡片渲染三分支：

| 状态 | 渲染 |
|---|---|
| 加载中 | `.agent-card-loading` + spinner |
| 加载成功 | `<AlphaImage>` |
| `url === undefined` 且已结束加载 | `.agent-card-missing`「图片已丢失或删除」 |

`.agent-card-missing` 样式参照现有 `.history-fail`（`OutputPanel.css:283-288`）：居中、`--error-bg` 背景，但文字改为提示而非 ✕ 图标。

**同一个 hook 要回灌到 `OutputPanel`**——主界面的图片同样会丢失，你提到的这个问题不应该只在新面板修。

### 4.5 空态

三种空态，文案区分：

| 情况 | 文案 |
|---|---|
| `records.json` 不存在 | 还没有 Agent 生成记录 |
| 有记录但全部图片丢失 | 所有图片已丢失或删除 |
| 加载失败 | 记录加载失败 |

### 4.6 CSS 作用域

`.history-*` 类定义在 `OutputPanel.css`，只被 `OutputPanel.tsx` import。Vite 的 CSS 是全局注入的，所以只要 OutputPanel 挂载过，类就可用——但这是打包的副作用，不是契约。当没有选中任务时 `Workspace.tsx:46-57` 提前返回，OutputPanel 根本不挂载。

**决定：复制相关规则到新 CSS，不 import 跨组件文件。** 侧栏缩略图和输出面板缩略图大概率会分叉，复制约 40 行反而更省心。

---

## 五、实现清单

按依赖顺序：

| # | 文件 | 改动 | 类型 |
|---|---|---|---|
| 1 | `runtime/worker.mjs` | `source` 默认反转为 agent + 无目录记录写 `__default__` | 修复（阻塞） |
| 2 | `src/store/useStore.ts` | `generateImage` 调用点加 `source: 'manual'` | 修复（阻塞） |
| 3 | `runtime/worker.mjs` | `image.getImage` 加根目录白名单 + 文件不存在返回 `{dataUrl:undefined}` | 修复（安全） |
| 4 | `src/services/bridge.ts` | 新增 `listAgentRecords()` | 新增 |
| 5 | `src/types/index.ts` | 新增 `AgentRecord` 类型 | 新增 |
| 6 | `src/store/useStore.ts` | `agentRecords` 切片 + `loadAgentRecords()` | 新增 |
| 7 | `src/hooks/useImageUrl.ts` | 加载失败返回 `missing` 信号 | 修改 |
| 8 | `src/components/TaskList/AgentRecordsPanel.tsx` | 新面板组件 | 新增 |
| 9 | `src/components/TaskList/AgentRecordsPanel.css` | 新样式 | 新增 |
| 10 | `src/components/TaskList/TaskListPanel.tsx` | 加「Agent 记录」按钮 + 模式切换 | 修改 |
| 11 | `src/components/Workspace/OutputPanel.tsx` | 图片丢失占位回灌 | 修改 |
| 12 | `contents/skills/generate-image/SKILL.md` | 文档化 `--outputDir` 参数 | 修改 |
| 13 | `contents/skills/generate-image/build/index.js` | `list-records` 拆分或补 `list-agent-records` | 修改 |

**不改动**：`App.tsx`、`App.css`、`runtime/sidecar.mjs`、`plugin.json`（`image.listAgentRecords` 已在白名单）、`runtime/storage.mjs`。

---

## 六、验证

1. `npx tsc -b` 类型检查通过
2. `npx vibex-plugin build` 构建通过
3. `npm run dev:plugin` 启动，VibeX 中打开生图画板
4. **来源区分**：在 Agent 会话里跑
   ```bash
   node ~/.claude/skills/generate-image/build/index.js generate "测试图"
   ```
   检查 `~/.vibex/vibex-canvas/agent-records/records.json` 出现 `__default__` 组，且 `source: "agent"`，同时 `data.json` 里**没有**这条记录
5. **带目录**：加 `--outputDir "D:\test-out"`，确认记录按目录分组
6. **UI 不受影响**：UI 生成一张图，确认仍进 `data.json` 且 `source` 为 `manual`
7. **折叠**：往同一目录塞 4+ 条记录，确认第 4 条折叠为 `+N`，点击展开
8. **丢失占位**：手动删除一张已生成的图片文件，确认卡片显示「图片已丢失或删除」而非空白
9. **主界面同样生效**：在 OutputPanel 里重复第 8 步
10. **路径安全**：用 bridge invoke 调 `image.getImage` 传 `filePath: "C:\\Windows\\win.ini"`，确认被拒绝

---

## 七、已知天花板

- **目录路径不做归一化**：`D:/foo` 与 `D:\foo` 是两个组。真有反馈再加规范化。
- **记录只读**：Agent 记录不支持删除、不支持「加入参考图」。要的话后续加 `image.deleteAgentRecord`。
- **`records.json` 无上限**：长期使用会无限增长。目前不做清理策略。
