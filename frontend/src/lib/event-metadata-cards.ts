import type { EventRow } from "../ipc/types";
import { formatTime } from "./format";
import { argsField, parseArgsObject } from "./event-fields";

export interface EventMetadataCard {
  label: string;
  value: string;
}

type EventLike = Pick<EventRow, "kind" | "timestamp" | "role" | "metadata">;

interface KeyFieldCard {
  label: string;
  value: string;
}

interface EventMeta {
  record_type: string | null;
  payload_type: string | null;
  role: string | null;
  phase: string | null;
  name: string | null;
  call_id: string | null;
  command: string | null;
  status: string | null;
  tool: string | null;
  path: string | null;
  risk_level: string | null;
  error_type: string | null;
  duration_ms: number | null;
  collaboration_mode_kind: string | null;
  reason: string | null;
  receiver_agent_nickname: string | null;
  query: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMetadata(
  metadata: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata !== "string") return metadata;
  try {
    const parsed = JSON.parse(metadata);
    return objectOrNull(parsed) ?? {};
  } catch {
    return {};
  }
}

function commandValue(meta: Record<string, unknown>): string | null {
  const command = meta.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) return command.map(String).join(" ");
  return stringOrNull(meta.command_text);
}

function toolValue(meta: Record<string, unknown>): string | null {
  const server = stringOrNull(meta.server)
    ?? stringOrNull(objectOrNull(meta.invocation)?.server);
  const tool = stringOrNull(meta.tool_name)
    ?? stringOrNull(objectOrNull(meta.invocation)?.tool);
  if (server && tool) return `${server} / ${tool}`;
  return tool ?? server;
}

function formatDurationMs(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function readMeta(event: EventLike): EventMeta {
  const parsed = parseMetadata(event.metadata);
  return {
    record_type: stringOrNull(parsed.record_type),
    payload_type: stringOrNull(parsed.payload_type),
    role: stringOrNull(parsed.role) ?? event.role ?? null,
    phase: stringOrNull(parsed.phase),
    name: stringOrNull(parsed.name) ?? stringOrNull(parsed.tool_name),
    call_id: stringOrNull(parsed.call_id),
    command: commandValue(parsed),
    status: stringOrNull(parsed.status),
    tool: toolValue(parsed),
    path: stringOrNull(parsed.path),
    risk_level: stringOrNull(parsed.risk_level),
    error_type: stringOrNull(parsed.error_type),
    duration_ms: numberOrNull(parsed.duration_ms),
    collaboration_mode_kind: stringOrNull(parsed.collaboration_mode_kind),
    reason: stringOrNull(parsed.reason),
    receiver_agent_nickname: stringOrNull(parsed.receiver_agent_nickname),
    query: stringOrNull(parsed.query),
  };
}

function syntheticRecordType(event: EventLike): string | null {
  switch (event.kind) {
    case "system_prompt":
      return "session_meta";
    case "subagent_session":
      return "event_msg";
    case "input_image":
    case "input_context":
    case "input_prompt":
    case "input_hook":
    case "input_attachment":
      return "response_item";
    default:
      return null;
  }
}

function syntheticPayloadType(event: EventLike): string | null {
  switch (event.kind) {
    case "system_prompt":
      return null;
    case "input_image":
    case "input_context":
    case "input_prompt":
    case "input_hook":
    case "input_attachment":
      return "message";
    default:
      return null;
  }
}

function syntheticDisablesKeyField(kind: string): boolean {
  return [
    "system_prompt",
    "subagent_session",
    "input_image",
    "input_context",
    "input_prompt",
    "input_hook",
    "input_attachment",
  ].includes(kind);
}

function buildKeyFieldCard(event: EventLike, meta: EventMeta): KeyFieldCard | null {
  if (syntheticDisablesKeyField(event.kind)) return null;

  const recordType = meta.record_type ?? syntheticRecordType(event);
  const payloadType = meta.payload_type ?? syntheticPayloadType(event);

  if (!recordType) return null;

  if (recordType === "response_item") {
    switch (payloadType) {
      case "message":
        return meta.role ? { label: "Role", value: meta.role } : null;
      case "function_call":
      case "custom_tool_call":
        return meta.name ? { label: "Name", value: meta.name } : null;
      case "function_call_output":
      case "custom_tool_call_output":
        return meta.call_id ? { label: "Call ID", value: meta.call_id } : null;
      default:
        return null;
    }
  }

  if (recordType === "event_msg") {
    switch (payloadType) {
      case "agent_message":
        return meta.phase ? { label: "Phase", value: meta.phase } : null;
      case "exec_command_begin":
      case "exec_command_end":
        return meta.command ? { label: "Command", value: meta.command } : null;
      case "patch_apply_end":
        return meta.status ? { label: "Status", value: meta.status } : null;
      case "mcp_tool_call_end":
        return meta.tool ? { label: "Tool", value: meta.tool } : null;
      case "view_image_tool_call":
        return meta.path ? { label: "Path", value: meta.path } : null;
      case "guardian_assessment":
        return meta.risk_level ? { label: "Risk Level", value: meta.risk_level } : null;
      case "error":
      case "stream_error":
        return meta.error_type ? { label: "Error Type", value: meta.error_type } : null;
      case "task_complete": {
        const duration = formatDurationMs(meta.duration_ms);
        return duration ? { label: "Duration", value: duration } : null;
      }
      case "task_started":
        return meta.collaboration_mode_kind
          ? { label: "Mode", value: meta.collaboration_mode_kind }
          : null;
      case "turn_aborted":
        return meta.reason ? { label: "Reason", value: meta.reason } : null;
      case "collab_agent_spawn_end":
        return meta.receiver_agent_nickname
          ? { label: "Agent", value: meta.receiver_agent_nickname }
          : null;
      case "web_search_begin":
      case "web_search_end":
        return meta.query ? { label: "Query", value: meta.query } : null;
      default:
        return null;
    }
  }

  return null;
}

// ── claude_code native-identity cards ───────────────────

function readUsageTotalTokens(usage: unknown): string | null {
  const u = objectOrNull(usage);
  if (!u) return null;
  const total = numberOrNull(u.total_tokens);
  return total !== null ? total.toLocaleString() : null;
}

function formatPrePostTokens(pre: unknown, post: unknown): string | null {
  const preN = numberOrNull(pre);
  const postN = numberOrNull(post);
  if (preN === null && postN === null) return null;
  return `${preN?.toLocaleString() ?? "?"} → ${postN?.toLocaleString() ?? "?"}`;
}

function hasSourceContentBlockType(
  sourceRecord: Record<string, unknown> | null,
  blockType: string | null,
): boolean {
  if (!sourceRecord || !blockType) return false;
  const message = objectOrNull(sourceRecord.message);
  const content = message?.content;
  return Array.isArray(content)
    && content.some((item) => objectOrNull(item)?.type === blockType);
}

function sourceContentBlockString(
  sourceRecord: Record<string, unknown> | null,
  blockType: string | null,
  field: string,
): string | null {
  if (!sourceRecord || !blockType) return null;
  const message = objectOrNull(sourceRecord.message);
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    const block = objectOrNull(item);
    if (block?.type === blockType) {
      const value = stringOrNull(block[field]);
      if (value) return value;
    }
  }
  return null;
}

/** Build source-layer / native-detail / timestamp cards for a claude_code event.
 *  Dispatches on ``claude_event_type`` (the native identity). Tool_call inputs
 *  live inside the stringified ``args`` JSON; ``argsField`` reads from either
 *  args or direct metadata so the same case serves tool_call + tool_result. */
function buildClaudeCodeCards(
  event: EventLike,
  parsed: Record<string, unknown>,
): EventMetadataCard[] {
  const claudeEventType = stringOrNull(parsed.claude_event_type);
  const sourceRecord = objectOrNull(parsed.source_record);
  const recordType = stringOrNull(parsed.raw_record_type)
    ?? stringOrNull(sourceRecord?.type);
  const systemSubtype = stringOrNull(parsed.system_subtype);
  const attachmentType = stringOrNull(parsed.attachment_type);
  const blockType = stringOrNull(parsed.raw_content_type);
  const cards: EventMetadataCard[] = [];

  const args = parseArgsObject(parsed);
  const push = (label: string, value: string | null | undefined) => {
    if (value) cards.push({ label, value });
  };
  const numeric = (v: unknown): string | null =>
    typeof v === "number" ? String(v) : null;
  const toolIdentity = (): string | null => {
    return stringOrNull(parsed.name)
      ?? stringOrNull(parsed.tool_name)
      ?? sourceContentBlockString(sourceRecord, blockType, "name");
  };

  if (recordType) {
    push("type", recordType);
  } else {
    push("claude_event_type", claudeEventType);
  }
  push("subtype", systemSubtype);
  push("attachment.type", attachmentType);
  if (hasSourceContentBlockType(sourceRecord, blockType)) {
    push("message.content[].type", blockType);
  }
  if (blockType === "tool_use") {
    push("message.content[].name", toolIdentity());
  }
  if (blockType === "tool_result") {
    push("message.content[].tool_use_id", stringOrNull(parsed.call_id)
      ?? sourceContentBlockString(sourceRecord, blockType, "tool_use_id"));
  }

  switch (claudeEventType) {
    case "Bash":
      push("command", argsField(parsed, args, "command"));
      push("exitCode", numeric(parsed.exit_code));
      break;
    case "Edit":
      push("file_path", argsField(parsed, args, "file_path"));
      push("status", stringOrNull(parsed.status));
      break;
    case "Write":
      push("file_path", argsField(parsed, args, "file_path"));
      push("status", stringOrNull(parsed.status));
      break;
    case "MultiEdit":
      push("file_path", argsField(parsed, args, "file_path"));
      break;
    case "Read":
      push("file_path", argsField(parsed, args, "file_path"));
      break;
    case "Grep":
      push("pattern", argsField(parsed, args, "pattern"));
      break;
    case "Glob":
      push("pattern", argsField(parsed, args, "pattern"));
      break;
    case "Agent":
    case "Task":
      push("subagent_type", argsField(parsed, args, "subagent_type"));
      push("model", argsField(parsed, args, "model"));
      break;
    case "WebSearch":
      push("query", argsField(parsed, args, "query"));
      break;
    case "WebFetch":
      push("url", argsField(parsed, args, "url"));
      break;
    case "tool_result":
      push("status", stringOrNull(parsed.status));
      push("exitCode", numeric(parsed.exit_code));
      push("file_path", stringOrNull(parsed.file_path));
      break;
    case "text":
      push("model", stringOrNull(parsed.model));
      push("usage.total_tokens", readUsageTotalTokens(parsed.usage));
      break;
    case "thinking":
      push("model", stringOrNull(parsed.model));
      break;
    case "api_error":
      push("error.kind", stringOrNull(parsed.error_type));
      push("retryAttempt", numeric(parsed.retry_attempt));
      break;
    case "compact_boundary":
      push("compactMetadata.preTokens/postTokens", formatPrePostTokens(parsed.original_token_count, parsed.compacted_token_count));
      push("compactMetadata.trigger", stringOrNull(parsed.trigger));
      break;
    case "stop_hook_summary":
      push("stopReason", stringOrNull(parsed.stop_reason));
      push("hookCount", numeric(parsed.hook_count));
      push("durationMs", formatDurationMs(numberOrNull(parsed.duration_ms)));
      break;
    case "hook":
      push("hookName", stringOrNull(parsed.hook_name));
      push("status", stringOrNull(parsed.status));
      push("decision", stringOrNull(parsed.decision));
      push("exitCode", numeric(parsed.exit_code));
      break;
    case "edited_text_file":
      push("file_path", stringOrNull(parsed.filename) ?? stringOrNull(parsed.file_path));
      break;
    case "image":
      push("message.content[].source.media_type", stringOrNull(parsed.media_type) ?? stringOrNull(parsed.detail_note));
      break;
    case "subagent_session":
      push("agent_nickname", stringOrNull(parsed.agent_nickname));
      push("agent_role", stringOrNull(parsed.agent_role));
      break;
    default:
      // mcp__* results may only have normalized metadata for split server/tool.
      if (claudeEventType?.startsWith("mcp__")) {
        push("server", stringOrNull(parsed.server));
        if (blockType !== "tool_use") {
          push("tool_name", stringOrNull(parsed.tool_name) ?? claudeEventType);
        }
      }
      // TodoWrite / command_permissions / skill_listing / task_reminder /
      // queue_operation / local_command / user_message / unknown tool names:
      // source-layer cards + timestamp are enough; tool_call args are shown in the content area.
      break;
  }

  cards.push({
    label: "timestamp",
    value: event.timestamp ? formatTime(event.timestamp) : "-",
  });
  return cards;
}

export function buildEventMetadataCards({
  event,
}: {
  event: EventLike;
}): EventMetadataCard[] {
  // claude_code events carry ``claude_event_type`` (native identity); codex
  // events do not. Route claude_code to its own card builder so codex renders
  // byte-for-byte unchanged.
  const parsed = parseMetadata(event.metadata);
  if (stringOrNull(parsed.claude_event_type)) {
    return buildClaudeCodeCards(event, parsed);
  }

  const meta = readMeta(event);
  const recordType = meta.record_type ?? syntheticRecordType(event);
  const payloadType = meta.payload_type ?? syntheticPayloadType(event);
  const cards: EventMetadataCard[] = [];

  if (recordType) cards.push({ label: "Type", value: recordType });
  if (payloadType) cards.push({ label: "Payload Type", value: payloadType });

  const keyFieldCard = buildKeyFieldCard(event, meta);
  if (keyFieldCard) cards.push(keyFieldCard);

  cards.push({
    label: "Time",
    value: event.timestamp ? formatTime(event.timestamp) : "-",
  });

  return cards;
}
