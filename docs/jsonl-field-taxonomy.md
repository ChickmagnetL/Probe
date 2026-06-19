# Codex JSONL 字段层级分类法

- **来源**: `openai/codex` 源码 (`codex-rs/protocol/src/protocol.rs`、`models.rs`、`items.rs`), 实际样本文件
- **样本目录**: `samples/codex-cli/`
- **日期**: 2026-06-16（更新 2026-06-17）
- **动机**: 当前 UI 展示的 `kind`/`role` 是解析器合成的分类标签，非 JSONL 原文字段。需要建立基于原文的字段层级模型，重构信息展示。
- **范围**: 聚焦 UI 展示所需字段，非 JSONL 协议完整规格。EventMsg 共 76 种类型，此处仅列出产生可点击节点的 ~27 种。

---

## 速览

### 顶层字段（L1）

每行 JSONL 只有 3 个顶层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string (必填) | 记录大类，6 种枚举值 |
| `payload` | object (可选) | 数据体，结构由 `type` 决定 |
| `timestamp` | string (可选) | ISO 8601 时间戳 |

#### type（L1 字段 — 6 种值）

| `type` 值 | 频率 | payload 特征 | 说明 |
|-----------|------|-------------|------|
| `response_item` | 高 | 有 payload.type（16 种） | LLM 响应数据 |
| `event_msg` | 高 | 有 payload.type（76 种） | 系统事件 |
| `session_meta` | 每文件 1 条 | 无 payload.type，扁平字段 | 会话启动元信息 |
| `turn_context` | 每回合 1 条 | 无 payload.type，扁平字段 | 回合上下文（不产生事件节点） |
| `inter_agent_communication` | 低频 | 无 payload.type，扁平字段 | 代理间通信元数据 |
| `compacted` | 极低 | 无 payload.type，扁平字段 | 上下文压缩摘要（遗留） |

#### payload（L1 字段 — 由 type 决定结构）

##### response_item 的 payload.type（16 种）

| `payload.type` | 关键标识字段 | 说明 |
|----------------|-------------|------|
| `message` | `role` | LLM 对话消息 |
| `function_call` | `name` | 工具调用 |
| `function_call_output` | `call_id` | 工具返回 |
| `reasoning` | — | 推理内容（加密） |
| `agent_message` | `author` / `recipient` | 代理间消息 |
| `local_shell_call` | `action` | 本地 shell 执行 |
| `web_search_call` | `id` | 网页搜索调用 |
| `image_generation_call` | `id` | 图片生成调用 |
| `custom_tool_call` | `name` | 自定义工具调用 |
| `custom_tool_call_output` | `call_id` | 自定义工具返回 |
| `tool_search_call` | — | 工具搜索执行 |
| `tool_search_output` | — | 工具搜索结果 |
| `compaction` | — | 压缩内容 |
| `compaction_trigger` | — | 压缩触发 |
| `context_compaction` | — | 上下文压缩 |
| `other` | — | 未知类型 (catch-all) |

##### event_msg 的 payload.type（UI 相关 ~27 种）

| `payload.type` | 关键标识字段 | 说明 | 嵌套深度 |
|----------------|-------------|------|---------|
| `token_count` | — | Token 用量统计 | L4 |
| `guardian_assessment` | `risk_level` | 安全审查 | L2 |
| `guardian_warning` | `risk_level` | 安全警告 | L2 |
| `error` | `error_type` | 错误 | L2 |
| `stream_error` | `error_type` | 流式错误 | L2 |
| `agent_message` | `phase` | Agent 消息事件（事件快照，非消息本体） | L2 |
| `user_message` | — | 用户消息事件（事件快照，非消息本体） | L2 |
| `agent_reasoning` | — | Agent 推理 | L2 |
| `exec_command_begin` | `command` | 命令开始执行 | L2 |
| `exec_command_end` | `command` | 命令执行结果 | L2 |
| `patch_apply_begin` | — | 补丁开始应用 | L2 |
| `patch_apply_end` | — | 补丁应用结果 | L2 |
| `mcp_tool_call_end` | `invocation.server` + `invocation.tool` | MCP 外部工具调用结果 | L5 |
| `view_image_tool_call` | `path` | 查看图片 | L2 |
| `web_search_begin` | `query` | 网页搜索开始 | L2 |
| `web_search_end` | `query` | 网页搜索结果 | L2 |
| `hook_started` | `hook_name` | Hook 开始 | L2 |
| `hook_completed` | `hook_name` | Hook 完成 | L2 |
| `task_started` | — | 回合开始 | L2 |
| `task_complete` | `duration_ms` | 回合完成 | L2 |
| `turn_aborted` | `reason` | 回合中止 | L2 |
| `collab_agent_spawn_end` | `receiver_agent_nickname` | 子代理创建 | L2 |
| `collab_agent_interaction_end` | — | 代理间交互结束 | L2 |
| `collab_waiting_end` | — | 代理等待结束 | L2 |
| `collab_close_end` | — | 代理关闭 | L2 |
| `context_compacted` | — | 上下文压缩 | L2 |
| `thread_rolled_back` | `reason` | 线程回滚 | L2 |
| `turn_diff` | — | 回合差异 | L2 |
| `plan_update` | — | 计划更新 | L2 |
| `thread_goal_updated` | `goal` | 线程目标更新 | L2 |

其他 ~50 种（不产生独立可点击节点）：`agent_message_content_delta`、`reasoning_content_delta`、`collab_agent_spawn_begin`、`mcp_tool_call_begin`、`image_generation_begin`/`end`、`exec_approval_request`、`request_permissions`、`request_user_input`、`mcp_startup_update`、`mcp_startup_complete`、`realtime_conversation_*`、`model_reroute`、`dynamic_tool_call_request`/`response`、`elicitation_request` 等。

##### 无 payload.type（扁平 payload，共 4 种）

`session_meta`、`turn_context`、`inter_agent_communication`、`compacted` 的 payload 没有 `payload.type`，字段直接平铺。字段详情见下方 payload 章节。

#### timestamp（L1 字段）

ISO 8601 时间戳，每条记录一个。在所有卡片中统一展示为 Time。

### 卡片展示策略

```
卡片 1: Record Type   ← type（JSONL 顶层）
卡片 2: Payload Type  ← payload.type（没有则跳过）
卡片 3: 关键标识字段   ← 按上表映射（没有则跳过）
卡片 N: Time          ← timestamp
```

### 嵌套深度统计

| 深度 | 示例 | 频率 |
|------|------|------|
| L1 | `type`, `payload` | 100% |
| L2 | `payload.type`, `payload.role` | ~95% |
| L3 | `payload.base_instructions.text`, `payload.info.total_token_usage` | ~15% |
| L4 | `payload.info.total_token_usage.input_tokens` | ~5% |
| L5 | `payload.result.Ok.content[0].text` | <1% |

---

## 顶层结构

每行 JSONL 通过 serde `#[serde(tag = "type", content = "payload")]` 序列化：

```json
{
  "timestamp": "2026-04-18T06:08:07.376Z",
  "type": "<enum_variant>",
  "payload": { ... }
}
```

Rust 源码 (`protocol.rs:2942-2952`)：

```rust
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum RolloutItem {
    SessionMeta(SessionMetaLine),
    ResponseItem(ResponseItem),
    InterAgentCommunication(InterAgentCommunication),
    Compacted(CompactedItem),
    TurnContext(TurnContextItem),
    EventMsg(EventMsg),
}
```

---

## type

顶层字段，取值为 6 种枚举变体名（snake_case 序列化）。

### response_item

LLM 响应数据，最高频的类型。

- **payload 特征**: 有 `payload.type`（16 种），是 tagged enum

### event_msg

系统事件，最高频的类型。

- **payload 特征**: 有 `payload.type`（76 种），是 tagged enum

### session_meta

会话启动元信息。每文件 1 条。

- **payload 特征**: 无 `payload.type`，字段直接平铺在 payload 中
- **UI 展示**: 不直接展示，其 `base_instructions.text` 被合成为 `system_prompt` 事件

### turn_context

回合上下文快照。每个对话回合 1 条。

- **payload 特征**: 无 `payload.type`，字段直接平铺在 payload 中
- **UI 展示**: 不产生事件节点，数据存入 `turn_manifest` 缓冲区但未被消费

### inter_agent_communication

代理间通信的持久化投递元数据。低频。

- **payload 特征**: 无 `payload.type`，扁平结构
- **UI 展示**: 当前未被覆盖

### compacted

上下文压缩摘要。遗留类型，极低频，但仍可能出现。

- **payload 特征**: 无 `payload.type`，扁平结构

---

## payload

顶层字段，与 `type` 同级。内容结构由 `type` 的值决定。

### response_item 的 payload

有 `payload.type`，共 16 种变体。

#### message

对话消息。`role` 是标题 3 关键字段：

| `role` 值 | 说明 |
|-----------|------|
| `"user"` | 用户输入 |
| `"assistant"` | AI 回复 |
| `"developer"` | 开发者指令 |

详细信息：`content[]`（消息正文）、`phase`（final_answer / commentary）。

#### function_call

工具调用。`name` 是标题 3 关键字段，值为工具名（如 `Bash`、`Read`、`Write`）。详细信息：`arguments`（参数 JSON 字符串）、`call_id`。

#### function_call_output

工具返回。`call_id` 是标题 3 关键字段。详细信息：`output`。

#### reasoning

推理内容。无标题 3 字段，直接展示 `summary`（Vec）、`content`（可选）、`encrypted_content`（可选）。

#### agent_message

代理间消息。`author` / `recipient` 是标题 3 关键字段。详细信息：`content`。

#### local_shell_call

本地 shell 执行。`action` 是标题 3 关键字段。详细信息：`status`、`call_id`。

#### web_search_call

网页搜索调用。`id` 是标题 3 关键字段。详细信息：`status`、`action`、`metadata`。

#### image_generation_call

图片生成调用。`id` 是标题 3 关键字段。详细信息：`status`、`revised_prompt`、`result`、`metadata`。

#### custom_tool_call / custom_tool_call_output

自定义工具。`custom_tool_call` 的关键字段是 `name`，`custom_tool_call_output` 的关键字段是 `call_id`。

#### 其余 6 种

`tool_search_call`、`tool_search_output`、`compaction`、`compaction_trigger`、`context_compaction`、`other` — 不产生独立可点击节点，此处从略。

### event_msg 的 payload

有 `payload.type`，共 76 种变体。所有 event_msg 共享可选的 `turn_id` 和 `call_id` 字段。以下仅列出 UI 相关的 ~27 种。

#### token_count

Token 统计。无标题 3 字段，数值是详细信息（L4 嵌套）。

字段路径：
- `info.total_token_usage.input_tokens` / `cached_input_tokens` / `output_tokens` / `reasoning_output_tokens` / `total_tokens`
- `info.last_token_usage.*`（同上结构）
- `info.model_context_window`
- `rate_limits`

#### exec_command_end

命令执行结果。`command` 是标题 3 关键字段。详细信息：`stdout`、`stderr`、`exit_code`、`duration`。

#### exec_command_begin

命令开始执行。`command` 是标题 3 关键字段。详细信息：`cwd`、`call_id`。

#### mcp_tool_call_end

MCP 外部工具调用结果。`invocation.server` + `invocation.tool` 是标题 3 关键字段。详细信息：`invocation.arguments`（L4）、`result.Ok.content[].text`（L5，最深嵌套）、`duration`。

#### guardian_assessment

安全审查。`risk_level` 是标题 3 关键字段。详细信息：`status`、`action`（tagged enum，6 种变体）、`rationale`、`decision_source`、`user_authorization`。

#### guardian_warning

安全警告。`risk_level` 是标题 3 关键字段。详细信息：`message`。

#### error / stream_error

错误事件。`error_type` 是标题 3 关键字段。详细信息：`message`、`additional_details`（仅 error）。

#### agent_message

Agent 消息。`phase` 是标题 3 关键字段（`final_answer` / `commentary`）。详细信息：`message`、`memory_citation`。

#### user_message

用户消息。无标题 3 字段（role 隐含为 user）。详细信息：`message`、`images`、`text_elements`。

#### agent_reasoning

Agent 推理。无标题 3 字段。详细信息：`content`、`summary`、`encrypted_content`。

#### web_search_end

网页搜索结果。`query` 是标题 3 关键字段。详细信息：`results`、`sources`、`duration`。

#### web_search_begin

网页搜索开始。`query` 是标题 3 关键字段。

#### task_started / task_complete / turn_aborted

回合生命周期。关键字段：`task_complete` 有 `duration_ms`，`turn_aborted` 有 `reason`。其余是详细信息。

#### hook_started / hook_completed

Hook 事件。`hook_name`、`hook_type` 是标题 3 关键字段。

#### collab_agent_spawn_end

子代理创建。`receiver_agent_nickname` 是标题 3 关键字段。详细信息：`receiver_agent_role`、`model`。

#### collab_agent_interaction_end / collab_waiting_end / collab_close_end

协作生命周期。无显著标题 3 字段，字段为详细信息。

#### context_compacted

上下文压缩。详细信息：`summary`、`original_token_count`、`compacted_token_count`。

#### patch_apply_begin / patch_apply_end

补丁应用。详细信息：`changes`、`call_id`、`status`（仅 end）。

#### thread_rolled_back / turn_diff / plan_update / thread_goal_updated

线程/回合状态变更。关键字段：`thread_rolled_back` 有 `reason`，`thread_goal_updated` 有 `goal`。其余是详细信息。

#### view_image_tool_call

查看图片。`path` 是标题 3 关键字段。

#### 其余 ~50 种

以下类型不产生独立可点击节点，UI 展示不需要覆盖：

- **流式 delta**: `agent_message_content_delta`、`reasoning_content_delta`、`reasoning_raw_content_delta`、`plan_delta`
- **Begin 配对**: `collab_agent_spawn_begin`、`collab_agent_interaction_begin`、`collab_waiting_begin`、`collab_close_begin`、`collab_resume_begin`/`end`、`mcp_tool_call_begin`、`image_generation_begin`/`end`、`patch_apply_begin`
- **审批交互**: `exec_approval_request`、`request_permissions`、`request_user_input`、`apply_patch_approval_request`
- **MCP 启动**: `mcp_startup_update`、`mcp_startup_complete`
- **实时会话**: `realtime_conversation_started`、`realtime_conversation_realtime`、`realtime_conversation_closed`、`realtime_conversation_sdp`、`realtime_conversation_list_voices_response`
- **模型路由**: `model_reroute`、`model_verification`、`turn_moderation_metadata`
- **动态工具**: `dynamic_tool_call_request`、`dynamic_tool_call_response`
- **其他**: `elicitation_request`、`session_configured`、`shutdown_complete`、`deprecation_notice`、`thread_settings_applied`、`entered_review_mode`、`exited_review_mode`、`agent_reasoning_raw_content`、`agent_reasoning_section_break`、`exec_command_output_delta`、`terminal_interaction`、`item_started`、`item_completed`、`raw_response_item`、`sub_agent_activity`、`warning` 等

### session_meta 的 payload

无 `payload.type`，扁平结构（17 个字段）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 会话 UUID |
| `timestamp` | string | 启动时间 |
| `cwd` | string | 工作目录 |
| `cli_version` | string | CLI 版本号 |
| `originator` | string | 发起端（如 "codex-tui"） |
| `source` | string | 来源标识 |
| `model_provider` | string (可选) | 模型提供商 |
| `base_instructions` | object (可选) | 基础指令（含 `.text` 子字段 → L3） |
| `agent_nickname` | string (可选) | 子代理昵称 |
| `agent_role` | string (可选) | 子代理角色 |
| `forked_from_id` | string (可选) | fork 来源 |
| `dynamic_tools` | unknown (可选) | 动态工具配置 |
| `memory_mode` | string (可选) | 记忆模式 |
| `git` | unknown (可选) | Git 状态（来自 SessionMetaLine 的 flatten） |
| `parent_thread_id` | string (可选) | 父会话 ID |
| `thread_source` | unknown (可选) | 线程来源 |
| `agent_path` | string (可选) | 代理路径 |
| `multi_agent_version` | unknown (可选) | 多代理版本 |

### turn_context 的 payload

无 `payload.type`，扁平结构（17 个字段）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | string (可选) | 回合 UUID |
| `cwd` | string | 工作目录 |
| `current_date` | string (可选) | 当前日期 |
| `timezone` | string (可选) | 时区 |
| `approval_policy` | string | 批准策略 |
| `sandbox_policy` | object | 沙盒策略（含 `.type`, `.writable_roots` → L3） |
| `model` | string | 模型名 |
| `personality` | string (可选) | 人格配置 |
| `collaboration_mode` | object (可选) | 协作模式（含 `.mode`, `.settings.reasoning_effort` → L3-L4） |
| `effort` | unknown (可选) | 努力程度 |
| `workspace_roots` | unknown (可选) | 工作区根目录 |
| `permission_profile` | unknown (可选) | 权限配置 |
| `network` | unknown (可选) | 网络配置 |
| `file_system_sandbox_policy` | unknown (可选) | 文件系统沙盒策略 |
| `comp_hash` | string (可选) | 编译哈希 |
| `multi_agent_version` | unknown (可选) | 多代理版本 |
| `realtime_active` | bool (可选) | 实时会话活跃 |
| `summary` | object | 推理摘要配置（始终存在） |

### inter_agent_communication 的 payload

无 `payload.type`，扁平结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `author` | object | 发送方 AgentPath |
| `recipient` | object | 接收方 AgentPath |
| `other_recipients` | array | 其他接收方 |
| `content` | string | 消息内容 |
| `encrypted_content` | string (可选) | 加密内容 |
| `metadata` | object (可选) | ResponseItemMetadata |
| `trigger_turn` | bool | 是否触发新回合 |

### compacted 的 payload

无 `payload.type`，扁平结构。遗留类型，极低频。

| 字段 | 类型 | 说明 |
|------|------|------|
| `message` | string | 压缩摘要消息 |
| `replacement_history` | unknown | 替换历史 |
| `window_id` | string | 窗口 ID |

---
