# Tauri / 后端

- **来源**: `tauri/Cargo.toml`、`tauri/src/`（`lib.rs`、`main.rs`、`commands/`、`sidecar/`、`build.rs`）、`tauri/tauri.conf.json`、`tauri/capabilities/default.json`、`tauri/tauri.dev-updater.conf.json`
- **范围**: Cargo 工程结构、tauri.conf.json 关键配置、4 个自定义 IPC 命令、capabilities 权限模型、SidecarManager 行为与生命周期、Transport 协议、平台差异（macOS / Windows）。
- **关联文档**: 架构总览见 [architecture.md](./architecture.md)、前端见 [frontend.md](./frontend.md)

---

## 速览

### Cargo 依赖清单（`Cargo.toml`）

| 依赖 | features | 用途 |
|------|----------|------|
| `tauri` | `macos-private-api` | Tauri 核心 |
| `tauri-plugin-shell` | — | sidecar 进程 spawn（实际 spawn 走 tokio，插件主要承担权限声明） |
| `tauri-plugin-dialog` | — | 原生文件对话框 |
| `tauri-plugin-process` | — | 应用重启（更新后 relaunch） |
| `tauri-plugin-updater` | — | 自动更新 |
| `serde` / `serde_json` | — | IPC 序列化 |
| `tokio` | `process, io-util, sync` | 异步子进程与 IO |
| `thiserror` | — | 错误枚举派生宏 |

### IPC 命令清单

| 命令名 | 入参 | 出参 | 职责 |
|--------|------|------|------|
| `engine_call` | `state: SidecarManager`, `method: String`, `params: Value` | `Result<Value, AppError>` | 通用网关：`{method, params}` 经 stdin/stdout 转发给 engine，返回 engine 的 `result`；engine 返回 error 则映射为 `AppError::Engine` |
| `open_file_dialog` | `app: AppHandle`, `title: Option<String>`, `directory: Option<bool>` | `Result<Option<String>, AppError>` | 原生文件/目录选择；`blocking_pick_*` 同步阻塞调用 |
| `read_raw_file` | `state: SidecarManager`, `session_id: String` | `Result<String, AppError>` | 读会话原始 JSONL；**不直接收文件路径**，先 `engine_call("get_session_detail")` 解析 `source_path`，再 `tokio::fs::read_to_string` 读盘 |
| `app_info` | （无） | `Value` | 返回 `{ version, name }`（来自 `CARGO_PKG_VERSION` / `CARGO_PKG_NAME`） |

### Capabilities 权限清单（`capabilities/default.json`）

`identifier: "default"`，作用于 `windows: ["main"]`：

| 权限 | 用途 |
|------|------|
| `core:default` | 核心默认能力 |
| `core:window:allow-start-dragging` | 无边框窗口拖拽 |
| `core:window:allow-minimize` | 最小化 |
| `core:window:allow-maximize` | 最大化 |
| `core:window:allow-unmaximize` | 取消最大化 |
| `core:window:allow-toggle-maximize` | 切换最大化 |
| `core:window:allow-close` | 关闭 |
| `core:window:allow-is-maximized` | 查询最大化状态 |
| `shell:allow-execute` / `allow-spawn` / `allow-stdin-write` / `allow-kill` / `shell:default` | sidecar 进程能力（实际 spawn 走 tokio，权限保留不冲突） |
| `dialog:allow-open` / `dialog:default` | 文件对话框 |
| `updater:allow-check` / `allow-download-and-install` | 自动更新 |
| `process:allow-restart` | 更新后重启 |

### 平台差异清单（macOS vs Windows）

| 维度 | macOS | Windows |
|------|-------|---------|
| 标题栏 | `titleBarStyle: "Overlay"`，原生 traffic lights | `set_decorations(false)` 自绘边框 + `WindowControls` 按钮 |
| 窗口背景色 | 不设置（`set_background_color` 在 macOS 返回 not implemented） | `set_background_color(#F8FAFC)` 匹配前端背景 |
| engine 二进制名 | `probe-engine` | `probe-engine.exe` |
| engine 工作目录（bundled） | `$HOME` | `%USERPROFILE%` |
| DB 路径（engine 解析） | `~/Library/Application Support/probe_desktop/probe_desktop.sqlite` | `%LOCALAPPDATA%/probe_desktop/probe_desktop.sqlite`（回退 `%APPDATA%`） |
| 默认 Codex 会话目录 | `~/.codex` | `%USERPROFILE%\.codex` |
| 焦点处理 | `setup` 中延迟 100ms `set_focus` | 同上 |
| Python 查找（dev） | `python3` → `python` | 同上 |

---

## Cargo 工程结构

- `tauri/` 是单一 **crate**（Rust 的编译单元，一个 crate 对应一个 `Cargo.toml`）；不是 Cargo workspace（workspace 是把多 crate 放一起统一管理，本项目只有一个 crate 所以没用）。
- `[package]`: `name = "probe"`，`version = "0.0.13"`，`edition = "2021"`（Rust 2021 版本语法）。
- 产物：
  - `[lib] name = "probe_lib"`，`crate-type = ["staticlib", "cdylib", "rlib"]`（cdylib 给 Tauri 移动端用，桌面端实际用 bin）。
  - `[[bin]] name = "probe"`，入口 `src/main.rs`。

### `src/main.rs`

- 仅一行 `probe_lib::run()`。
- `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`：release 下把 Windows 子系统设为 `windows`（不额外弹黑色命令行窗口）。

### `src/lib.rs`

- `run()` 函数组装 `tauri::Builder`（Tauri 的应用构造器，链式调用注册插件、状态、命令 handler、setup 钩子）。
- 整个 Tauri 应用的装配点。

### `src/commands/`

- 自定义 IPC 命令实现，按命令拆文件：`engine_call.rs` / `file_dialog.rs` / `app_state.rs` / `read_raw_file.rs` / `error.rs`。

### `src/sidecar/`

- `process.rs` = `SidecarManager`；`transport.rs` = stdin/stdout JSON 帧协议。

### `build.rs`

- 构建脚本，仅调用 `tauri_build::build()`（Tauri 在编译期生成胶水代码，把 `tauri.conf.json` 的能力编进二进制）。

---

## tauri.conf.json 要点

### `productName` / `identifier`

- `productName: "Probe"`。
- `identifier: "com.probe.desktop"`（应用唯一标识，反向域名格式，用于系统注册）。

### `build.frontendDist` / `devUrl`

- `frontendDist: "../frontend/dist"`、`devUrl: "http://localhost:1420"`。
- 开发时从 `localhost:1420` 加载前端（Vite 开发服务器），打包时把 `frontend/dist` 静态产物嵌进应用。
- `beforeDevCommand` / `beforeBuildCommand` 在 `../frontend` 下跑 `npm run dev` / `npm run build`。

### 窗口配置

- 单窗口 `main`，`width 1280 / height 800`。
- `titleBarStyle: "Overlay"`：macOS 保留原生 traffic lights，并让内容延伸到标题栏下方。

### `app.macOSPrivateApi`

- `true`，配合 `macos-private-api` feature，支持自定义透明/嵌入标题栏效果（macOS 私有 API 才能做到）。

### `security.csp`

- `null`（CSP = Content Security Policy，浏览器的内容安全策略，限制能加载哪些来源的脚本/样式）；这里不强制，便于内联样式与本地资源。

### `bundle.externalBin`

- `["probe-engine"]`：把 PyInstaller 打包的 engine 二进制作为 sidecar 随应用分发。
- Tauri 按目标平台加后缀（`probe-engine-aarch64-apple-darwin` 等）。
- 仅打包声明，运行时 spawn 由 `SidecarManager` 自己决定。

### `bundle.targets`

- `["app", "dmg", "nsis"]`：macOS DMG（.dmg 镜像）+ Windows NSIS（.exe 安装包，NSIS 是开源的 Windows 安装包制作工具）。

### `plugins.updater`

- 公钥（`pubkey`，minisign 公钥）与 `endpoints` 指向本项目 GitHub Releases 的 `latest.json`（实际地址：`https://github.com/ChickmagnetL/Probe/releases/latest/download/latest.json`）；更新时去查最新版本号和下载地址，公钥验签防中间人篡改。
- Windows `installMode: "passive"`（安装界面静默弹出但用户不用点）。
- 另有 `tauri.dev-updater.conf.json` 用于开发期 updater 调试。

---

## IPC 命令

4 个命令通过 `lib.rs` 的 `generate_handler!` 宏注册，全部带 `#[tauri::command]`。

### `engine_call`

- **签名**: `(state: SidecarManager, method: String, params: serde_json::Value) -> Result<Value, AppError>`
- **职责**: 通用网关；把 `method` + `params` 经 stdin/stdout 转发给 Python engine，返回 engine 的 `result`。
- **错误映射**: engine 返回 `error` → `AppError::Engine`。
- **覆盖范围**: 前端 9 个引擎方法都走这一条命令。

### `open_file_dialog`

- **签名**: `(app: AppHandle, title: Option<String>, directory: Option<bool>) -> Result<Option<String>, AppError>`
- **职责**: 原生文件/目录选择对话框；`directory=true` 选文件夹否则选文件。
- **调用方式**: `blocking_pick_*` 同步阻塞调用（弹框期间阻塞调用线程，简化时序）。

### `read_raw_file`

- **签名**: `(state: SidecarManager, session_id: String) -> Result<String, AppError>`
- **职责**: 读取某会话的原始 JSONL 源文件。
- **安全设计**: **不直接接受文件路径**——先通过 engine 的 `get_session_detail` 解析 `source_path`，再用 `tokio::fs::read_to_string` 读盘。这样前端无法传任意路径，避免越权读文件。

### `app_info`

- **签名**: `() -> serde_json::Value`
- **出参**: `{ version, name }`。
- **来源**: `CARGO_PKG_VERSION` / `CARGO_PKG_NAME`（Cargo 在编译期把包元数据作为环境变量注入）。
- **用途**: 供前端「关于/更新」展示。

### 错误类型 `AppError`（`commands/error.rs`）

```rust
// tauri/src/commands/error.rs
enum AppError {
    Engine { code: String, message: String },  // engine 返回的 {error:{code,message}}
    Sidecar(String),                           // 子进程生命周期/传输失败
    Native(String),                            // 文件 IO、对话框等本地集成失败
}
```

- 序列化为 `{ kind: "Engine"|"Sidecar"|"Native", data }`。
- 前端 `toIpcError`（`frontend/src/ipc/errors.ts`）收敛为 `{ code, message }`。

---

## 窗口管理与权限模型

Tauri v2 用 **capabilities**（能力声明——白名单权限机制：默认所有原生能力都禁用，必须在 capabilities 文件里显式声明这个窗口能用哪些能力，避免前端 JS 被注入后能调系统命令）系统管理权限。

`tauri/capabilities/default.json` 声明 `identifier: "default"`，作用于 `windows: ["main"]`，授予权限见上方速览表。

- 最近的几次 commit（`d44ec20`、`b2d36f6`、`d8fb51a`）正是为修复 Windows 下的最小化/最大化/关闭按钮与拖拽而补齐 `core:window:allow-*` 权限——没有 `allow-minimize` 前端调 `minimize()` 会被拒。
- `tauri-plugin-shell` 的 `shell:allow-execute` 等权限保留，但实际 spawn 走 `tokio::process::Command` 而非 shell 插件 API；二者并存不冲突，shell 插件在此项目中主要承担权限声明角色。

### macOS 行为

- `titleBarStyle: "Overlay"` + `macOSPrivateApi`，保留原生 traffic lights。
- 前端 `WindowControls` 组件在 macOS 上返回 `null`（用系统原生按钮）。
- `setup` 钩子在窗口初始化后延迟 100ms 调 `set_focus` 以确保 macOS 下正确获焦（workaround，macOS 首次获焦有时不稳）。

### Windows 行为

- `setup` 中 `set_decorations(false)` 去掉原生窗口边框（自绘无边框窗口）。
- `set_background_color(#F8FAFC)` 让无边框窗口细边与前端背景一致（macOS 不支持此 API 返回 not implemented，故仅 Windows 执行）。
- 前端 `WindowControls` 通过 `navigator.userAgent` 检测 Windows 后渲染最小化/最大化/关闭按钮。
- 订阅 `onResized` 同步最大化状态以切换图标（最大化时显示「还原」图标，否则显示「最大化」图标）。

---

## 与 engine 的集成方式

### SidecarManager（`src/sidecar/process.rs`）

负责拉起 Python engine 并维护单例。

#### 单例 + 懒启动

- `SidecarManager::new()` 不立即 spawn（构造时不拉起 engine）。
- 首次 `call()` 时若 `inner` 为 `None` 则调 `start()`。
- `inner: Mutex<Option<SidecarInner>>`（Mutex 互斥锁，Option 表示「可能还没有」）。
- `SidecarInner` 持有 `Transport`（管 stdin/stdout 读写）与 `Child`（tokio 的子进程句柄）。
- `seq: AtomicU64` 生成请求 id `req-<n>`（AtomicU64 是原子计数器，多线程下递增不用加锁）。

#### bundled vs dev 分流

`is_bundled()` + `sidecar_path()` + `engine_dir()` 判断当前是「打包后跑」还是「开发时跑」：

| 模式 | 判定 | engine 启动方式 | 工作目录 |
|------|------|----------------|---------|
| dev（debug 构建） | `is_bundled()` 强制返回 `false`（dev 下 `externalBin` 也会拷贝 `probe-engine` 到 exe 同目录，靠存在性无法区分） | `find_python()` 找 `python3`/`python`（或 `TAURI_PYTHON_PATH` 环境变量）运行 `engine/server.py` | `CARGO_MANIFEST_DIR/../engine`（编译期注入的源码 engine 目录） |
| release | 检查 exe 同目录下 `probe-engine`（Windows 为 `probe-engine.exe`）是否存在 | PyInstaller 二进制启动 | `$HOME` / `%USERPROFILE%`（bundled 二进制内部自行解析 DB 路径） |
| 覆盖 | — | `TAURI_ENGINE_PATH` 环境变量可覆盖 engine 路径（调试用） | — |

#### 传输协议（`src/sidecar/transport.rs`）

| 方向 | 帧 |
|------|-----|
| 请求（写入 stdin） | 一行 JSON `{ id, method, params }` |
| 响应（从 stdout 读取） | 一行 JSON `{ id, result?, error? }` |

- `read_response` 校验响应 `id` 与请求一致（防止串行错位）。
- stderr 不参与协议，仅由 engine 自身 `logging.basicConfig(stream=sys.stderr)` 输出日志（开发时在终端能看到 engine 的 print 日志）。

#### 生命周期

- `SidecarInner` 的 `Drop`（Rust 的析构：变量离开作用域时自动调的方法）调 `start_kill()`。
- `SidecarManager::stop()`（当前 `#[allow(dead_code)]`）调 `child.kill().await`。
- Tauri 应用退出时子进程随之被回收。

#### 请求映射

- 前端 `invoke` 的具名方法（如 `importFiles` → `method: "import_files"`）经 `engine_call` 命令进入 `SidecarManager::call`。
- 转发到 engine 的 `HANDLERS` 字典（见 [architecture.md](./architecture.md) 的方法表）。

---

## 备注

- `tauri/src/sidecar/process.rs` 的 `stop()` 方法目前被 `#[allow(dead_code)]` 标注，没有调用方；属原本就存在的预留代码，未在本次文档任务中改动。
- `tauri-plugin-shell` 的 `shell:allow-execute` 等权限保留在 capabilities 中，但实际 spawn 走 `tokio::process::Command`；二者并存不冲突。
- DB 路径解析与 FTS5（SQLite 全文搜索扩展）/ trigram（三元组索引）能力探测均在 engine 侧完成（`engine/probe/storage/connection.py`），Tauri 层不感知具体路径——这与「bundled 二进制内部自行解析 DB 路径」的设计一致。

---

## 术语表

- **Tauri** — 用 Rust 写的桌面应用框架，类似 Electron 但调用系统自带 WebView 而不打包整个 Chromium，安装包更小。
- **crate** — Rust 的编译单元，一个 crate 对应一个 `Cargo.toml`。
- **Cargo workspace** — 把多个 crate 放一起统一管理的组织方式；本项目只有一个 crate 所以没用。
- **`#[tauri::command]`** — Tauri 的宏标注；给 Rust 函数套上并在 Builder 里用 `generate_handler!` 注册，前端就能通过名字调到它（相当于「把这个 Rust 函数暴露成前端可调的 RPC 接口」）。
- **`tauri::Builder`** — Tauri 的应用构造器；链式调用注册插件、状态、命令 handler、setup 钩子。
- **capabilities**（能力声明）— Tauri v2 的白名单权限机制：默认所有原生能力都禁用，必须在 capabilities 文件里显式声明这个窗口能用哪些能力。
- **serde** — Rust 的序列化框架，把 Rust 结构体跟 JSON 互相转换；IPC 消息靠它编解码。
- **tokio** — Rust 的异步运行时，提供事件循环和异步进程/文件 API；这里用它管 engine 子进程的 stdin/stdout 异步读写。
- **thiserror** — Rust 的错误枚举派生宏，用 `#[derive(Error)]` 自动给 enum 实现 std 的 Error trait。
- **sidecar**（伴随子进程）— 跟主程序并排跑的独立子进程；这里指 engine。
- **`externalBin`** — `tauri.conf.json` 的项，告诉 Tauri 打包时把这个二进制一起带上；运行时怎么 spawn 由自己的代码决定。
- **PyInstaller** — 把 Python 脚本和解释器打包成单个可执行文件的工具。
- **NSIS** — 开源的 Windows 安装包制作工具。
- **DMG** — macOS 的磁盘镜像安装包格式。
- **CSP**（Content Security Policy）— 浏览器的内容安全策略，限制能加载哪些来源的脚本/样式。
- **Mutex**（互斥锁）— 保证同一时刻只有一个线程在读写共享资源。
- **AtomicU64** — 原子计数器，多线程下递增不用加锁。
- **`Drop`** — Rust 的析构；变量离开作用域时自动调的方法。
- **`setup` 钩子** — Tauri 启动时调一次的初始化函数。
- **traffic lights** — macOS 左上角红黄绿三个圆点按钮，对应最小化/最大化/关闭。
- **FTS5**（Full-Text Search version 5）— SQLite 的全文搜索扩展。
- **trigram**（三元组索引）— 一种模糊搜索方式。
- **SQLite** — 轻量级单文件数据库，不需要单独起服务。
