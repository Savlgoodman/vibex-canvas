---
summary: 为 VibeX 提供生图画板 Tab 和 Agent 生图 Skill，支持多协议（OpenAI、Grok、Gemini、Nano Banana）。
---

# vibex-canvas

VibeX 生图插件。在顶部工作区新增「生图画板」Tab，同时提供 Skill 供所有 Agent 调用生图。

## 功能

- **生图画板 Tab**：完整的生图工作区，支持多任务、多协议、参考图、遮罩编辑
- **Agent 生图 Skill**：任意 Agent 可通过 Skill 调用生图，指定输出目录
- **多协议支持**：OpenAI (GPT/Other)、Grok (xAI)、Gemini、Nano Banana (Google)
- **供应商统一管理**：在画板设置中配置供应商

## 开发

```bash
npm install          # 安装依赖
npm run dev          # 本地 Vite 开发服务器（仅 UI 调试）
npm run build        # TypeScript + Vite 构建
```

## 链接到 VibeX Host

```bash
# 1. 绑定 Host
npx @omnione/vibex plugin run server --http://127.0.0.1:<端口> --token <token>

# 2. 链接开发目录
npx @omnione/vibex plugin add --dev . -y

# 3. 启动 HMR 开发
npx @omnione/vibex plugin run dev
```

## 数据存储

- **供应商配置**：插件 `config.json`（通过 VibeX `storage.settings`）
- **任务与生成记录**：`~/.vibex/vibex-canvas/data.json`
- **生成图片**：`~/.vibex/vibex-canvas/images/`
- **Agent 生图**：写入 Agent 指定的 `outputDir`，记录存于 `~/.vibex/vibex-canvas/agent-records/`

## 卸载

删除插件后，`~/.vibex/vibex-canvas/` 目录不会自动清理，需手动删除。

## 排障

- 画板空白：确认 `vibex plugin run dev` 正在运行
- 生图失败：检查供应商配置的 API Key 和 Base URL 是否正确
- Skill 不可用：新开或 rebind 会话后生效

## 许可

MIT
