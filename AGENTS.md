# Agent 协作规范

## 提交

每完成一个小功能或一轮明确的更新，就提交一次。不要把无关改动堆进同一个提交。

提交说明使用：

```
feat: 用一句话说明这次做了什么
```

正文可以补一句原因或范围。不要提交 `node_modules`、`dist`、密钥或本地图片缓存。

## 分层

- `src/types` 只放数据形状和常量。
- `src/protocols` 放各协议的单张请求，不引用界面组件。
- `src/services` 放调度、存储和纯函数，不引用界面组件。
- `src/store` 放跨任务仍然要继续的状态。生成请求从这里发出，切换任务不能取消它。
- `src/hooks` 放可复用的视图逻辑。
- `src/components` 放界面。能复用的放在 `components/ui`。
- `runtime/` 放 Worker 端代码（Node.js），协议适配器、存储层、handler 定义。
- `contents/skills/` 放 Skill 描述文件。

不要在 `src` 下留下 `.js` 编译产物。Vite 会优先解析 `.js`，从而盖住 `.tsx`。

## 样式

颜色、圆角、遮罩和格子背景使用 `src/index.css` 里的全局变量，例如 `--bg`、`--accent`、`--overlay`、`--checker-light`。不要在组件里新写一套色值。

界面文案使用中文。模型名、尺寸值和接口地址保持原样。

## 改动范围

只改当前任务需要的文件。新功能先接现有的 store 和组件，不要为一次界面调整再包一层框架。

改了可见界面后，在浏览器里点通受影响的流程，再提交。

## VibeX 插件硬性约束

- `npm run dev` 只用于独立 UI 调试；连接 VibeX 必须先启动 Host，再运行 `npm run plugin:dev`（`npm run dev:plugin` 是别名）。同一个插件只能运行一个 `vibex-plugin dev`。
- 远程入口遵循参考插件的 Federation 形态：导出 default React view，由 VibeX 宿主创建 React root。不要在 `src/views/view.tsx` 内调用 `createRoot`，也不要导出异步 `mount` 把 React root 留在插件侧。
- 插件和 Host 的 `react`、`react-dom` 必须使用同一版本。当前工具链锁定 `19.2.8`，依赖使用精确版本并提交 lockfile；不要写 `shared: false`，不要让 remote 自带另一份 React/ReactDOM。
- 最新 plugin-cli 的 Federation 构建可能使用 classic JSX transform。修改 remote 入口时，确认生成 bundle 不会出现 `React is not defined`；当前入口的共享 React 兼容代码不能删除，除非先验证新的 plugin-cli 输出已经改为 automatic JSX runtime。
- `remote already registered` 通常来自旧 dev server、重复 CLI、StrictMode 重复 effect 或未清理的 remote。修改 Federation 后必须完整退出并重启 VibeX，不能只刷新页面。
- Worker handler 必须同时满足三处声明：Worker 注册名、manifest integration 的 `allowedMethods`、前端 bridge 调用名。Host capability 调用必须传 `capability`、`operation`、`input` 三个参数。
- 本地图片使用 `file:<绝对路径>` 标记，并通过 `image.getImage` 读取。不要把 `file:///...` 直接放进 `<img src>`，也不要把大段 base64 重复塞入 Worker 协议帧。
- Federation surface 的根布局使用 `height: 100%`、`min-height: 0`；参数内容单独滚动，底部操作区保持独立，禁止用 `100vh` 计算嵌入页面高度。
- `config.json`、`.vibex-plugin/dev-remote.json`、`dist/`、`node_modules/` 和本地图片缓存属于运行时或构建产物，不要提交。构建插件后检查 Host 工作区是否仍然干净。
- 改动完成后至少运行 `npm run build`、`npm run build:plugin`、`vibex-plugin validate`；可见流程还要在 VibeX 中实际点击验证。
