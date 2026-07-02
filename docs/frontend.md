# 前端技术栈

- **来源**: `frontend/package.json`、`frontend/src/`（`main.tsx`、`App.tsx`、`stores/`、`ipc/`、`views/`、`components/`、`lib/`、`i18n/`、`dev-mock.ts`）、`tauri.conf.json`（devUrl）
- **范围**: 框架与构建工具、目录结构、状态管理、路由、与 Tauri 后端的调用方式、关键模块清单。
- **关联文档**: 架构层面见 [architecture.md](./architecture.md)、Tauri/后端见 [tauri-backend.md](./tauri-backend.md)

---

## 速览

### 依赖清单（package.json）

| 依赖 | 版本 | 作用 |
|------|------|------|
| `react` / `react-dom` | ^18.3.1 | UI 框架 |
| typescript | ^5.5.0 | 带类型的 JS 超集，编译期抓参数/字段名错误 |
| `vite` | ^5.4.0 | 开发服务器与打包器 |
| `@vitejs/plugin-react` | — | Vite 的 JSX 转换插件 |
| `tailwindcss` | ^4.2.4 | 原子化 CSS 框架 |
| `@tailwindcss/vite` | — | Tailwind 的 Vite 集成插件 |
| `zustand` | ^5.0.13 | 状态管理库 |
| `react-router-dom` | ^7.15.0 | 路由库（使用 HashRouter 模式） |
| `i18next` / `react-i18next` | ^26.3.2 / ^17.0.8 | 国际化（中英文双语） |
| `react-window` | ^1.8.11 | 长列表虚拟化 |
| `@tauri-apps/api` | ^2.0.0 | Tauri 官方 JS SDK |
| `@tauri-apps/plugin-dialog` | — | 原生文件对话框插件 |
| `@tauri-apps/plugin-process` | — | 应用重启插件 |
| `@tauri-apps/plugin-updater` | — | 自动更新插件 |
| `@tauri-apps/cli` | ^2.11.0（dev） | Tauri 命令行工具（`tauri dev` / `tauri build`） |

### 脚本

| 脚本 | 命令 | 说明 |
|------|------|------|
| `dev` | `vite` | 起开发服务器，监听 1420 端口（与 `tauri.conf.json` 的 `devUrl` 对应） |
| `build` | `tsc && vite build` | 类型检查 + 打包 |
| `preview` | `vite preview` | 预览打包产物 |

### 目录清单

| 目录/文件 | 角色 |
|-----------|------|
| `main.tsx` | React 入口，挂载 `<App />` 到 `document.body` |
| `App.tsx` | 顶层组件：HashRouter + 单一路由 + 全局 ImportModal |
| `index.css` | Tailwind 入口与全局样式 |
| `dev-mock.ts` | 浏览器模式下的 invoke mock（无 `__TAURI_INTERNALS__` 时启用） |
| `views/AppView.tsx` | 唯一页面：会话列表 + 面板 + 设置等 |
| `stores/` | Zustand 状态仓库（5 个） |
| `ipc/` | 与 Tauri 后端的 IPC 封装（invoke / types / errors） |
| `i18n/` | i18next 实例初始化 + locales（zh.json / en.json） |
| `lib/` | 纯函数工具（parser / format / color / event-fields） |
| `components/` | 按功能域分组的 UI 组件（见下文「关键模块」） |

### Store 清单

| store | 文件 | 职责 |
|-------|------|------|
| `useSessionStore` | `stores/session.ts` | 会话列表、当前会话详情、选中事件、选择模式；详情带 LRU 缓存（max 10） |
| `useImportStore` | `stores/import.ts` | 单次导入的输入路径、loading、结果、modal 开合 |
| `useImportProgressStore` | `stores/import_progress.ts` | 增量导入循环（scan → 按批次 import），驱动顶部进度条 |
| `useSettingsStore` | `stores/settings.ts` | 引擎 KV 设置（codex_path、interface_language 等），挂载时 load() |
| `usePanelStore` | `stores/panel.ts` | 可分裂面板的树形布局（PanelNode / SplitNode） |

### 路由清单

| 路由模式 | 注册 | 说明 |
|---------|------|------|
| HashRouter | 一条 catch-all 指向 `AppView` | 整个应用单页面，靠状态驱动切换，不靠 URL 跳转 |

### IPC 封装清单（`src/ipc/`）

| 文件 | 导出 | 角色 |
|------|------|------|
| `invoke.ts` | `invoke` 对象 | 所有后端调用的统一出口；运行时探测 Tauri/mock；具名方法封装 9 个 engine method + 3 个直接命令 + 更新器 |
| `types.ts` | `SessionRow` / `EventRow` / `Settings` 等 | 跨层类型定义 |
| `errors.ts` | `toIpcError` | 把 `AppError` 收敛为 `IpcError = { code, message }` |

---

## 框架与构建工具

### React 18 + TypeScript

- React：Meta 出的声明式 UI 库，核心思想「用函数描述界面长什么样，数据变了界面自动重画」。
- TypeScript：JS 的带类型超集，编译期抓「传错参数」「拼错字段名」。

### Vite 5

- 新一代前端构建工具；开发时按需编译（改哪个文件只重编那个，热更新快），打包时编译成静态文件。
- 开发服务器监听 1420 端口，与 `tauri.conf.json` 的 `devUrl: http://localhost:1420` 对应（开发时 Tauri 主进程打开这个本地地址加载前端）。

### TailwindCSS 4

- 原子化 CSS 框架；不写传统 CSS 类，直接在 HTML 上写 `className="flex p-4 text-gray-500"` 这种工具类。
- 通过 `@tailwindcss/vite` 插件集成，样式入口 `src/index.css`。

### Zustand

- React 生态里比 Redux 更轻量的状态管理方案；核心 API 就一个 `create()`：传一个返回 state 的函数，拿到一个 hook。
- 组件用 `useXxxStore(s => s.字段)` 订阅所需切片（只有这部分变了组件才重画）。
- 采用 one-store-per-domain（每个业务域一个 store）模式。

### react-router-dom（HashRouter）

- React 本身不管「URL 对应哪个页面」，react-router 干这个。
- HashRouter 用 URL 里 `#` 后面的部分当路径（如 `app://index.html#/settings`）；选这种模式是因为 Tauri 用 `tauri://` 协议加载本地 HTML，传统 history API 路径会出问题，hash 路由不依赖它。

### i18next + react-i18next

- 把界面文案从代码里抽出来放到 JSON 文案文件（zh.json / en.json），运行时根据当前语言查表替换。

### react-window

- 长列表虚拟化；列表有几千条时只渲染可视区域那几十条，滚动时复用 DOM 节点。

### @tauri-apps/api 及插件

- Tauri 官方提供给前端的 JS SDK，用来调 Tauri 的 IPC 命令和原生能力（dialog / process / updater）。

---

## 目录结构

```
frontend/src/
├── main.tsx              # React 入口
├── App.tsx               # HashRouter + 单路由 + ImportModal
├── index.css             # Tailwind 入口
├── dev-mock.ts           # 浏览器模式 invoke mock
├── views/
│   └── AppView.tsx       # 唯一页面
├── stores/               # 5 个 Zustand store
├── ipc/                  # invoke / types / errors
├── i18n/
│   ├── index.ts          # i18next 初始化
│   └── locales/          # zh.json / en.json
├── lib/
│   ├── parser/           # Codex JSONL 解析的 TS 移植（仅 dev-mock）
│   ├── event-fields.ts
│   ├── event-metadata-cards.ts
│   ├── format.ts
│   └── color.ts
└── components/
    ├── session/          # 会话列表
    ├── panel/            # 面板容器与分裂
    ├── graph/            # 图视图
    ├── timeline/         # 时间线
    ├── conversation/     # 对话视图
    ├── raw/              # 原始 JSON 视图
    ├── settings/         # 设置面板
    └── shared/           # 跨视图复用
```

---

## 状态管理

### useSessionStore（`stores/session.ts`）

- 会话列表、当前会话详情、选中事件、选择模式。
- 详情带 **LRU** 缓存，最多 10 条，避免来回切换会话时反复请求后端。

### useImportStore（`stores/import.ts`）

- 单次导入的输入路径、loading、结果、modal 开合。

### useImportProgressStore（`stores/import_progress.ts`）

- 增量导入循环：先 `scan_codex_sessions` 获取 pending，再按 `BATCH_SIZE = 10` 分批 `import_files_batch`。
- 驱动顶部进度条。

### useSettingsStore（`stores/settings.ts`）

- 从引擎 KV（key-value，简单的键值对存储）读取/写入设置（codex_path、interface_language）。
- `App.tsx` 挂载时触发首次 `load()`，加载完成后同步 i18n 语言。

### usePanelStore（`stores/panel.ts`）

- 可分裂面板的树形布局：`LayoutNode = PanelNode | SplitNode`。
- 支持 horizontal/vertical 分裂与 ratios（每个子区域占多少比例）。

---

## 路由 / 页面组织

- `App.tsx` 用 HashRouter 包裹，仅注册一条 catch-all 路由指向 `AppView`。
- 整个应用单页面：会话列表、面板（graph / timeline / chat / raw 四种 `ViewKind`）、设置面板、ImportModal 都通过状态驱动在 `AppView` 中切换显示，不靠 URL 跳转。

---

## 与 Tauri 后端的调用方式

### invoke.ts 总览

所有后端调用集中在 `src/ipc/invoke.ts` 导出的 `invoke` 对象，组件 / store **不直接**调 `@tauri-apps/api/core` 的 `invoke`。集中封装的好处：后端接口签名改了只动一处。

### 运行时探测

- `getInvoke()` 检测 `window.__TAURI_INTERNALS__`（Tauri 启动时往 WebView 注入的桥接对象）。
- 存在 → 动态 `import("@tauri-apps/api/core")` 拿到真正的 Tauri `invoke`。
- 不存在 → 动态 `import("../dev-mock")` 取 `mockInvoke`，使前端可在纯浏览器中用 mock 数据开发。

### engine 通用入口

- 所有引擎方法（9 个）都走 Tauri 命令 `engine_call`，通过 `method` + `params` 转发到 Python sidecar。
- `invoke.callEngine(method, params)` 是底层逃生口；其它方法是对 `method` 名的具名封装（如 `importFiles` = `callEngine("import_files", ...)` 的语法糖）。

### 直接命令

| 封装方法 | Tauri 命令 |
|---------|-----------|
| `openFileDialog` | `open_file_dialog` |
| `readRawFile` | `read_raw_file` |
| `appInfo` | `app_info` |

### 更新器

- `beginUpdateCheck` / `checkForUpdate` / `downloadAndInstallUpdate` / `clearPendingUpdate` / `relaunchApp` 走 `@tauri-apps/plugin-updater` 与 `@tauri-apps/plugin-process`。
- `_activeUpdateCheckToken` 防止并发检查竞态（用户连点「检查更新」时用 token 作废旧检查）。

### 错误处理

- Tauri 端 `AppError = { kind: "Engine"|"Sidecar"|"Native", data }`。
- `ipc/errors.ts` 的 `toIpcError` 收敛为 `IpcError = { code, message }`，便于 UI 层展示。
- 详见 [tauri-backend.md](./tauri-backend.md)。

---

## 关键模块清单

### 会话列表（`components/session/`）

- 按日期分桶（`DateBucket`）与项目文件夹（`ProjectFolder`）组织。
- `SessionCard` 展示会话摘要；`SessionList` 消费 `useSessionStore`。

### 导入（`components/shared/ImportModal.tsx` + `stores/import*.ts`）

- 支持单文件 / 目录导入与增量扫描批量导入。
- 目录选择通过 `openFileDialog({ directory: true })` 调原生对话框（而非浏览器 file input）。

### 面板布局（`components/panel/`）

- `PanelContainer` 渲染 `LayoutNode` 树。
- `DraggableDivider` 调整 ratios（拖动分隔条改两侧占比）。
- `SplitMenu` 触发分裂；视图种类由 `ViewKind` 决定。

### 图视图（`components/graph/`）

- `GraphCanvas` + 拆分的渲染/交互/标签/视口/图例模块。
- 展示 token 使用与事件时间线。

### 时间线（`components/timeline/`）

- `TimelineView` + `EventNode`，按事件序列展示。

### 对话 / 原始（`components/conversation/`、`components/raw/`）

- 两种内容视图。

### 设置（`components/settings/`）

- `SettingsPanel` + `SettingsTabs` + `UpdateTab`。
- 含 codex 路径配置、语言切换、应用更新检查。

### 窗口控制（`components/shared/WindowControls.tsx`）

- 仅 Windows 显示（macOS 用原生 traffic lights——左上角红黄绿圆点）。
- 通过 `@tauri-apps/api/window` 的 `getCurrentWindow()` 调 `minimize/maximize/close`。
- 订阅 `onResized` 同步最大化状态。

### 标题栏（`components/shared/TitleBar.tsx`）

- 提供 `TitleDragRegion`，配合无边框窗口拖拽（对应 `core:window:allow-start-dragging` 权限）。

### dev-mock 解析器（`lib/parser/`）

- Python `codex_adapter` 的 TypeScript 移植。
- 仅在浏览器 mock 模式下使用，使前端能在不启动 Tauri 的情况下用静态样本运行；生产模式下的解析仍由 Python sidecar 完成。

---

## 备注

- `lib/parser/` 的 TS 实现与 `engine/probe/codex_adapter/` 的 Python 实现是两套独立代码，需手工保持语义同步；目前 dev-mock 依赖静态样本，对真实样本的覆盖尚未与 Python 管线对齐。
- `AppView.tsx` 是当前唯一页面级组件，承担列表、面板、设置、进度条等多重职责，体量较大；未来若拆分页面，路由层已就绪。

---

## 术语表

- **React** — Meta 出的声明式 UI 库；用函数描述界面长什么样，数据变了界面自动重画。
- **TypeScript** — JavaScript 的带类型超集，编译期抓参数/字段名错误。
- **Vite** — 新一代前端构建工具；开发时按需编译、热更新快，打包时编译成静态文件。
- **Tailwind** — 原子化 CSS 框架；直接在 HTML 上写工具类，框架自动生成样式。
- **Zustand** — React 生态里比 Redux 更轻量的状态管理库；核心 API 就一个 `create()`。
- **selector hook** — 组件用 `useXxxStore(s => s.字段)` 订阅 state 的一部分；只有这部分变了组件才重画。
- **HashRouter** — react-router 的一种模式，用 URL 里 `#` 后面的部分当路径；不依赖浏览器 history API，适配 Tauri 的本地协议加载方式。
- **i18next** — 国际化库；把界面文案抽到 JSON 文件，运行时按语言查表替换。
- **react-window** — 长列表虚拟化库；只渲染可视区域那几十条，滚动时复用 DOM 节点。
- **@tauri-apps/api** — Tauri 官方提供给前端的 JS SDK，用来调 IPC 命令和原生能力。
- **LRU**（Least Recently Used，最近最少使用）— 一种缓存淘汰策略，满了就把最久没用的那条删掉。
- **KV**（key-value）— 简单的键值对存储，没有复杂表结构。
- **traffic lights** — macOS 左上角红黄绿三个圆点按钮，对应最小化/最大化/关闭。
- **`window.__TAURI_INTERNALS__`** — Tauri 启动时往 WebView 注入的桥接对象；存在说明现在跑在 Tauri 里。
- **dev-mock** — 让前端不启动 Tauri 也能在纯浏览器里跑的 mock 模式，用静态样本数据模拟后端。
- **`ViewKind`** — 面板视图种类枚举（graph / timeline / chat / raw）。
- **SPA**（Single Page Application，单页应用）— 整个应用只有一个网页，切换内容靠 JS 改 DOM。
