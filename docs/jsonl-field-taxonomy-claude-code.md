# Claude Code JSONL 字段层级分类法

- **来源**:
  - **Tier-1 权威 schema 源（本轮新增）**: Rust crate `claude-code-transcripts` v0.1.11（repo `alfredvc/cct`，文件 `crates/claude-code-transcripts/src/types.rs`，2026-05 发布）。该 crate 在 `Entry` 枚举上标注 `#[serde(tag = "type")]`、在每个变体/字段上标注 `#[serde(rename = "...")]`，并带 `#[serde(other)] Unknown` 兜底，是 Claude Code JSONL schema 的权威类型化来源。
    - https://github.com/alfredvc/c ct/blob/main/crates/claude-code-transcripts/src/types.rs
    - https://docs.rs/claude-code-transcripts/latest/claude_code_transcripts/types/enum.Entry.html
    - https://lib.rs/crates/claude-code-transcripts (v0.1.11, 2026-05)
  - Probe 自研反向工程解析器 (`engine/probe/claude_code_adapter/parser.py`、`reader.py`)
  - 实际样本文件
  - 归档研究笔记
  - 公开社区资料（独立解析器 + Anthropic issue + 社区文章，用于交叉验证）
- **样本目录**: `samples/claude-code/`
- **日期**: 2026-07-04
- **范围**: 聚焦 UI 展示所需字段。所有字段声明必须可溯源；不确定的标 ⚠️，不臆造字段。

---

## 速览

### 顶层结构特征

**Claude Code 每行是扁平对象**，顶层 `type` 字段标记记录大类，数据字段直接平铺在顶层（无包裹层）。会话内容（对话消息）统一存放在 `message.content[]` 中。

### 顶层字段（L1，多数行共享）

下表按**原始 JSONL 字段书写顺序**编排（消息行：`parentUuid` → `isSidechain` → `agentId`/`promptId` → `message`/`attachment` → `type` → `uuid` → `timestamp` → 元数据尾段；元数据行：`type` → 业务字段 → `sessionId` → 元数据尾段）。

| 字段 | 类型 | 频率 | 说明 |
|------|------|------|------|
| `parentUuid` | string\|null | ~72% | 前驱记录 uuid；null = 会话根 |
| `isSidechain` | bool（Envelope 必填） | ~72% | 是否 sidechain 行；`Envelope` 基类必填字段（非 Option），每条消息记录都携带；导出时剥离（见下文 sidechain 章节） |
| `agentId` | string | ~sidechain 行 | 7 字符 hex id（仅 sidechain 行） |
| `promptId` | string | ~21% | 提示 ID |
| `message` | object | ~58% (user/assistant) | 对话消息体（role/content/model/usage/...） |
| `attachment` | object | 低 (attachment 行) | 附件体（`{type, ...}`） |
| `type` | string (必填) | 100% | 记录大类，决定行结构 |
| `subtype` | string | system 行 | system 行二次分派 |
| `uuid` | string | ~72% | 本记录的线程 ID |
| `timestamp` | string (ISO 8601) | ~73% | 时间戳；元数据行常缺失 |
| `userType` | string | ~90% | 调用方类别（如 `external`） |
| `entrypoint` | string | ~90% | 发起端（如 `cli`、`sdk-cli`） |
| `cwd` | string | ~90% | 工作目录 |
| `sessionId` | string | ~99% | 会话 UUID |
| `version` | string | ~90% | Claude Code CLI 版本号（如 `2.1.177`、`2.2.0`） |
| `gitBranch` | string | ~90% | Git 分支名 |

### type（L1 字段 — 完整枚举）

顶层 `type` 字段标记记录大类。Tier-1 源（`claude-code-transcripts` 的 `Entry` 枚举，`#[serde(tag = "type")]` + `#[serde(other)] Unknown` 兜底）定义 **25 个已知变体**。下表按"样本支撑 / 仅解析器源码支撑 ⚠️"分组。

> ⚠️ `#[serde(other)] Unknown` 兜底意味着未来/未知 `type` 会被静默跳过；因此 25 个是**解析器已知集**，不保证覆盖所有 CLI 版本的全部 `type`。

**样本支撑**（Probe 样本/解析器已见）:

| `type` 值 | 样本频率 | payload 特征 |
|-----------|---------|-------------|
| `assistant` | 高 (22) | `message.content[]` block 数组 |
| `user` | 高 (19) | `message.content` (字符串或 block 数组) |
| `system` | 中 (7) | 由 `subtype` 二次分派 |
| `mode` | 每文件 1 条 (7) | 扁平字段 `mode` |
| `last-prompt` | 每文件 ≤1 (4) | 扁平字段 `lastPrompt`/`leafUuid` |
| `ai-title` | 每文件 ≤1 (4) | 扁平字段 `aiTitle` |
| `attachment` | 低 (3) | `attachment.{type,...}` |
| `permission-mode` | 每文件 ≤1 (2) | 扁平字段 `permissionMode` |
| `queue-operation` | 极低 (1) | 扁平字段 `operation`/`content` |
| `file-history-snapshot` | 极低 (1) | `snapshot.{...}` |
| `agent-name` | 极低 (1) | 扁平字段 `agentName`（仅 sidechain） |

**仅 Rust 解析器源码支撑 ⚠️**（样本未见，由 Tier-1 源确认存在；字段结构多为推测）:

| `type` 值 | 推测 payload 特征 | 备注 |
|-----------|------------------|------|
| `summary` | 无信封 4 键（见 [summary](#summary) 章节） | 会话文件首行，压缩后续接 |
| `progress` | ⚠️ 未确认 | 进度记录 |
| `custom-title` | 扁平字段（标题文本）⚠️ | 自定义标题 |
| `agent-color` | 扁平字段（颜色值）⚠️ | sidechain 代理颜色 |
| `agent-setting` | ⚠️ 未确认 | 代理配置 |
| `tag` | ⚠️ 未确认 | 会话标签 |
| `task-summary` | ⚠️ 未确认 | 任务摘要 |
| `pr-link` | ⚠️ 未确认 | PR 链接 |
| `worktree-state` | ⚠️ 未确认 | worktree 状态 |
| `content-replacement` | ⚠️ 未确认 | 内容替换（学术论文 §8.3 引用） |
| `attribution-snapshot` | ⚠️ 未确认 | 归因快照（学术论文 §8.3 引用） |
| `marble-origami-commit` | ⚠️ 未确认 | 内部代号，字段结构未知 |
| `marble-origami-snapshot` | ⚠️ 未确认 | 内部代号，字段结构未知 |
| `speculation-accept` | ⚠️ 未确认 | 推测接受记录 |

> 频率列来自 9 个样本文件、共 71 行的统计。`folder-protect` **确认不存在**（见下文 folder-protect 章节）。

### system 的 subtype 枚举

`type=system` 的行通过 `subtype` 字段二次分派。Tier-1 源 + 样本 + Anthropic issue #53516 交叉确认的 `subtype` 值：

| `subtype` | 频率 | 关键字段 | 来源 |
|-----------|------|---------|------|
| `turn_duration` | 2 | `durationMs`, `messageCount`, `level` | 样本 |
| `compact_boundary` | 2 | `compactMetadata`（`preTokens`/`postTokens`/`durationMs`/`preservedSegment`）, `logicalParentUuid` | 样本 |
| `microcompact_boundary` | ⚠️ 0 | 同 `compact_boundary` | Tier-1 源 |
| `local_command` | 1 | `content` | 样本 |
| `away_summary` | 1 | `content` | 样本 |
| `api_error` | 1 | `error`, `retryInMs`, `retryAttempt`, `maxRetries` | 样本 |
| `informational` | ⚠️ 0 | `content` | Tier-1 源 + 解析器隐藏列表 |
| `stop_hook_summary` | ⚠️ 0 | `hookCount`, `hookInfos[]`, `hookErrors`, `preventedContinuation`, `stopReason`, `hasOutput`, `toolUseID`, `durationMs`, `messageCount` | Tier-1 源（见下文 Hooks 章节） |
| `hook_callback` | ⚠️ 0 | hook 回调详情 | Tier-1 源（仅 `--include-hook-events` 启动时出现） |

### message.content[] block 类型（核心 — 对话存于此）

| block `type` | 出现于 | 样本频率 | 关键字段 | 来源 |
|--------------|--------|---------|---------|------|
| `text` | user / assistant | 高 (12+) | `text` | 样本 |
| `tool_use` | assistant | 8 | `id`, `name`, `input` | 样本 |
| `tool_result` | user | 8 | `tool_use_id`, `content`, `is_error` | 样本 |
| `thinking` | assistant | 4 | `thinking`, `signature` | 样本 |
| `image` | user | 1 | `source.{type, media_type, data}` | 样本 |

### 卡片展示策略

```
卡片 1: type                         ← 顶层 type
卡片 2: subtype / attachment.type     ← system.subtype 或 attachment.type
卡片 3: message.content[].type        ← user/assistant 的 content block 判别字段
卡片 4: message.content[].name        ← tool_use block 的工具名
卡片 N: timestamp                    ← timestamp
```

### 嵌套深度统计

Claude Code 的嵌套发生在 `message.content[]` 内部：

| 深度 | 示例 | 频率 |
|------|------|------|
| L1 | `type`, `message`, `cwd` | 100% |
| L2 | `message.content[]`, `message.usage`, `compactMetadata` | ~58% |
| L3 | `content[].input`（工具参数）、`content[].source`、`usage.cache_creation` | ~30% |
| L4 | 工具参数内部字段（如 Agent `input.prompt`、Edit `input.old_string`） | ~15% |

---

## 顶层结构

每行 JSONL 是一个扁平对象，顶层 `type` 字段标记记录大类，数据字段直接平铺在顶层。下面是一条真实 user 行的字段**原始书写顺序**：

```json
{
  "parentUuid": null,
  "isSidechain": false,
  "promptId": "...",
  "type": "user",
  "message": { "role": "user", "content": "..." },
  "uuid": "thr_u1",
  "timestamp": "2026-07-01T16:00:00.000000Z",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/Users/placeholder/project",
  "sessionId": "claude-threading-parity-session",
  "version": "2.1.177",
  "gitBranch": "main"
}
```

> 字段顺序并非规范化契约，但实测稳定：消息行按 `parentUuid → isSidechain → [agentId] → [promptId] → message/attachment → type → [subtype] → uuid → timestamp → userType → entrypoint → cwd → sessionId → version → gitBranch` 排列；元数据行（ai-title/mode/permission-mode/last-prompt 等）按 `type → 业务字段 → sessionId → userType → entrypoint → cwd → version → gitBranch` 排列。Claude Code 没有 `payload` 包裹层，`type` 决定其余字段含义，但所有字段都在顶层。

---

## type

顶层字段，决定行结构。以下逐个枚举。

### user

用户输入或工具结果回填。最高频类型之一。

- **payload 特征**: `message.content` 是**字符串**（纯文本输入）或 **block 数组**（`tool_result` / `image` / `text` 块）。
- **关键标识字段**: `message.role`（恒为 `user`）。
- **行级 `Option<bool>` 字段 `isCompactSummary`**: 当为 `true` 时，该 user 消息是**压缩摘要注入**（承载压缩后的上下文文本）。Live compaction 会**同时**写入两条：(a) `type:"system"` + `subtype:"compact_boundary"`（携带可选 `compactMetadata`: `preTokens`/`postTokens`/`durationMs`/`preservedSegment`）；(b) `type:"user"` + `isCompactSummary:true`（含压缩文本）。⚠️ `isCompactSummary` 属于 **`user` 行**，**不是** `summary` 行的字段；样本未直接见 `true` 行，由 Tier-1 源确认。
- **UI 展示**: 纯文本 → `user_input` 事件；`tool_result` 块 → `tool_output` 事件；`image` 块 → `input_image` 事件。

### assistant

AI 回复。最高频类型。

- **payload 特征**: `message.content` 是 **block 数组**（`text` / `tool_use` / `thinking` 三选多）。
- **行级附加字段**: `message.model`、`message.id`、`message.stop_reason`、`message.usage`（这些是 API 响应属性，挂在行上而非单个 block 上）。
- **UI 展示**: `thinking` → `assistant_update`/phase=thinking；`text` → `assistant_output`；`tool_use` → `tool_call`。

### system

系统事件行，由 `subtype` 二次分派。

- **payload 特征**: `subtype` 字段决定具体含义。
- **UI 展示**:
  - `api_error` → 富错误卡片（重试上下文）
  - `compact_boundary` → 压缩卡片（token 计数）
  - `local_command` → `tool_event`
  - `away_summary` / `informational` / `turn_duration` → 隐藏元数据（仍携带 native identity）

### mode

模式切换记录。每文件 1 条。

- **关键字段**: `mode`（如 `bypassPermissions`）。
- **UI 展示**: 隐藏元数据，`claude_event_type=mode`。

### permission-mode

权限模式记录。每文件 ≤1 条。

- **关键字段**: `permissionMode`（如 `bypassPermissions`）。
- **UI 展示**: 隐藏元数据，`claude_event_type=permission-mode`。

### ai-title

AI 生成的会话标题。每文件 ≤1 条。

- **关键字段**: `aiTitle`（字符串）。
- **UI 展示**: 隐藏元数据；其 `aiTitle` 被 Probe 用作会话标题（覆盖"首条用户输入"回退）。

### last-prompt

最后一条用户提示的游标。每文件 ≤1 条。

- **关键字段**: `lastPrompt`（提示文本）、`leafUuid`（叶节点 uuid）。
- **UI 展示**: 隐藏元数据。

### attachment

附件行，由 `attachment.type` 二次分派。承载 Hook 输出、skill 列表、命令权限、编辑快照等。

- **payload 特征**: `attachment.{type, ...}`。
- **样本已确认 `attachment.type`**: `hook_success`、`skill_listing`。
- **Hook 相关判别值（共 8 个，见下文 Hooks 记录路径章节）**: `hook_success`、`hook_non_blocking_error`、`hook_blocking_error`、`hook_cancelled`、`hook_additional_context`、`hook_permission_decision`、`hook_stopped_continuation`、`hook_system_message`。
- **UI 展示**:
  - hook 执行结果、权限、阻断、取消、停止续写、`hook_additional_context` 以及 SessionStart workflow/session-context hook → 可见 `system_event`，`claude_event_type=hook`，携带 `hookName`/`hookEvent`/`command`/`exitCode`/`durationMs`/`stdout`/`decision`/`message` 等可用字段。
  - 如果这些可见 hook 出现在首个 user anchor 之前，或形成没有 `user_input`/`assistant_output` 锚点的 metadata turn，前端 graph layout 负责把它们按源顺序接入主时间线，而不是在 parser 中按 workflow 名称或上下文内容隐藏。
  - 其余（`skill_listing` 等）→ 隐藏元数据，`claude_event_type` 设为 `attachment.type` 原值。

### queue-operation

排队用户消息（代理忙时入队）。极低频，Claude Code 特有。

- **关键字段**: `operation`（`enqueue`/`dequeue`）、`content`（排队提示文本）。
- **UI 展示**: 提升为 `user_input` 事件，`claude_event_type=queue_operation`。

### file-history-snapshot

文件历史快照（tracked file 备份点）。

- **payload 特征**: `snapshot.{messageId, trackedFileBackups, timestamp}`、`messageId`、`isSnapshotUpdate`。
- **UI 展示**: 隐藏元数据。

### agent-name

子代理名称记录。仅 sidechain 文件中出现。

- **关键字段**: `agentName`。
- **UI 展示**: 隐藏元数据；其值被 Probe 用作 `agent_nickname`。

### summary

⚠️ **未在 Probe 样本中出现**，但 Tier-1 源（`claude-code-transcripts`）+ 独立 Go 解析器（`fabriqaai/claude-code-logs`）+ DuckDB 文章三方交叉确认。

- **性质**: 极简的**无信封**元数据行 —— **不携带** `uuid`/`parentUuid`/`timestamp`/`version`/`cwd`。
- **确切 4 键**:
  - `type`: `"summary"`
  - `leafUuid`: string —— 指向**前一次压缩**会话的叶节点
  - `summary`: string —— 压缩摘要文本
  - `sessionId`: string
- **写入时机**: 作为会话文件的**第一行**写入，用于在先前一次压缩后恢复会话；`leafUuid` 引用先前对话树的叶。
- **关键区分**: `isCompactSummary` **不是** `summary` 行的字段，而是 `type:"user"` 行上的 `Option<bool>` 字段（见 [user](#user)）。`groupCount` **不存在**（系早期草稿的臆造字段，已撤回）。
- **UI 展示**: Probe 当前解析器将其落入 "Unhandled Claude record" 分支（隐藏元数据）。如需展示需扩展解析器。

### folder-protect（确认不存在）

⚠️ **确认不存在** —— Tier-1 源（`claude-code-transcripts` 的 `Entry` 枚举）无此变体，且 Rust 源码中 `folder` 子串完全不出现。早期草稿据社区资料间接提及，现已撤回。文件夹保护通过 `settings.json` 的 `permissions` 树 + OS 沙盒实现，非 JSONL 记录类型。

---

## message 内部结构

`user.message` 与 `assistant.message` 是对话的核心载体。**Claude Code 把整段对话塞进 `user.message` / `assistant.message` 的 `content[]` 块数组**。

### message 顶层字段

下表按**原始 `message` 对象字段书写顺序**编排（assistant 行实测）。

| 字段 | 类型 | 出现于 | 说明 |
|------|------|--------|------|
| `id` | string | assistant | API 响应消息 ID |
| `type` | string | assistant | 恒为 `message` |
| `role` | string | user/assistant | `user` 或 `assistant` |
| `model` | string | assistant | 模型名（如 `claude-sonnet-4-20250514`、`z-ai/glm-5.2-free`） |
| `content` | string\|array | user/assistant | 消息正文（字符串或 block 数组） |
| `usage` | object | assistant | token 用量（见下） |
| `stop_reason` | string | assistant | `end_turn` / `tool_use` 等 |
| `stop_details` | string\|null | assistant | 停止详情 |

### content 块：text

纯文本块，user / assistant 均可。

```json
{ "type": "text", "text": "Routing api_error to event_type=error." }
```

### content 块：tool_use

工具调用块，仅 assistant。这是 Claude Code 工具调用的载体。

```json
{
  "type": "tool_use",
  "id": "call_bash_1",
  "name": "Bash",
  "input": { "command": "python -m pytest ...", "description": "Run new parity test" }
}
```

- **关键字段**: `id`（call_id）、`name`（工具名）、`input`（参数对象）。
- **样本已确认 `name` 值**: `Bash`、`Read`、`Grep`、`Edit`、`Write`、`Agent`、`mcp__fast-context-mcp__fast_context_search`。
- **`input` 形状随 `name` 而变**（L4 嵌套）:
  - `Bash`: `{command, description}`
  - `Read`: `{file_path, ...}`
  - `Grep`: `{pattern, path, ...}`
  - `Edit`: `{replace_all, file_path, old_string, new_string}`
  - `Write`: `{file_path, content}`
  - `Agent`/`Task`: `{description, model, subagent_type, prompt}`
  - `WebSearch`: `{query, ...}`；`WebFetch`: `{url, prompt}`
  - `mcp__<server>__<tool>`: 工具特定参数（解析器拆分 `mcp__` 前缀得到 server/tool）

### content 块：tool_result

工具结果块，仅 user。

```json
{
  "type": "tool_result",
  "tool_use_id": "call_grep_1",
  "content": "<tool_use_error>Error: No such file or directory</tool_use_error>",
  "is_error": true
}
```

- **关键字段**: `tool_use_id`（== 产生它的 tool_use.id）、`content`（字符串**或** `{type:"text",text}[]`）、`is_error`（bool）。
- **行级附加字段**: `toolUseResult`（常出现在 Bash 结果行）= `{stdout, stderr, interrupted, isImage, noOutputExpected}`；`sourceToolAssistantUUID`（产生该结果的 assistant turn uuid）。
- **解析器配对**: 通过 `tool_use_id` == `call_id` 回查产生它的 tool_use，把工具专属字段（Bash 的 command/exit_code、Edit 的 file_path/old_string）提升到 tool_output 事件上。
- **Bash 退出码特殊处理**: Claude Code **没有结构化 exit_code 字段**；失败时退出码嵌在 `content` 文本里（`Exit code N\n<stderr>`），解析器用正则恢复。

### content 块：thinking

推理块，仅 assistant。

```json
{
  "type": "thinking",
  "thinking": "I should explain the minimal platform-aware plumbing...",
  "signature": "sample-signature"
}
```

- **关键字段**: `thinking`（推理文本）、`signature`（签名）。

### content 块：image

粘贴图片块，仅 user。罕见。

```json
{
  "type": "image",
  "source": { "type": "base64", "media_type": "image/jpeg", "data": "..." }
}
```

- **关键字段**: `source.type`（`base64`）、`source.media_type`、`source.data`（base64）。
- **UI 展示**: base64 数据**不**存入事件元数据（过大）；仅 `media_type` + 占位符上浮。

### usage 字段（assistant 行级）

```json
"usage": {
  "input_tokens": 8200,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 4100,
  "output_tokens": 64,
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
  "service_tier": "standard",
  "cache_creation": { "ephemeral_1h_input_tokens": 0, "ephemeral_5m_input_tokens": 0 },
  "speed": "standard"
}
```

- Claude Code usage **没有** `total_tokens` 与 reasoning token，由解析器派生。
- **缓存拆分**: `cache_creation_input_tokens`（写）+ `cache_read_input_tokens`（命中）；前端"Cached"列映射到 `cache_read_input_tokens`。
- **无会话累计 usage**: 每条 assistant 行的 usage 是该回合的；会话级 metrics 由解析器按 source_line_no 去重累加得到。

### 线程字段（每行）

按原始书写顺序（system 行实测）：`parentUuid → logicalParentUuid → uuid`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `parentUuid` | string\|null | 前驱 uuid；null = 会话根 |
| `logicalParentUuid` | string | 仅 `compact_boundary` 行；当 `parentUuid` 为 null 时用于 fork 链接 |
| `uuid` | string | 本记录的线程 ID |

解析器用 `uuid`/`parentUuid` 构造 DAG 做拓扑排序（Kahn 算法），使压缩 fork（经 `logicalParentUuid` 链接）落在正确位置，而非按原始时间戳/行号。

---

## 子代理 sidechain 文件

子代理 sidechain 是独立的 JSONL 文件，与父会话**不在同一文件**。

### `isSidechain` 与 Envelope 基类字段

`isSidechain` 是 **`Envelope` 基类上的必填顶层布尔**（非 `Option`，非仅首行）—— 每条**消息记录**（user/assistant）都携带；`true` 表示 sidechain/子代理记录，`false` 表示主线程。`Envelope` 还携带下列代理标识字段（均 `Option<String>`）:

| 字段 | 类型 | 说明 |
|------|------|------|
| `isSidechain` | bool（必填） | 是否 sidechain 行 |
| `agentId` | Option<String> | 7 字符 hex id（仅 sidechain） |
| `teamName` | Option<String> | 团队名 |
| `agentName` | Option<String> | 代理名 |
| `agentColor` | Option<String> | 代理颜色 |

### 文件布局

```
~/.claude/projects/<project-slug>/
├── <parent-session-uuid>.jsonl                          ← 父会话
└── <parent-session-uuid>/subagents/
    └── agent-<id>.jsonl                                  ← 子代理 sidechain（自有 sessionId + agentId）
```

### sidechain 行特征

每个 sidechain 文件有**自己的 `sessionId`**（非父会话 ID）与 `agentId`，每行 `isSidechain:true`：

```json
{
  "isSidechain": true,
  "agentId": "a1b2c3d",
  "sessionId": "<sidechain-own-session-uuid>",
  "cwd": "/workspace/probe-sample/root-tooling/subagents",
  ...
}
```

### 父子配对与数据回流

- **DB 链接（路径启发式）**: 父 sessionId = sidechain 文件的祖父目录名。
- **流内标记（跨文件合成）**: 父会话中 dispatch 一个 `Agent`/`Task` tool_use（`input.prompt` 匹配 sidechain 首条 user_input），解析器在父事件流中注入合成 `subagent_session` 标记，携带 `child_session_id`/`prompt_preview`/`agent_nickname`/`agent_role`。
- **数据回流**: 子代理的**完整历史不并入**父会话；仅子代理的**最终回复文本**作为 `tool_result` content block 回到父对话（**不是** `type:"summary"` 行）。
- `agent_nickname` 优先取 `type=agent-name` 行的 `agentName`，回退到顶层 `agentId`。
- `agent_role` 取 `attributionAgent`/`attributionSkill`/`attributionPlugin`。

### ⚠️ 导出时剥离

`isSidechain` 是**运行时字段**，导出时被剥离。反编译的 `sessionStorage.ts` 显示: `const { isSidechain, parentUuid, ...serializedMessage } = m`（即 `isSidechain` 与 `parentUuid` 同时被剥离）。来源: https://kenhuangus.substack.com/p/chapter-5-trajectory-compression

---

## Hooks 记录路径

Hooks **没有自己的顶层 `type`**。共有两条记录路径：

### 1. 单次 hook 执行记录 — `type:"attachment"`

通过 `attachment.type` 的 8 个判别值之一记录：

| `attachment.type` | 载荷结构 | 说明 |
|-------------------|---------|------|
| `hook_success` | `HookResultAttachment` | hook 正常成功 |
| `hook_non_blocking_error` | `HookResultAttachment` | hook 出错但不阻断 |
| `hook_blocking_error` | `HookResultAttachment` | hook 出错并阻断 |
| `hook_cancelled` | `HookResultAttachment` | hook 被取消 |
| `hook_additional_context` | 富变体 → `content`（数组） | hook 注入额外上下文；SessionStart Trellis/session context payload 仍作为可见 hook 事件保留，图中并入首个主 user turn 的正常 spine/folder 布局 |
| `hook_permission_decision` | 富变体 → `decision` | hook 决定权限 |
| `hook_stopped_continuation` | 富变体 → `message` | hook 阻止继续 |
| `hook_system_message` | 富变体 → `content`（字符串） | hook 输出系统消息 |

- **4 个结果变体**（`hook_success`/`hook_non_blocking_error`/`hook_blocking_error`/`hook_cancelled`）共享结构 `HookResultAttachment`，wire 字段（全部 `Option`，缺省省略）: `hookName`、`toolUseID`、`hookEvent`、`content`、`stdout`、`stderr`、`exitCode`、`command`、`durationMs`、`blockingError`。
- **4 个富变体**各携带 `{hookName, toolUseID, hookEvent}` 加一个载荷字段（见上表"载荷结构"列）。

> ⚠️ **易混淆点**: `additionalContext` 与 `hookSpecificOutput` 是 **hook 自身输出 JSON** 的字段（见官方 hook I/O 契约 https://code.claude.com/docs/en/hooks），**不是**转录记录字段。`hook_failure`/`hook_error` 判别名**不存在**（真实的是上述 8 个）。

### 2. 聚合 — `type:"system"` + `subtype:"stop_hook_summary"`

Stop 生命周期会发出一条 `type:"system"` 行，`subtype:"stop_hook_summary"`，字段: `hookCount`、`hookInfos[]`（`{command, durationMs}`）、`hookErrors`、`preventedContinuation`、`stopReason`、`hasOutput`、`toolUseID`、`durationMs`、`messageCount`。

> `system/hook_callback` 行仅在以 `--include-hook-events` 启动时出现。

---

## 参考来源

### 项目内（权威 — Probe 实际解析）
- `engine/probe/claude_code_adapter/parser.py`（揭示全字段集，最佳单点来源）
- `engine/probe/claude_code_adapter/reader.py`（文件识别 + type 枚举识别集）
- `samples/claude-code/**/*.jsonl`（9 个文件，含 2 个 sidechain）

### 归档研究笔记
- `.trellis/tasks/archive/2026-07/07-03-claude-code-parser-parity/research/claude-code-raw-field-map.md`（样本确认的字段路径）
- `.trellis/tasks/archive/2026-07/07-03-claude-code-parser-parity/research/parity-matrix.md`
- `.trellis/tasks/archive/2026-07/07-02-claude-code-jsonl-support/research/claude-jsonl-public-references.md`（公开资料汇总）

### Tier-1 权威源（本轮获取 ✅）
- **`claude-code-transcripts` Rust crate v0.1.11**（主 schema 源，`Entry` 枚举 + `#[serde(rename)]` 全标注）: https://github.com/alfredvc/cct/blob/main/crates/claude-code-transcripts/src/types.rs
- 变体→snake_case 映射 + JSONL 测试夹具: https://github.com/alfredvc/cct/blob/main/crates/claude-code-transcripts-ingest/src/parse.rs
- docs.rs API 文档: https://docs.rs/claude-code-transcripts/latest/claude_code_transcripts/types/enum.Entry.html
- 独立 Go 解析器（交叉确认 `summary` 4 字段）: https://github.com/fabriqaai/claude-code-logs/blob/main/types.go
- Anthropic issue #53516（独立顶层 type 列表 + system.subtypes，v2.1.118/119）: https://github.com/anthropics/claude-code/issues/53516
- Anthropic issue #60591（官方 sidechain 布局 + 字段）: https://github.com/anthropics/claude-code/issues/60591
- Anthropic issue #66486（确认 `ai-title` stub 记录）: https://github.com/anthropics/claude-code/issues/66486
- DuckDB 分析（真实 `head -1` keys = `["leafUuid","summary","type"]`，含 `parentUuid`/`isSidechain`/`userType` 实例）: https://liambx.com/blog/claude-code-log-analysis-with-duckdb
- 学术论文 §8.3 sidechain 架构（引用 `content-replacement` + `attribution-snapshot` 记录）: https://arxiv.org/html/2604.14228v2
- 反编译 `sessionStorage.ts`（`isSidechain` 导出剥离）: https://kenhuangus.substack.com/p/chapter-5-trajectory-compression
- 官方 hook I/O JSON 契约（`additionalContext`/`hookSpecificOutput` 修正依据）: https://code.claude.com/docs/en/hooks
- claude-dev.tools 字段指南: https://claude-dev.tools/docs/jsonl-format

### 公开社区资料（归档笔记 / 辅助）
- lib.rs crate 页: https://lib.rs/crates/claude-code-transcripts
- claude-code-history-viewer: https://github.com/jhlee0409/claude-code-history-viewer
- claude-code-viewer: https://github.com/d-kimuson/claude-code-viewer

> ⚠️ 公开社区资料**不**构成稳定契约；本文档以 **Tier-1 Rust 解析器**为权威 schema 源，本地样本 + Probe 解析器为字段实证，公开资料用于交叉验证与样本未覆盖字段。
