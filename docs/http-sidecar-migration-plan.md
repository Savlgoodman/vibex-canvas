# 生图画板 HTTP Sidecar 改造计划

本文规划将生图画板从“Host 直接渲染 React Federation remote”迁移为“Federation 只负责创建 iframe，画布 UI 运行在插件自己的 HTTP sidecar 中”。目标是彻底隔离插件 React renderer 与 VibeX Host，同时保留 Worker bridge 和 Skill 调用能力。

## 1. 改造目标

改造完成后，渲染链路变为：

```text
VibeX Host
  └─ Federation remote mount（只操作 DOM）
       └─ iframe → http://127.0.0.1:<port>/
            └─ dist/app/index.html
                 └─ React 画布 UI
                      └─ sidecar bridge → Worker / Host capability
```

需要达到以下结果：

- Host 不再渲染画布的 React component，不再共享画布 React dispatcher。
- `pluginFederation.ts` 的 React root 卸载竞态不再影响画布 UI。
- Host 只保留一个轻量 remote view，remote 注册和 iframe 生命周期互相独立。
- 画布 UI 继续通过 `environment.invoke` 调用 Worker，不改变 Skill 的业务接口。
- 开发模式和打包模式使用同一套 App 入口，减少两套渲染路径的差异。

当前已实现第一阶段闭环：Worker 可以启动 loopback 静态 sidecar，remote 通过 iframe 和 `postMessage` 转发 bridge，Host 模式的任务状态改走 Worker `task.list/task.save`，配置保存不再携带任务数组。后续仍需补齐 sidecar 开发态热更新、旧 IndexedDB 惰性迁移和可选的 `app.surface` 入口。

## 2. 参考实现和边界

参考项目是 `D:\project\vibex-plugin-open-connector`：

- `src/views/view.tsx` 导出同步 `mount(root, environment)`。
- `mount` 只创建 iframe、占位内容和定时状态检查，不调用 `createRoot`。
- `runtime/app.mjs` 使用 `definePluginApp` 挂载真正的 App surface。
- manifest 同时声明 `app.tab` remote 和 `app.surface` `appEntrypoint: "app"`。

画布与参考项目的差异是：画布本身没有 Open Connector 那样的现成 sidecar origin，需要在 Worker 生命周期中启动本地 HTTP server，并通过状态 handler 把 origin 传给 remote。

## 3. 目标目录结构

```text
src/views/view.tsx       # 极小的同步 remote mount，只创建 iframe
runtime/worker.mjs       # Worker handler、sidecar 生命周期、状态
runtime/sidecar.mjs     # 本地 HTTP server 和静态文件服务
runtime/app.mjs          # definePluginApp，负责 bridge 注入和 App 挂载
runtime/app.html         # sidecar 的 HTML 入口模板
src/                     # React 画布源码，构建到 dist/app
dist/app/                # sidecar 提供的静态 App
```

`src/views/view.tsx` 不再导入 `App`、`react-dom/client` 或画布业务组件。画布 React 依赖只进入 `dist/app`。

## 4. Manifest 调整

保留 Worker 和 App entrypoint：

```json
{
  "entrypoints": {
    "worker": {
      "path": "dist/worker.mjs",
      "runtime": "node",
      "protocol": "1.1"
    },
    "app": {
      "root": "dist/app",
      "document": "index.html",
      "protocol": "1.0"
    }
  }
}
```

画布 Tab 继续使用 remote，但 remote 只负责 iframe：

```json
{
  "id": "canvas-tab",
  "kind": "app.tab",
  "handler": "surface.createSession",
  "remote": {
    "name": "vibexCanvas",
    "entry": "dist/remoteEntry.js",
    "module": "./view"
  }
}
```

如果需要在插件设置页或其他 Host surface 中复用画布，再增加独立的 `app.surface`：

```json
{
  "id": "canvas-settings",
  "kind": "app.surface",
  "slot": "plugin.detail.panel",
  "label": "生图画板",
  "appEntrypoint": "app",
  "handler": "surface.createSession",
  "allowedMethods": [
    "surface.createSession",
    "runtime.status",
    "config.get",
    "config.save",
    "image.generate"
  ]
}
```

`app.tab` 的 remote 和 `app.surface` 的 App 入口是两个接入点：前者负责嵌入主 Tab，后者由 Host 的 AppSurfaceHost 承载打包 App。不要让两个入口各自维护一套画布业务代码。

## 5. Sidecar 生命周期

Worker 需要维护一个 sidecar 状态机：

```text
stopped → starting → running
                  ↘ failed
running  → stopping → stopped
```

建议状态字段：

```ts
type SidecarStatus = {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  origin?: string;
  lastError?: string;
  pid?: number;
};
```

生命周期规则：

1. Worker `initialize` 阶段只准备状态，不启动 server。
2. 第一次 `runtime.status` 或 `surface.createSession` 时启动 sidecar。
3. 启动过程必须去重：并发调用共享同一个启动 Promise。
4. server 监听成功后才返回 `running` 和 origin。
5. Worker `dispose` 时关闭 server、清理 timer 和 child process。
6. sidecar 崩溃后状态变为 `failed`，下一次状态查询可以尝试一次重启。
7. 不把端口、PID 或临时 token 写入 `config.json`；它们属于运行时状态。

推荐 handler：

```text
runtime.status
runtime.statusText
runtime.restart
runtime.health
```

`runtime.status` 返回结构化状态，`runtime.statusText` 供 Host 状态栏显示，`runtime.restart` 手动重启 sidecar，`runtime.health` 供 Host service 定期检查。

## 6. HTTP server 设计

sidecar 只监听 loopback：

```text
127.0.0.1:<free-port>
```

不要监听 `0.0.0.0`，不要依赖固定端口。启动时由系统分配空闲端口，返回 origin 后 remote 再创建 iframe。

静态文件服务至少需要：

- `/` → `dist/app/index.html`
- `/assets/*` → `dist/app/assets/*`
- 只允许访问 `dist/app` 目录内的文件
- 拒绝 `..` 路径穿越、符号链接越界和任意文件读取
- 统一返回正确的 `Content-Type`
- 对不存在资源返回 404，不返回 Worker 错误页面
- 支持 `GET` 和 `HEAD`，其他方法返回 405

sidecar 不直接暴露供应商 API Key。图片生成、配置读取、模型查询等能力仍然通过 `bridge.invoke` 进入 Worker，再由 Worker 调用 Host capability。

## 7. Remote view 设计

`src/views/view.tsx` 应保持接近参考插件：

```ts
export function mount(root: HTMLElement, environment?: Environment) {
  let cancelled = false;

  const paint = async () => {
    const status = await environment?.invoke('runtime.status');
    if (cancelled) return;
    if (status?.state === 'running' && status.origin) {
      const frame = document.createElement('iframe');
      frame.title = '生图画板';
      frame.src = `${status.origin.replace(/\/$/, '')}/`;
      frame.style.cssText =
        'border:0;width:100%;height:100%;display:block;background:transparent;';
      root.replaceChildren(frame);
      return;
    }
    // 显示启动中或失败占位，不抛出 React error。
  };

  void paint();
  return () => {
    cancelled = true;
    root.replaceChildren();
  };
}
```

约束：

- `mount` 必须同步返回清理函数。
- 不导入 `App`、`react-dom/client` 或业务组件。
- 不创建 React root。
- iframe 不可用时显示局部占位状态，不触发整页刷新。
- 可以定时重试 `runtime.status`，但必须在 dispose 后停止 timer。
- 通过 `aria-label` 或 `title` 标识 iframe。

## 8. App bridge 设计

`runtime/app.mjs` 使用 `definePluginApp`：

```js
export default definePluginApp(async ({ root, bridge }) => {
  globalThis.__vibex_bridge = {
    invoke: (method, input) => bridge.invoke(method, input ?? null),
  };

  const dispose = mountCanvasApp(root);
  bridge.ready();

  return () => {
    dispose?.();
    delete globalThis.__vibex_bridge;
  };
});
```

实际 bridge 注入方式要以 SDK 的 `definePluginApp` 类型为准。App 不能直接读取 Worker 文件路径，也不能绕过 bridge 调用 Host Tauri API。

所有已有 handler 继续复用：

```text
config.get / config.save
task.list / task.save
image.generate
image.listProviders
image.fetchModels
image.testConnection
image.getImage
storage.saveImage / storage.loadImage / storage.deleteImage
```

Skill 调用仍然直接进入 Worker，不经过 iframe。sidecar 只改变 UI 的渲染隔离方式，不改变 Skill 的请求协议。

## 9. 开发模式

目标启动顺序：

```powershell
# 终端一：VibeX Host
cd D:\project\VibeX
pnpm run dev

# 终端二：插件链接开发
cd D:\project\vibex-canvas
npm run plugin:dev
```

开发模式需要确认：

- 只有一个 Host 和一个插件 CLI 进程。
- sidecar 端口变化后，remote 能重新读取 `runtime.status`。
- `dev-remote.json` 只记录 Federation remote 地址，不记录 sidecar token。
- App bundle 的源码变化由 Vite 处理；Worker/manifest 变化由 plugin-cli 发布新 generation。
- `config.json` 是运行时数据，plugin-cli watcher 必须忽略它，否则保存任务会触发 generation 发布和 UI 重挂载。
- 发生构建错误时显示插件局部错误，不调用 `window.location.reload()`。

## 10. 打包模式

打包时应保证：

1. `npm run build` 生成 `dist/app`。
2. `npm run build:plugin` 生成 Worker 和 Federation remote。
3. sidecar 使用 manifest 的 `app.root` 和 `app.document` 提供静态文件。
4. 不把 `config.json`、`.vibex-plugin/dev-remote.json`、日志和本地图片缓存打包进去。
5. `vibex-plugin validate` 检查 app、worker、remote 和 allowedMethods 的一致性。

## 11. 迁移步骤

### 阶段 A：准备 App 入口

- 把 `vite.config.ts` 的构建产物固定为 `dist/app`。
- 增加 `runtime/app.html` 和 `runtime/app.mjs`。
- 将当前 React App 的 bridge 注入移动到 `definePluginApp`。
- 确认 standalone Vite 页面和 App surface 都能显示画布。

### 阶段 B：实现 sidecar

- 新增 loopback HTTP server。
- 实现静态目录安全校验、端口分配和关闭逻辑。
- 增加 `runtime.status`、`runtime.restart`、`runtime.health`。
- 先用 curl 或浏览器验证 `/`、`/assets/*`、404 和路径穿越拒绝。

### 阶段 C：替换 remote view

- 删除 remote view 对 `App` 和 ReactDOM 的依赖。
- 改成同步 DOM mount + iframe。
- 增加 loading、failed、retry 占位。
- 验证 Host 卸载、StrictMode 和 generation 切换都只清理 iframe。

### 阶段 D：接入 manifest

- 保留 `app.tab` remote。
- 按需增加 `app.surface` `appEntrypoint: "app"`。
- 更新 allowedMethods 和 Worker handler 声明。
- 用 `vibex-plugin validate` 检查 manifest。

### 阶段 E：迁移数据和 Skill 验证

- 验证供应商配置、模型查询、连接测试。
- 验证遮罩、参考图和生成结果的 `file:`/storage marker。
- 验证任务切换不会取消 Worker 生图。
- 验证 Agent Skill 可以独立生成图片，不依赖 iframe 是否打开。

### 阶段 F：清理旧路径

- 删除 remote 中的 React root、React shared 兼容代码和 App 业务导入。
- 删除只服务旧 Federation root 的 fallback 逻辑。
- 保留一个统一的 `dist/app` App 入口和一个 Worker bridge。

## 12. 验收标准

- Host Console 不再出现 `dispatcher.getOwner`。
- Host Console 不再出现同步 React root 卸载 warning。
- 重新发布 generation、切换 Tab、StrictMode effect 重复执行时，页面只重建 iframe，不闪退、不整页刷新。
- sidecar 重启后 remote 能自动重新加载 iframe。
- Worker 不可用时显示局部错误，不让 Host AppErrorBoundary 接管整个页面。
- 任务、供应商、图片和 Skill 流程均通过现有 handler 验证。
- VibeX 工作区保持干净，插件运行时文件和 sidecar 状态不进入 Git。
