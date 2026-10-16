# vibex-canvas 架构

## 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    VibeX Host                        │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ 看板 Tab │  │ 工作区   │  │ 生图画板 Tab     │  │
│  │          │  │          │  │ (app.tab)        │  │
│  └──────────┘  └──────────┘  └────────┬─────────┘  │
│                                        │            │
│  ┌─────────────────────────────────────┼─────────┐  │
│  │              Worker (Node.js)       │         │  │
│  │                                     │         │  │
│  │  bridge.invoke ◄────────────────────┘         │  │
│  │       │                                       │  │
│  │       ├─ config.get / config.save             │  │
│  │       ├─ task.list / task.save                │  │
│  │       ├─ image.listProviders                  │  │
│  │       ├─ image.generate ──► protocols/*       │  │
│  │       ├─ image.listRecords                    │  │
│  │       └─ image.listAgentRecords               │  │
│  │                                               │  │
│  │  storage.settings ◄── config.json             │  │
│  │  node:fs ◄── ~/.vibex/vibex-canvas/           │  │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Agent Sessions                              │   │
│  │  ┌─────────────────────┐                    │   │
│  │  │ Skill: generate-image│                   │   │
│  │  │ → bridge.invoke     │                    │   │
│  │  └─────────────────────┘                    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 数据流

### 手动生图（Tab UI）

```
用户操作 UI
  → store (Zustand)
    → bridge.invoke('image.generate', params)
      → Worker handler
        → protocols/*.mjs (HTTP 请求)
          → API 返回 data URL
        → node:fs 写入 ~/.vibex/vibex-canvas/images/
        → 返回 imagePaths
      → store 更新记录
    → UI 展示图片
```

### Agent 生图（Skill）

```
Agent 调用 Skill
  → bridge.invoke('image.generate', { prompt, outputDir, ... })
    → Worker handler
      → protocols/*.mjs (HTTP 请求)
        → API 返回 data URL
      → node:fs 写入 outputDir（或 ~/.vibex/vibex-canvas/images/）
      → agent-records/records.json 记录
      → 返回 { imagePaths, recordId }
    → Agent 拿到结果
```

## 存储分层

| 数据类型 | 存储位置 | 读写方式 |
|---|---|---|
| 供应商配置 | `config.json` | `storage.settings.get/put` |
| 全局设置 | `config.json.settings` | `storage.settings.get/put` |
| 任务列表 | `~/.vibex/vibex-canvas/data.json` | `node:fs` |
| 手动生成记录 | `data.json` 内 `tasks[].records[]` | `node:fs` |
| 手动生成图片 | `~/.vibex/vibex-canvas/images/` | `node:fs` |
| Agent 生成记录 | `~/.vibex/vibex-canvas/agent-records/records.json` | `node:fs` |
| Agent 生成图片 | Agent 指定的 `outputDir` | `node:fs` |

## 协议适配器

Worker 端的 `runtime/protocols/` 从 super-canvas 迁移，核心改动：
- TypeScript → `.mjs`
- 去掉 `proxyUrl()` 包装，`fetch()` 直连 API
- `dataURLtoBlob()` → `dataUrlToBuffer()`（用 `node:buffer`）

支持的协议：

| 协议 ID | 标签 | API 路径 | 特殊能力 |
|---|---|---|---|
| `gpt` | GPT | `/v1/images/generations` 或 `/v1/images/edits` | SSE 流式、遮罩、16 张参考图、透明背景 |
| `other` | 其他 | 同 GPT | 同上，无自动能力检测 |
| `grok` | Grok | `/v1/images/generations` | 宽高比、分辨率、5 张参考图 |
| `gemini` | Gemini | `/v1beta/openai/images/generations` | 不发送参考图 |
| `nano-banana` | Nano Banana | `/v1beta/interactions` | Google interactions API、思考等级 |

## 目录结构

```
vibex-canvas/
├─ .vibex-plugin/          # 插件清单
│  ├─ plugin.json          # integrations、entrypoints
│  └─ content.index.json   # 内容索引
├─ config.json             # 供应商配置（初始空）
├─ contents/
│  └─ skills/
│     └─ generate-image/
│        └─ SKILL.md       # Agent 技能说明
├─ runtime/                # Worker 端（Node.js）
│  ├─ worker.mjs           # definePluginWorker + handlers
│  ├─ main.mjs             # runStdioPluginWorker 入口
│  ├─ storage.mjs          # 文件系统存储层
│  ├─ imageService.mjs     # 生图业务逻辑
│  ├─ rateLimit.mjs        # 速率限制
│  ├─ modelCaps.mjs        # 模型能力检测
│  └─ protocols/           # 协议适配器
│     ├─ http.mjs          # HTTP 工具（直连）
│     ├─ gpt.mjs           # GPT/Other
│     ├─ grok.mjs          # Grok
│     ├─ gemini.mjs        # Gemini
│     ├─ nanoBanana.mjs    # Nano Banana
│     └─ registry.mjs      # 注册表 + panelSpec
├─ src/                    # Tab 页面（React）
│  ├─ App.tsx              # 根组件
│  ├─ store/               # Zustand store
│  ├─ services/            # API、IDB、速率限制
│  ├─ protocols/           # 浏览器端协议（待废弃，统一走 Worker）
│  ├─ components/          # UI 组件
│  └─ ...
├─ dist/                   # 构建输出
└─ package.json
```

## 待迁移项

当前 `src/` 里的代码仍使用 localStorage + IndexedDB。后续需要：

1. **store 层**：`useStore.ts` 的持久化从 `localStorage` 改为 `bridge.invoke('task.list/save')`
2. **API 层**：`services/api.ts` 的 `generateImage()` 改为 `bridge.invoke('image.generate')`
3. **图片加载**：`useImageUrl.ts` + `services/idb.ts` 改为 `bridge.invoke('image.getImage')`
4. **fetchModels / testConnection**：改为 `bridge.invoke('image.fetchModels')` / `bridge.invoke('image.testConnection')`
5. **src/protocols/**：浏览器端协议适配器可删除，统一由 Worker 端处理
