# VibeX 插件开发流程与踩坑记录

本文记录 `vibex-canvas` 在 VibeX Host 中进行链接开发、Federation 调试和 Worker 调用时的实际流程。Host 源码位于 `D:\project\VibeX`，插件源码位于 `D:\project\vibex-canvas`。

## 1. 开发方式与启动顺序

开发时使用一套 Host 和一套插件 CLI：

```text
VibeX Host（Tauri + Rust 服务）
        ↑ plugin_control / Worker / surface bridge
插件 CLI（链接开发 + Worker build + Federation HMR）
        ↑
vibex-canvas
```

插件目录里的普通 `npm run dev` 只是独立 Vite 页面，只适合不依赖 VibeX bridge 的 UI 调试。要在 VibeX 页面中实时加载 Federation remote，必须使用插件 CLI。

推荐启动顺序：

```powershell
# 终端一：先启动 Host
cd D:\project\VibeX
pnpm run dev

# 等 VibeX 窗口和 Host 服务完全启动后，终端二启动插件
cd D:\project\vibex-canvas
npm run plugin:dev
```

`npm run dev:plugin` 仍然可用，它和 `npm run plugin:dev` 是同一个命令。`plugin:dev` 会执行：

1. 构建并校验插件；
2. 通过 Host 导入并启用 developer link；
3. 启动 Federation Vite dev server；
4. 写入 `.vibex-plugin/dev-remote.json`；
5. 监听源码变化，重新构建并发布新的 Worker generation。

不要在同一个插件上同时运行两个 `vibex-plugin dev`，也不要在 `plugin:dev` 运行期间再次执行旧的 `install --link` 或设置页面里的链接开发。它们都使用同一个插件 ID，容易留下旧 generation、旧 remote 端口和旧 Vite 缓存。

## 2. Host 绑定与 `fetch failed`

`vibex-plugin dev` 启动时会调用 Host 的 plugin API。如果 Host 尚未启动，或者 `~/.vibex/pluginrc` 中保存了失效的 URL/token，就会看到：

```text
fetch failed
```

检查 Host 端口和 CLI 会话：

```powershell
Test-NetConnection 127.0.0.1 -Port 17891
Get-Content "$env:USERPROFILE\.vibex\pluginrc"
```

如果旧进程仍在运行，先停止 Host 和插件 CLI，再删除生成文件后重新启动：

```powershell
cd D:\project\vibex-canvas
Remove-Item .vibex-plugin\dev-remote.json -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse node_modules\.vite -Force -ErrorAction SilentlyContinue
```

`dev-remote.json` 是运行时生成文件，不应提交到 Git。`~/.vibex/imports/links.jsonl` 是 Host 未运行时排队的旧链接记录；清理前先备份，避免误删其他插件的链接。

插件运行时的 `config.json` 也不属于源码。供应商、任务和生成记录会写入它；plugin-cli 的 dev watcher 必须忽略这个文件，否则每次保存配置都会重新发布 Worker generation，让当前 surface 变 stale 并触发反复重载。

## 3. SDK 和 CLI 规范应该去哪里查

不要根据旧插件、压缩后的 `dist` 文件或猜测来写协议。优先级如下：

1. `D:\project\VibeX\docs\plugins\developer-guide.md`：开发流程、manifest、贡献点和诊断方式。
2. `D:\project\VibeX\docs\plugins\sdk-and-cli.md`：SDK、Worker/App 协议和 CLI 合约。
3. `D:\project\VibeX\packages\plugin-sdk\src`：SDK 的真实类型和调用签名。
4. `D:\project\VibeX\packages\plugin-cli\src`：build、validate、dev 和 Federation 配置的真实实现。
5. `D:\project\VibeX\crates\plugins\src`：Host 对 Worker、surface、handler 和 capability 的最终校验。

先查看工具链：

```powershell
vibex-plugin toolchain
vibex-plugin --help
vibex plugin --help
```

查找具体规范时使用源码搜索：

```powershell
rg -n "host\.call|registrar\.handle|allowedMethods|entrypoints|remote" `
  D:\project\VibeX\packages\plugin-sdk\src `
  D:\project\VibeX\packages\plugin-cli\src `
  D:\project\VibeX\crates\plugins\src
```

例如，`environment.host.call` 的签名直接定义在 `packages/plugin-sdk/src/stdio.ts`：

```ts
call(capability: string, operation: string, input?: JsonValue)
```

因此配置读取必须写成：

```js
await environment.host.call('storage', 'settings.get', {});
await environment.host.call('storage', 'settings.put', config);
```

不能把完整操作名拼成一个参数。

## 4. Worker 规范

Node Worker 的入口通常是：

```text
runtime/worker.mjs  # definePluginWorker，注册 handler
runtime/main.mjs    # runStdioPluginWorker，启动协议循环
dist/worker.mjs     # vibex-plugin build 生成
```

manifest 至少要声明：

```json
{
  "entrypoints": {
    "worker": {
      "path": "dist/worker.mjs",
      "runtime": "node",
      "protocol": "1.1"
    }
  }
}
```

Worker 生命周期是 `initialize` → `activate` → `invoke` / `ping` / `dispose`。setup 阶段只注册 handler，不要在模块加载时执行需要 Host capability 的操作。

每一个 Worker handler 都必须在 manifest 的 integration 中声明，且前端通过 bridge 调用的名称必须出现在 `allowedMethods` 中。否则候选 generation 会因 `handler_undeclared` 或 `handler_required_missing` 被拒绝。

```js
registrar.handle('config.get', async () => {
  return environment.host.call('storage', 'settings.get', {});
});

registrar.handle('config.save', async (config) => {
  await environment.host.call('storage', 'settings.put', config);
  return { ok: true };
});
```

handler ID 必须符合：

```text
^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]*)*$
```

## 5. 这次遇到的 Worker 失败

### `App surface Worker is unavailable`

这个错误说明页面 remote 已经挂载，但 Host 没有可用的 Worker generation。常见原因是 Worker 在 activate 后崩溃。

这次 Host 诊断返回：

```json
{
  "workerRunning": false,
  "recentCrashes": [
    { "message": "host.call has no operation" }
  ]
}
```

原因是错误地写成了：

```js
environment.host.call('storage.settings.get');
```

Worker 第一次调用配置接口时立即退出，于是页面还能显示，所有功能调用却都返回 Worker unavailable。修正 capability、operation、input 三个参数后，Host 诊断恢复为：

```json
{
  "workerExpected": true,
  "workerRunning": true
}
```

排查时优先看「设置 → 插件 → 运行状况」中的 Worker 状态、最近崩溃和日志；也可以使用 `vibex-plugin doctor`，或者调用 Host 的 `plugin_control_diagnostics` / `plugin_control_logs`。

### surface 会话过期或 generation 过期

下面这些错误表示 surface 会话已经不能继续使用：

```text
App surface capability token expired
App surface session is revoked
App surface contribution generation is stale
```

常见触发原因是插件配置或源码变化后，plugin-cli 发布了新的 generation，而旧页面仍持有旧 token。先关闭并重新打开插件 Tab；如果仍然存在，完整重启 VibeX 和 `plugin:dev`。不要在前端无限重试旧 token，也不要把 token 保存到 `config.json`。

### Worker 返回本地图片路径

Worker 的 `image.generate` 可以返回已经保存到插件数据目录的本地路径，例如 `C:\\Users\\...\\images\\result.png`。这个路径不能直接作为 `<img src>`，也不能当作 data URL 传给 `Buffer.from` 或 `storage.saveImage`。

前端应保存为 `file:<绝对路径>` 标记，读取时通过 `image.getImage` 转成 data URL。直接使用 `file:///...` 会触发 WebView 的 `Not allowed to load local resource`。

历史记录中的 `idb:<recordId>:img:<index>`、`idb:<recordId>:thumb` 和 `idb:<recordId>:mask` 也不能直接放进 `<img src>`。统一先经过 store 的图片解析逻辑；Host Worker 找不到旧 IDB 数据时回退浏览器 IndexedDB。否则会出现 `ERR_UNKNOWN_URL_SCHEME`，遮罩 effect 失败后参数面板可能短暂重排。

在 Host bridge 模式下，新生成记录的参考图和遮罩必须通过 `storage.saveImage` 持久化，不能因为 Worker 已经负责生成结果文件就全部跳过。Windows 文件名不能包含 `:`，Worker 保存这类逻辑 key 时要先转换为安全文件名，并在读取时兼容原始 key 和历史文件名。

### Worker 协议帧大小

Worker 调用不是无限大小的 IPC 通道。旧 Host 曾有约 1 MiB 的单帧限制，最新 VibeX 已将 Worker 单帧上限提升到 32 MiB，但插件仍不应把大图片 base64 在多个 handler 间来回传递。优先传文件路径、记录 ID 或短的 `file:` 标记，需要展示时再调用 `image.getImage`。

遇到下面的错误时，先判断是否把完整图片放进了 Worker 请求或响应：

```text
Worker protocol frame exceeded the limit
The first argument must be of type ...Array or an Array-like Object. Received undefined
```

检查方式：

```powershell
rg -n "MAX_FRAME_BYTES|frame exceeded|worker protocol" D:\project\VibeX\crates D:\project\VibeX\packages
```

不要为了绕过帧限制直接修改本地 VibeX 源码；先确认 Host 版本，再按路径标记和延迟读取方式缩小协议 payload。

## 6. Federation Remote 和 React 版本

### React 版本和实例必须统一

曾经出现：

```text
Minified React error #527
args[]=19.2.8&args[]=19.3.1
```

以及：

```text
dispatcher.getOwner is not a function
Cannot read properties of null (reading 'useEffect')
Cannot read properties of null (reading 'useState')
```

这些错误都应先按“React 版本或 React 内部实例不一致”排查。当前 Host 和插件锁定 React `19.2.8`，插件 `package.json` 使用精确版本，不能使用 `^19.2.8` 让 npm 自动升级。`react`、`react-dom`、`react-dom/client`、`react/jsx-runtime` 必须由同一套 Federation shared runtime 提供。

检查实际安装版本：

```powershell
node -e "console.log(require('./node_modules/react/package.json').version, require('./node_modules/react-dom/package.json').version)"
```

修改 plugin-cli 或 Host 后必须重新构建工具链，再构建插件：

```powershell
cd D:\project\VibeX\packages\plugin-cli
pnpm run build

cd D:\project\vibex-canvas
npm run build:plugin
```

不要在 manifest 的 remote 中写 `shared: false`。这会让插件带入独立 React，最终表现为 hooks dispatcher、JSX runtime 或 ReactDOM renderer 不匹配。

### Remote view 的正确形态

参考 `D:\project\vibex-plugin-open-connector`，React remote 应导出 default view，由 Host 的 `mountRemoteModule` 创建 React root：

```tsx
export default function CanvasView({ environment }) {
  // 设置 bridge，返回 React element
  return createElement(App);
}
```

不要在 remote 内再次调用 `createRoot`，不要导出异步 `mount` 来创建自己的 React root。两套 renderer 即使版本号相同，也可能持有不同的 dispatcher，触发 `dispatcher.getOwner` 或 hooks 为 null。

当前 plugin-cli 可能使用 classic JSX transform。若 remote 依赖 JSX，必须确认生成 bundle 中存在可用的共享 React 绑定；当前入口保留了共享 React 的兼容处理。将来 plugin-cli 改为 automatic JSX runtime 后，先检查生成产物再删除兼容代码。

### Remote 注册和旧 bundle

```text
[ Federation Runtime ]: The remote "vibexCanvas" is already registered
```

这通常不是插件业务错误，常见原因是旧 dev server、两个 `plugin:dev` 进程、StrictMode 重复 effect、旧 remote 未卸载，或 Host 进程内已经缓存了旧注册。处理顺序：

1. 完全退出 VibeX；
2. 停止旧的 `vibex-plugin dev`；
3. 删除 `.vibex-plugin/dev-remote.json` 和 `node_modules/.vite` 缓存；
4. 先启动 Host，再运行 `npm run plugin:dev`。

只刷新页面不能清掉 Host 进程内的 Federation registry。若页面已经正常挂载而只剩一次 warning，优先确认是否仍有重复 CLI 进程。

### 嵌入式 App 的高度和样式

Federation remote 挂载在 Host 提供的 surface 容器中，可用高度来自父容器，不是浏览器窗口高度。`.app { height: 100vh; }` 会导致中间参数区域超出左右栏，底部生成按钮消失。

```css
.app {
  height: 100%;
  min-height: 0;
}
```

外层布局保持 `flex: 1`、`min-height: 0` 和 `overflow: hidden`；参数区域单独 `overflow-y: auto`；底部操作区放在独立 flex 区域。颜色、边框和遮罩继续使用 `src/index.css` 的全局变量，避免 Host 样式覆盖插件主题。

## 7. 开发验证清单

每轮修改后按这个顺序检查：

```powershell
cd D:\project\vibex-canvas
npm run build
npm run build:plugin
vibex-plugin validate
```

然后：

1. 确认 VibeX Host 正在运行；
2. 确认只有一个 `npm run plugin:dev`；
3. 在 VibeX 中重新打开插件 Tab；
4. 查看浏览器 Console 是否有 `[PluginRemoteView] remote mount failed`；
5. 在插件设置中读取配置、测试供应商连接、获取模型；
6. 检查 Host 的 Worker 是否仍为 `workerRunning: true`；
7. 修改源码后确认 generation 重新发布，旧 surface 会话必要时重新打开。

## 8. 开发规范速查

每次新增或修改插件能力时，按下面顺序确认：

1. 先看 Host 的 `docs/plugins/developer-guide.md` 和 `sdk-and-cli.md`，再看 SDK 类型和 Host 最终校验；不要从旧 dist 或其他插件的压缩产物猜协议。
2. 先改 manifest，再实现 Worker handler 和前端调用；`allowedMethods`、handler 注册名、surface 类型和 entrypoint 必须彼此对应。
3. 所有 Host capability 调用保持 `host.call(capability, operation, input)` 三段形式；例如 `host.call('storage', 'settings.get', {})`。
4. React remote 固定 Host 版本、使用 shared singleton、由 Host 渲染 default view；不自行创建 React root，不使用 `shared:false`。
5. 远程页面只使用 surface 父容器高度；布局问题先检查根节点、`.app`、`.app-body` 和三栏的实际高度，再检查 `min-height: 0` 与滚动边界。
6. Worker 返回图片路径，前端用 `file:` 标记和 `image.getImage` 读取；不要直接加载 `file://`，不要让大 base64 成为常规协议字段。
7. 每次 dev 变更只保留一个 Host、一个插件 CLI；旧 remote 注册、旧 generation 和旧缓存必须通过完整重启清理。
8. 构建后检查 `git status`：插件构建可能更新本地 plugin-cli 的 dist，Host 源码必须保持干净；任何 Host 改动都要先确认来源再恢复。

## 9. 参考路径

- Sidecar 改造计划：[http-sidecar-migration-plan.md](./http-sidecar-migration-plan.md)
- 存储与配置迁移计划：[storage-and-config-migration-plan.md](./storage-and-config-migration-plan.md)
- 插件 manifest：[`.vibex-plugin/plugin.json](../.vibex-plugin/plugin.json)
- Worker 源码：[runtime/worker.mjs](../runtime/worker.mjs)
- Federation view：[src/views/view.tsx](../src/views/view.tsx)
- 插件 CLI Federation：`D:\project\VibeX\packages\plugin-cli\src\federationBuild.ts`
- SDK stdio 协议：`D:\project\VibeX\packages\plugin-sdk\src\stdio.ts`
- Host Worker 校验：`D:\project\VibeX\crates\plugins\src\worker_host.rs`
- Host surface 调用：`D:\project\VibeX\crates\plugins\src\app_surface.rs`
