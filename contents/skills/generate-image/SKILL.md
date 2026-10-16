# 生图能力（vibex-canvas）

你可以为用户生成图片。支持 OpenAI（GPT/DALL-E）、Grok（xAI）、Gemini（Google）、Nano Banana（Google interactions）等多协议。

## 可用操作

### 1. 查询可用供应商和模型

调用 Worker handler: `image.listProviders`

无需参数。

返回:
```
{
  providers: [
    {
      id: "供应商ID",
      name: "供应商名称",
      protocol: "gpt|grok|gemini|nano-banana|other",
      models: [{ id: "模型ID", name: "模型名称" }],
      isDefault: true/false
    }
  ],
  defaultProviderId: "默认供应商ID或null"
}
```

### 2. 生成图片

调用 Worker handler: `image.generate`

参数:
- `prompt` (必填, string) — 图片描述
- `providerId` (可选, string) — 供应商 ID，不传则使用默认供应商
- `model` (可选, string) — 模型名，不传则使用该供应商第一个模型
- `size` (可选, string) — 尺寸，如 "1024x1024"，默认 "1024x1024"
- `quality` (可选, string) — 质量等级（如 "high"、"medium"、"low"）
- `outputFormat` (可选, string) — png | jpeg | webp，默认 png
- `background` (可选, string) — auto | opaque | transparent，默认 auto
- `imageCount` (可选, number) — 1-9，默认 1
- `outputDir` (可选, string) — 输出到指定目录，不传则存到插件内部存储
- `referenceImages` (可选, string[]) — 引用图片的 data URL 或 base64 数组
- `protocolOptions` (可选, object) — 协议特定参数（如 aspect_ratio 等）

返回:
```
{
  imagePaths: ["生成图片的完整路径数组"],
  recordId: "生成记录ID",
  provider: "实际使用的供应商名称",
  model: "实际使用的模型名称"
}
```

### 3. 获取生成历史

调用 Worker handler: `image.listRecords`

参数:
- `limit` (可选, number) — 返回条数，默认 20

返回: 生成记录列表，每条包含 prompt、provider、model、imagePaths、createdAt。

## 默认行为

不传 `providerId` 和 `model` 时，自动使用用户在设置中配置的默认供应商和该供应商的第一个模型。如果没有任何供应商配置，返回错误提示用户先配置供应商。

## 注意事项

- 生成可能需要 10-60 秒，取决于模型和尺寸
- 不同供应商支持的参数不同，handler 会自动适配协议差异
- 透明背景仅部分模型支持（如 gpt 协议的 sunburst/flare 模型）
- 批量生成（imageCount > 1）会并发请求，受全局速率限制约束
