---
summary: 为 VibeX 提供生图画板 Tab 和 Agent 生图 Skill，支持多协议（OpenAI、Grok、Gemini、Nano Banana）。
---

# 生图画板（vibex-canvas）

一个为 VibeX 设计的 AI 图片生成插件。在工作区顶部新增「生图画板」Tab，提供完整的文生图、图生图工作流；同时通过 Skill 让所有 Agent 都能直接调用生图能力。

插件使用 VibeX 插件 SDK 2.0。`runtime/app.tsx` 由 `vibex-plugin build` 打包成 `app/main.js`，由 Host 创建 React 根节点；入口通过 `ctx.ui.registerTab` 和 `ctx.ui.registerView` 注册画板，Worker 调用统一走 `ctx.worker.invoke`。开发时先启动 VibeX Host，再在本项目运行 `npm run plugin:dev`（`npm run dev:plugin` 是同一命令的别名）。独立调试界面仍可使用 `npm run dev`。

## 生图画板

画板提供直观的生图工作区，支持：

- **文生图 / 图生图**：输入提示词即可生成，拖入参考图进行图生图
- **遮罩编辑**：精细控制参考图的作用区域
- **多任务管理**：任务列表支持归档、恢复，每次生成自动记录
- **多图对比**：同时生成多张图片时支持并排对比
- **实时预览**：生成过程可实时查看进度

## 多协议支持

一套界面，多种生图服务：

| 协议 | 服务商 |
|------|--------|
| OpenAI | GPT-Image / DALL-E / 其他兼容服务 |
| Grok | xAI |
| Gemini | Google AI |
| Nano Banana | Google Interactions |

在插件设置中配置供应商的 API 地址和密钥，画板会自动识别协议并适配请求格式。

## Agent 生图 Skill

安装插件后，所有 Agent（Claude Code、Codex 等）自动获得生图能力。直接告诉 Agent 你想要的图片，它会调用生图工具完成。

支持参数：`--provider`（供应商）、`--model`（模型）、`--size`（尺寸）、`--imageCount`（数量）

Agent 生成的图片会自动保存到插件存储目录，生成历史可在画板中查看。

## 数据存储

| 数据 | 位置 |
|------|------|
| 供应商配置 | 插件 `config.json` |
| 任务与生成记录 | `~/.vibex/vibex-canvas/data.json` |
| 生成图片 | `~/.vibex/vibex-canvas/images/` |
| Agent 生成图片 | `~/.vibex/vibex-canvas/agent-records/` |

## 许可

MIT
