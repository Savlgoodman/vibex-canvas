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

### Worker 返回本地图片路径

Worker 的 `image.generate` 可以返回已经保存到插件数据目录的本地路径，例如 `C:\\Users\\...\\images\\result.png`。这个路径不能直接作为 `<img src>`，也不能当作 data URL 传给 `Buffer.from` 或 `storage.saveImage`。

前端应保存为 `file:<绝对路径>` 标记，读取时通过 `image.getImage` 转成 data URL。直接使用 `file:///...` 会触发 WebView 的 `Not allowed to load local resource`。

## 6. Federation Remote 和 React 版本

### React 版本必须统一

曾经出现：

```text
Minified React error #527
args[]=19.2.8&args[]=19.3.1
```

原因是 Host 共享 React 19.2.8，但 remote 的 `react-dom/client` 子路径从插件项目的 `^19.2.8` 依赖解析成了 19.3.1。只 alias `react` 和 `react-dom` 主入口不够，`react/jsx-runtime`、`react/jsx-dev-runtime` 和 `react-dom/client` 也必须来自同一个版本。

当前 plugin-cli 的 Federation 配置会把这些子路径统一 alias 到 Host 使用的 React runtime。修改 plugin-cli 后必须重新构建：

```powershell
cd D:\project\VibeX\packages\plugin-cli
pnpm run build

cd D:\project\vibex-canvas
npm run build:plugin
```

如果浏览器仍显示旧版本错误，停止旧的 `vibex-plugin dev`，清理 `node_modules/.vite`，重新启动 Host 和插件 CLI。只刷新页面无法替换已经注册的 Federation remote。

### 不要直接把 remote React 组件交给 Host 渲染

直接让 Host 用自己的 React root 渲染插件 default component 会造成两套 React dispatcher，表现为：

- `t.jsx is not a function`
- `Cannot read properties of null (reading 'useEffect')`
- `Cannot read properties of null (reading 'useState')`

当前 remote 导出的是 `mount(root, environment)`，在 remote 自己的 runtime 中创建 root，并在 dispose 时卸载。Host 需要等待异步 `mount` 完成。remote 的 React 和 ReactDOM 必须由同一套 Federation 配置解析。

### `document.createElement(...).style` 与旧 bundle

ReactDOM 被 remote 提前加载时，旧 Federation VM 可能在 remote 注册阶段执行 DOM feature detection，出现 `Cannot read properties of null (reading 'style')`。当前实现把 `react-dom/client` 延迟到 `mount` 阶段加载。若仍出现这个错误，先确认浏览器加载的是新的 `dev-remote.json` 端口和新的 Vite chunk，而不是旧 dev server 或旧优化缓存。

### `remote already registered`

这是 Host 对同一个 remote 重复注册的警告，常见于 React StrictMode 的 effect 重复执行、旧 remote 未卸载或多个插件 CLI 进程同时运行。Host 现在对 register/unregister 串行化；开发者仍应保证同一个插件只运行一个 `plugin:dev`。

### 嵌入式 App 不要使用 `100vh`

**现象**：页面顶部内容正常，但中间参数栏向下溢出，底部按钮看不见，三栏也无法和 Host surface 的底部对齐。浏览器检查元素时，会看到插件中间区域高度超过左右区域。

**原因**：Federation remote 挂载在 Host 提供的 surface 容器中，插件的可用高度是父容器高度。`.app { height: 100vh; }` 会按整个窗口高度计算，超过实际 surface 高度。

**正确写法**：

```css
.app {
  height: 100%;
  min-height: 0;
}
```

外层布局还要保持 `flex: 1`、`min-height: 0` 和 `overflow: hidden`，需要滚动的参数区域单独设置 `overflow-y: auto`。底部操作按钮放在独立的 flex 区域，避免和参数内容共用滚动容器。

**排查方法**：检查 remote 根节点、`.app`、`.app-body`、`.workspace` 和三栏容器的实际高度；如果插件根节点高度正常而 `.app` 高于 Host surface，优先搜索并移除 `100vh`。

## 7. 开发验证清单

每轮修改后按这个顺序检查：

```powershell
cd D:\project\vibex-canvas
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

## 8. 参考路径

- 插件 manifest：[`.vibex-plugin/plugin.json](../.vibex-plugin/plugin.json)
- Worker 源码：[runtime/worker.mjs](../runtime/worker.mjs)
- Federation view：[src/views/view.tsx](../src/views/view.tsx)
- 插件 CLI Federation：`D:\project\VibeX\packages\plugin-cli\src\federationBuild.ts`
- SDK stdio 协议：`D:\project\VibeX\packages\plugin-sdk\src\stdio.ts`
- Host Worker 校验：`D:\project\VibeX\crates\plugins\src\worker_host.rs`
- Host surface 调用：`D:\project\VibeX\crates\plugins\src\app_surface.rs`
