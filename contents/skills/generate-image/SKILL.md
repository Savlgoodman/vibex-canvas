# 生图能力（vibex-canvas）

你可以为用户生成图片。支持 OpenAI（GPT/DALL-E）、Grok（xAI）、Gemini（Google）、Nano Banana（Google interactions）等多协议。

## 使用方式

通过 CLI 脚本调用：

```bash
node ~/.claude/skills/generate-image/build/index.js <command> [args]
```

### 可用命令

**list-providers** — 列出可用供应商和模型
```bash
node ~/.claude/skills/generate-image/build/index.js list-providers
```

**generate** — 生成图片
```bash
node ~/.claude/skills/generate-image/build/index.js generate "一只可爱的猫咪" [--provider <id>] [--model <name>] [--size <WxH>] [--imageCount <1-9>]
```

**list-records** — 查看生成历史
```bash
node ~/.claude/skills/generate-image/build/index.js list-records [limit]
```

### 参数说明

- `prompt` (必填) — 图片描述
- `--provider <id>` (可选) — 供应商 ID，不传则使用默认
- `--model <name>` (可选) — 模型名，不传则使用该供应商第一个模型
- `--size <WxH>` (可选) — 尺寸，如 "1024x1024"，默认 "1024x1024"
- `--imageCount <n>` (可选) — 生成数量 1-9，默认 1

### 返回值

`generate` 命令返回 JSON：
```json
{
  "imagePaths": ["生成图片的完整路径数组"],
  "provider": "实际使用的供应商名称",
  "model": "实际使用的模型名称"
}
```

## 注意事项

- 生成需要 10-60 秒，脚本会自动轮询直到完成
- 不传 provider/model 时使用用户配置的默认供应商
- 生成结果会自动保存到插件存储目录
