# 存储与配置迁移计划

本文规划将生图画板从“Host settings + Worker 文件 + 浏览器 localStorage/IndexedDB 混用”迁移为清晰的单一职责存储架构。规划参考 `D:\project\vibex-plugin-open-connector`，并以当前 VibeX Host 实际可用的 capability 为准。

当前第一阶段已落地：Host bridge 模式通过 `task.list/task.save` 读写 Worker 任务数据，settings 只保存配置，sidecar/iframe bridge 已接入，参考图和遮罩继续通过 Worker storage handler 持久化，旧图片读取成功后会惰性写回 Worker storage。数据库 capability 仍按后续阶段执行。

## 1. 当前问题

画布当前存在四类存储路径：

| 当前路径 | 内容 | 问题 |
| --- | --- | --- |
| Host `storage.settings` / 根 `config.json` | 供应商、设置、任务、记录元数据 | 高频任务更新会修改 `config.json`，触发 plugin-cli generation 重发布和 remote 重挂载 |
| Worker `~/.vibex/vibex-canvas/data.json` | 任务、记录、Agent 记录 | 与 Host settings 中的任务形成两套来源 |
| 浏览器 IndexedDB | standalone 模式图片、历史 `idb:` 标记、遮罩和参考图 | Host 模式下 Worker 无法直接读取，旧标记会变成 `ERR_UNKNOWN_URL_SCHEME` 或空图片 |
| Worker 文件目录 | 生成图片和 Agent 图片 | 这是最适合 Host 模式的持久化路径，但当前只覆盖部分图片流程 |

当前 `saveConfig()` 会在任务生成、流式预览和记录更新时被调用。由于 plugin-cli 当前 watcher 没有忽略 `config.json`，任务变化可能触发 generation 更新，造成 remote 重挂载和页面闪动。

## 2. VibeX 提供的存储能力

### `storage.settings`

调用形式：

```js
await environment.host.call('storage', 'settings.get', {});
await environment.host.call('storage', 'settings.put', config);
```

Host 会按 manifest 的 `config.schema` 校验并写入该插件的 `config.json`。适合：

- 供应商列表和默认供应商；
- 用户主动修改的低频偏好；
- 配置 schema 版本和迁移标记。

不适合：

- 任务列表和生成记录；
- 流式预览；
- 每次生成都会变化的进度、缓存和图片索引。

### `storage.kv`

当前 Host 提供：

```text
storage.kv.get
storage.kv.put
storage.kv.delete
storage.kv.list
```

KV 按插件 ID 隔离，但当前实现是进程内存储。它适合短期运行状态、去重标记或小型缓存，不能在没有确认 Host 持久化实现前承担任务历史和用户数据。

### `storage.database`

SDK 测试 Host 提到了 `storage.database.execute/query`，文档也描述了插件隔离 SQLite 和 migrations；当前 VibeX Host broker 尚未提供可依赖的生产实现。迁移计划不能直接把 SQLite 当作现成能力，必须等 capability、schema migration 和 snapshot/rollback 合约稳定后再接入。

### `blob.*`

大二进制应使用：

```text
blob.create
blob.append
blob.finish
blob.read
blob.stat
blob.delete
```

当前 SDK 文档规定单次 append 不超过 512 KiB，单文件上限 4 GiB。图片 UI 的常规展示仍优先使用 Worker 文件路径和 `file:` 标记；只有需要跨 Worker/Host 传输的大型二进制才使用 blob，不能把完整 base64 塞进普通 JSON invoke。

### `secrets.*`

当前 Host 的 `secrets.get/put/delete` 仍是占位实现，不能依赖它保存供应商 Key。短期继续使用经过 manifest 校验的 settings；长期迁移到 secrets capability 后，API Key 只在 Worker 中读取，不能下发给 App 或写入日志。

## 3. Open Connector 的实际做法

Open Connector 的存储分层值得沿用：

1. 通过 `storage.settings.get` 读取低频配置，例如网络策略和可信 Host。
2. 根据 `VIBEX_HOST_DATA_DIR` 和插件 ID 计算 sidecar 专属数据目录：

   ```text
   <Host data root>/plugin-state/<pluginId>/
   ```

3. 在该目录保存 `runtime.json`、密钥和 sidecar 自己的持久化数据。
4. 秘密文件使用受限权限写入，不通过 App bridge 返回。
5. sidecar 启动前通过 `runtime.lock.get` 获取 Host 锁定的运行时 executable，不自行寻找或下载程序。
6. App 只通过 `definePluginApp` 的 generation-bound bridge 调 Worker。

它没有把业务状态放进浏览器 IndexedDB，也没有让 App 直接访问 Host 文件路径。

## 4. 目标存储分层

| 数据 | 唯一来源 | 目标读写方式 | 原因 |
| --- | --- | --- | --- |
| 供应商、默认供应商、UI 偏好 | Host settings | `config.get/save` → `storage.settings.get/put` | 由 Host 校验、按插件隔离 |
| 配置 schema 版本 | Host settings | 和配置一起迁移 | 支持升级和回滚 |
| 任务和生成记录元数据 | Worker data store | `task.list/save` | 高频变化，不触发 Host generation |
| 生成图片 | Worker/plugin data dir | `storage.saveImage/loadImage` 或 `image.getImage` | 文件系统适合大对象，避免 JSON 帧 |
| 参考图和遮罩 | Worker/plugin data dir | 同上，使用安全 key | Host 与 sidecar 都能读取 |
| Agent 生成记录 | Worker data store | `image.listAgentRecords` 等 handler | 与 Skill 生命周期一致 |
| Agent 输出图片 | Agent 指定 `outputDir` | Worker 直接写文件 | 结果需要交给 Agent 或外部流程 |
| sidecar runtime 状态 | sidecar data dir | `runtime.json` 或内存状态 | 不属于用户配置 |
| sidecar secrets | sidecar data dir / future secrets capability | Worker/sidecar 内部读取 | 不进入 App 和普通日志 |
| 临时预览和请求队列 | 内存 | Zustand/Worker 内存 | 重启后丢弃，避免污染持久数据 |
| 浏览器 IndexedDB | 仅 standalone 兼容层 | 不作为 Host 模式来源 | 避免 `idb:` marker 与 Worker 脱节 |

目标原则是：一个数据类型只有一个持久来源。浏览器 IndexedDB 只保留给 `npm run dev` 的独立 UI fallback，不参与 VibeX Host 模式。

## 5. 画布迁移后的 Worker API

任务 API 保持现有 handler，但改变内部来源：

```text
task.list   → storage.readData()
task.save   → storage.writeData()
```

图片 API 统一使用文件 marker：

```text
image.generate → 返回 imagePaths
image.getImage → 读取绝对路径并返回短期 data URL
storage.saveImage/loadImage/deleteImage → 参考图、遮罩和历史图片
```

Worker 需要保证：

- `data.json` 写入采用临时文件加 rename，避免生成过程中损坏；
- 图片文件 key 经过平台安全化，不能把 `recordId:mask` 直接作为 Windows 文件名；
- 读取兼容历史 `idb:<id>:img:<n>`、`idb:<id>:thumb`、`idb:<id>:mask` 映射；
- 删除任务时同时删除记录引用的图片和缩略图；
- image path 不通过普通 JSON 反复传输 base64；
- Agent 输出目录必须经过边界校验，不能让任意参数覆盖插件数据目录。

## 6. 配置迁移

### 配置 schema

将 manifest config 收敛为低频配置：

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "type": "integer", "minimum": 1 },
    "providers": { "type": "array" },
    "defaultProviderId": { "type": ["string", "null"] },
    "settings": { "type": "object" }
  }
}
```

`tasks`、`records`、`imageUrls` 和 `partialPreviews` 不再放进 settings schema。

### 一次性迁移

Worker 或 App 首次启动时按以下顺序执行幂等迁移：

1. 读取 Host settings；
2. 如果发现旧 `tasks`，写入 Worker `data.json`；
3. 将旧记录中的图片 marker 转换为 Worker 文件引用；
4. 保存只包含 providers/defaultProviderId/settings 的新 settings；
5. 写入 `schemaVersion` 和 migration marker；
6. 迁移成功后不再从 settings 读取任务。

迁移不能在每次 render 或每次 generation 中重复执行，必须有版本号和锁。

## 7. IndexedDB 迁移和兼容

### 新流程

Host bridge 存在时：

- 新参考图和遮罩直接调用 `storage.saveImage`；
- 新生成结果由 Worker 写入图片目录；
- 前端只保存 `file:` marker 或 Worker record key；
- `useImageUrl` 解析 marker，不能直接把 `idb:` 交给 `<img>`。

### 旧数据

旧浏览器 IDB 数据不能由 Worker 直接读取。迁移采用惰性策略：

1. App 检测到旧 `idb:` marker；
2. standalone 模式从 IndexedDB 读取；
3. Host 模式先请求 Worker；若不存在，再尝试浏览器 IndexedDB；
4. 读取成功后调用 `storage.saveImage` 写入 Worker；
5. 将 record marker 更新为 Worker/file marker；
6. 所有步骤可重复，失败只记录局部错误，不刷新页面。

如果图片超过普通 Worker 帧限制，迁移应改走 `blob.*` 或提示用户重新上传，不能拼装自定义分片协议。

## 8. sidecar 和存储的关系

HTTP sidecar 只负责 UI 和本地 HTTP 服务，不应该成为第二个任务数据库。推荐：

- sidecar 通过 `bridge.invoke` 调 Worker；
- Worker 负责 Host settings、任务、图片和 Skill 数据；
- sidecar 目录只保存运行时 token、加密密钥、sidecar 自己的缓存和 `runtime.json`；
- sidecar 需要读取配置时调用 Worker 的 `config.get`，由 Worker 调 Host `storage.settings.get`；
- sidecar 不读取插件根目录的 `config.json`，不直接读 `~/.vibex` 的 Host 文件。

## 9. 实施阶段

### 阶段 A：冻结来源

- 明确 settings 只保存 providers/defaultProviderId/settings；
- 给 config 增加 schemaVersion；
- 禁止新代码写浏览器 IndexedDB（保留 standalone fallback）。

### 阶段 B：Worker 数据层

- 增加任务数据版本和原子写入；
- 统一图片 key 和平台安全文件名；
- 补齐 reference/mask 的 save/load/delete；
- 为任务删除增加完整图片清理。

### 阶段 C：前端 bridge

- `useStore` 的任务和记录持久化改走 `task.save`；
- 配置保存只在 provider/settings 修改时触发；
- 生成中间状态只放内存；
- 所有图片 marker 统一经过 `useImageUrl`。

### 阶段 D：旧数据迁移

- 迁移 settings 中的旧 tasks；
- 惰性迁移 IndexedDB 的图片和遮罩；
- 迁移成功后清理旧 marker，但保留可重试记录。

### 阶段 E：sidecar App 接入

- `definePluginApp` 只通过 bridge 访问 Worker；
- sidecar 不持有任务来源；
- 验证 sidecar 重启、Worker 重启和 Host 重启后的数据一致性。

## 10. 验收标准

- Host settings 只包含配置，不包含任务数组、生成记录和图片数据。
- 保存任务或生成进度不会修改 `config.json`，不会触发 generation 重发布。
- Host 模式不再依赖 IndexedDB 才能读取新遮罩和参考图。
- 清理任务会清理 Worker 元数据和图片文件，不影响供应商配置。
- 重启 Host、Worker 或 sidecar 后任务和供应商数据仍可恢复。
- Skill 生成结果与 UI 任务使用同一 Worker 数据层。
- 浏览器 IndexedDB 失效时，Host 模式仍能正常工作。
- 大图片不进入普通 JSON 帧，超过限制时使用文件或 blob。
