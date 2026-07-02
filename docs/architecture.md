# 架构总览

- **来源**: `frontend/`、`tauri/`（`src/lib.rs`、`src/sidecar/`、`tauri.conf.json`、`capabilities/default.json`）、`engine/`（`server.py`、`probe/`）、`frontend/package.json`
- **范围**: 三大组件（engine / tauri / frontend）职责划分、进程/运行时模型、跨层通信方式、典型数据流、关键目录树。不覆盖构建与发布流程（见 CI 配置）。
- **关联文档**: [frontend.md](./frontend.md)、[tauri-backend.md](./tauri-backend.md)、JSONL 字段分类见 [jsonl-field-taxonomy.md](./jsonl-field-taxonomy.md)

---

## 速览

### 组件清单

| 组件 | 位置 | 语言/运行时 | 职责一句话 |
|------|------|------------|-----------|
| engine | `engine/` | Python ≥3.10 | 解析 Codex JSONL、持久化 SQLite、响应查询与设置 |
| tauri | `tauri/` | Rust 2021 | 窗口/原生集成/IPC 分发/engine 子进程管理；不承载业务逻辑 |
| frontend | `frontend/` | React 18 + TS + Vite | UI 渲染、用户交互、本地状态管理、调 Tauri IPC |

### 跨层通信通道清单

| 通道 | 两端 | 机制 | 协议形态 |
|------|------|------|---------|
| Tauri IPC 命令 | frontend ↔ tauri | `invoke(cmd, args)` 触发 `#[tauri::command]` | 4 个命令；错误 `AppError={kind,data}` |
| stdin/stdout JSON-line | tauri ↔ engine | `SidecarManager` 写 stdin / 读 stdout | `IpcRequest={id,method,params}` ↔ `IpcResponse={id,result?,error?}`；同步、Mutex 串行 |
| HANDLERS + DAO | engine 内部 | `server.py` 的 `HANDLERS` dict 分发到 handler → DAO | 9 个 method；错误 `{error:{code,message}}` |

### 关键目录树

```
Probe/
├── frontend/                 # React SPA
│   └── src/
│       ├── ipc/              # ★ 后端调用封装层（invoke / types / errors）
│       ├── stores/           # Zustand 状态仓库
│       ├── views/            # 页面组件（AppView）
│       ├── components/       # 按功能域分组的 UI 组件
│       ├── lib/parser/       # Codex JSONL 解析的 TS 移植（仅 dev-mock 用）
│       └── dev-mock.ts       # 浏览器模式下的 invoke mock
├── tauri/                    # Tauri v2 应用
│   ├── src/
│   │   ├── lib.rs            # Builder 组装：插件 / 状态 / 命令 / setup
│   │   ├── commands/         # 4 个 IPC 命令实现
│   │   └── sidecar/          # SidecarManager + Transport
│   ├── capabilities/default.json  # 权限模型
│   └── tauri.conf.json       # 窗口/bundle/externalBin/updater
├── engine/                   # Python sidecar
│   ├── server.py             # ★ IPC 主循环 + HANDLERS 字典
│   ├── probe/
│   │   ├── codex_adapter/    # JSONL 解析管线
│   │   ├── storage/          # SQLite 连接 / schema / DAO
│   │   └── handlers/         # 9 个方法的处理函数
│   └── pyproject.toml        # probe-engine
└── docs/                     # 本文档目录
```

---

## 进程 / 运行时模型

Probe 是 AI 代码库分析工具（把 Codex CLI 跑出来的会话日志解析成可浏览的图形/时间线/对话视图）。运行时是两个 OS 进程加一层浏览器渲染：

```
┌──────────────────────────────────────────────────────────┐
│  Tauri 主进程（probe / probe_lib，Rust）                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ WebView（Chromium / WKWebView）                      │  │
│  │  └─ frontend SPA（React，构建产物在 frontend/dist）  │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────────────────┐    stdin (JSON line)            │
│  │ SidecarManager        │ ───────────────────────►┌──────┴───┐
│  │  (tokio 子进程管理)    │ ◄───────────────────────│ engine   │
│  └──────────────────────┘   stdout (JSON line)     │ (Python) │
│                                                      └──────┬───┘
│                                                             │
└─────────────────────────────────────────────────────────────┘
                                                              │
                                                    ┌─────────▼──────────────────────┐
                                                    │ SQLite (probe_desktop.sqlite)  │
                                                    └────────────────────────────────┘
```

### 前端进程（WebView 内 JS）

- 不是独立 OS 进程，跑在 WebView（macOS = WKWebView、Windows = WebView2/Chromium）的 JS 运行时里。
- 通过 Tauri 启动时注入的全局对象 `window.__TAURI_INTERNALS__` 调 IPC。

### Tauri 主进程

- Rust 二进制 `probe`，持有窗口、`SidecarManager`、命令 handler。
- 单主窗口 `main`。

### engine 子进程

- 由 `SidecarManager` 用 `tokio::process::Command` spawn 的 Python 子进程。
- dev 模式跑 `python server.py`；release 模式跑 PyInstaller 打出来的二进制 `probe-engine`。
- 通信：piped stdin/stdout（JSON-line）；stderr 留给 engine 自身日志。
- **不是 Tauri shell 插件的 sidecar，而是手动管理的子进程**（`tauri.conf.json` 的 `externalBin` 只管打包分发，运行时 spawn 由 `SidecarManager` 自己控制）。

### SQLite

- engine 进程内的单例连接（`storage/connection.py` 的 `_connection`）。
- 数据库文件按平台约定落在用户数据目录（mac = `~/Library/Application Support/...`、Windows = `%LOCALAPPDATA%/...`），由 engine 自己解析，Tauri 层不感知路径。

---

## 三大组件条目

### engine（Python sidecar）

- **形态**: 单进程 Python 程序，stdin/stdout 收发 JSON-line。
- **入口**: `engine/server.py`——循环：读一行请求 → 调对应处理函数 → 写一行响应。
- **职责**: 解析 Codex CLI 的 JSONL rollout 文件、持久化到 SQLite、响应查询与设置。
- **内部模块**:

| 目录 | 角色 |
|------|------|
| `probe/codex_adapter/` | JSONL 解析管线（reader 发现文件 / extractors 逐行提取 / models 数据结构 / summary 汇总 / writer 输出 / classifier 分类 / token_estimator 估 token） |
| `probe/storage/` | SQLite 持久化层（connection 单例连接 / schema 与迁移 / 其余按表分 DAO） |
| `probe/handlers/` | IPC 处理函数，按业务域分文件（import / scan / session / settings） |

### tauri（Rust 应用层）

- **形态**: Tauri v2 桌面壳。
- **职责**: 拉起 engine sidecar、转发前端 IPC 到 engine、提供原生文件对话框、读取原始 JSONL、应用更新。
- **边界**: 不承载业务逻辑——所有数据操作都委托给 engine，自己只做「转发」和「跟操作系统打交道」。

### frontend（React SPA）

- **形态**: React 18 + TypeScript + Vite 的 SPA。
- **职责**: UI 渲染、用户交互、本地状态管理、调用 Tauri IPC。
- **统一出口**: 所有后端调用走 `frontend/src/ipc/invoke.ts`（组件和 store 不直接碰 Tauri 底层 API）。

---

## 跨层通信

### 前端 ↔ Tauri：Tauri IPC 命令

前端调 `@tauri-apps/api/core` 的 `invoke(cmd, args)`（封装在 `frontend/src/ipc/invoke.ts`），触发 Rust 侧带 `#[tauri::command]` 的函数。注册的命令共 4 个：

| 命令 | 方向 | 说明 |
|------|------|------|
| `engine_call` | 双向 | 通用网关，`{method, params}` 转发到 engine |
| `open_file_dialog` | 双向 | 原生文件/目录选择 |
| `read_raw_file` | 双向 | 按 `session_id` 读原始 JSONL（路径由 engine 解析） |
| `app_info` | 双向 | 返回版本号/名称 |

- 错误形态：`AppError = { kind: "Engine"|"Sidecar"|"Native", data }`。
- 前端 `toIpcError` 收敛为 `{ code, message }`。

### Tauri ↔ engine：stdin/stdout JSON-line IPC

- `SidecarManager::call(method, params)` 构造 `IpcRequest = { id, method, params }`，序列化成一行 JSON 写入子进程 stdin。
- `Transport::read_response` 从 stdout 按行读取 `IpcResponse = { id, result?, error? }` 并校验 `id` 匹配。
- **同步请求-响应模型**：每条请求独占 stdin/stdout 一次往返，靠 `Mutex` 串行化（避免两路请求输出交错）。
- 无事件订阅 / 流式输出。

### engine 内部：HANDLERS 字典 + DAO

`server.py` 的 `HANDLERS` 字典把 9 个方法名映射到处理函数：

| method | handler | 入参（关键字段） | 出参（关键字段） |
|--------|---------|-----------------|-----------------|
| `import_files` | `import_handler.handle` | `input_path` | `sessions`, `root_sessions`, `table_counts` ... |
| `import_files_batch` | `import_handler.handle_batch` | `file_paths` | 批量导入结果 |
| `scan_codex_sessions` | `scan_handler.handle_scan_codex_sessions` | `path` | `pending[]`, `total` |
| `list_sessions` | `session_handler.handle_list` | `filter`, `sort`, `sort_order`, `limit`, `offset` | `sessions[]`, `total` |
| `get_session_detail` | `session_handler.handle_detail` | `session_id` | `session`, `events[]`, `children[]` |
| `get_event_detail` | `session_handler.handle_event_detail` | `event_id` | event row |
| `delete_sessions` | `session_handler.handle_delete` | `session_ids[]`, `delete_files` | `deleted_sessions`, `deleted_files` |
| `get_settings` | `settings_handler.handle_get` | — | settings KV + `default_codex_path` |
| `set_settings` | `settings_handler.handle_set` | `key`, `value` | `{ key, value }` |

- handler 调 `storage` 层的 DAO 读写 SQLite。
- `transaction()` 上下文管理器保证提交/回滚。
- 错误形态：`{ error: { code, message } }`；`code` 取自异常类型映射：

| 异常 | code |
|------|------|
| `ValueError` | `BAD_REQUEST` |
| `KeyError` / `FileNotFoundError` | `NOT_FOUND` |
| 其它 | `INTERNAL_ERROR` |
| — | `METHOD_NOT_FOUND` / `PARSE_ERROR` |

---

## 典型数据流：导入目录

以「用户点导入按钮、选了一个 Codex 会话目录」为例：

| 步 | 层 | 动作 |
|----|----|------|
| 1 | frontend | 点「导入」打开 `ImportModal`；选目录时调 `invoke.openFileDialog({ directory: true })` |
| 2 | tauri | `open_file_dialog` 命令调 OS 弹原生文件夹选择框，返回路径字符串 |
| 3 | frontend | `useImportProgressStore.runIncrementalImport(codexPath)` 启动增量循环 |
| 4 | frontend → tauri → engine | `invoke.scanCodexSessions(path)` → `engine_call` → `SidecarManager::call("scan_codex_sessions", {path})` 写入 stdin |
| 5 | engine | `scan_handler.handle_scan_codex_sessions` 比对 `imported_files` 表，算 pending 列表 |
| 6 | engine → tauri → frontend | stdout 返回 `{pending, total}`，原路返回 |
| 7 | frontend → engine | 按 `BATCH_SIZE = 10` 分批 `invoke.importFilesBatch(filePaths)` → `import_handler.handle_batch` |
| 8 | engine | `codex_adapter` 解析 JSONL（reader → extractors → summary）→ 在 `transaction()` 里写 `sessions`/`events`/`imported_files` 表 → 返回 `ImportBatchResult` |
| 9 | frontend | 每批返回后更新进度条，再发下一批，直到 pending 清空 |
| 10 | frontend → engine | `invoke.listSessions()` → `session_handler.handle_list` → `session_dao.list_sessions` |
| 11 | frontend | `useSessionStore` 拿到 `sessions[]`，`SessionList` 自动重渲染 |
| 12 | frontend → engine | 用户点会话 → `invoke.getSessionDetail(id)` → `handle_detail` → 递归 CTE 取后代、`_strip_heavy_fields` 裁剪大字段 → 返回 `{session, events, children}` |
| 13 | frontend | graph/timeline/chat/raw 四面板按各自方式渲染 |
| 14 | frontend → tauri → engine | 「原始」视图 → `invoke.readRawFile(sessionId)` → Tauri `read_raw_file` 命令 → 先 `engine_call("get_session_detail")` 解析 `source_path`，再 `tokio::fs::read_to_string` 读盘 → 返回原始文本 |

链路一句话：**React → invoke.ts → Tauri command → SidecarManager → engine handler → storage DAO → SQLite**，回程反向逐层返回。

---

## 备注

- engine 与前端的 Codex 解析逻辑存在**双实现**：`engine/probe/codex_adapter/`（Python，生产用）与 `frontend/src/lib/parser/`（TypeScript，仅 dev-mock 用）。二者需手工保持语义同步，目前 dev-mock 依赖静态样本，对真实样本的覆盖尚未完全对齐。
- `tauri/src/sidecar/process.rs` 的 `stop()` 方法当前无调用方（`#[allow(dead_code)]`），属预留代码。
- engine 的 `server.py` 在 `BrokenPipeError`（父进程关闭 stdout 管子）时 `sys.exit(0)` 干净退出，并忽略 `SIGPIPE`。

---

## 术语表

- **Tauri** — 用 Rust 写的桌面应用框架，类似 Electron 但调用系统自带 WebView 而不打包整个 Chromium，安装包更小。
- **sidecar**（伴随子进程）— 跟主程序并排跑的独立子进程；这里指 engine 被当作独立 Python 程序单独拉起，不嵌在主程序里。
- **IPC**（Inter-Process Communication，进程间通信）— 两个独立进程之间交换消息的方式；这里特指前端/Tauri 跟 engine 之间的请求-响应。
- **WebView** — 操作系统自带的浏览器内核（macOS = WKWebView、Windows = WebView2），相当于一个看不见地址栏的浏览器窗口，用来渲染前端。
- **JSON-line** — 每行一个完整 JSON 对象的文本格式；一行就是一条消息，比整段 JSON 更适合流式收发。
- **SQLite** — 轻量级单文件数据库，不需要单独起服务，Python 标准库自带。
- **DAO**（Data Access Object）— 每张表一个专属类，把 SQL 操作封成方法。
- **`#[tauri::command]`** — Tauri 的宏标注；给 Rust 函数套上并在 Builder 里注册，前端就能通过名字调到它（相当于「把这个函数暴露成前端可调的 RPC 接口」）。
- **tokio** — Rust 的异步运行时，提供事件循环和异步进程/文件 API，让 Rust 代码等子进程输出时不卡死。
- **PyInstaller** — 把 Python 脚本和解释器打包成单个可执行文件的工具。
- **Mutex**（互斥锁）— 保证同一时刻只有一个线程在读写共享资源（这里是 stdin/stdout），避免输出交错混乱。
- **CTE**（Common Table Expression）— SQL 的「递归查询」语法，这里用来查一个会话的所有后代会话。
- **SPA**（Single Page Application，单页应用）— 整个应用只有一个网页，切换内容靠 JS 改 DOM 而不是跳到新 URL。
- **Vite** — 前端构建工具；开发时给带热更新的本地服务器，打包时把源码编译成静态文件。
- **Zustand** — React 生态里比 Redux 更轻量的状态管理库。
- **LRU**（Least Recently Used，最近最少使用）— 一种缓存淘汰策略，满了就把最久没用的那条删掉。
- **`externalBin`** — `tauri.conf.json` 的项，告诉 Tauri 打包时把这个二进制一起带上；运行时怎么 spawn 还是自己的代码决定。
- **BrokenPipeError / SIGPIPE** — 父进程关闭了 stdout 管子时子进程写会触发的错误/信号；engine 据此干净退出。
