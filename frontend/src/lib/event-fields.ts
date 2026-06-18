/**
 * Shared field extraction for event types.
 *
 * Used by GraphTooltip, Timeline cards (EventNode), and Chat step summaries
 * to display key fields from event metadata without opening the detail panel.
 *
 * All recommended event types from schema-recommendation.md are covered.
 */

export interface EventField {
  key: string;
  label: string;
  value: string;
}

// ── Utilities ──────────────────────────────────────────

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = ((ms % 60_000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function computeDurationMs(
  durationMs: unknown,
  duration: unknown,
): number | undefined {
  if (typeof durationMs === "number") return durationMs;
  if (duration && typeof duration === "object") {
    const d = duration as { secs?: number; nanos?: number };
    const s = typeof d.secs === "number" ? d.secs : 0;
    const n = typeof d.nanos === "number" ? d.nanos : 0;
    return Math.round(s * 1000 + n / 1_000_000);
  }
  return undefined;
}

function computeCommandString(meta: Record<string, unknown>): string | undefined {
  const commandText = stringOrNull(meta.command_text);
  if (commandText) return commandText;
  const command = meta.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) return command.map(String).join(" ");
  return undefined;
}

// ── Main extraction ────────────────────────────────────

/**
 * Extract key fields from event metadata for display.
 *
 * `meta` is a flat Record<string, unknown> that has already been merged
 * through any nesting layers. It contains both raw JSONL fields (snake_case)
 * and extracted fields from the frontend parser.
 */
export function extractFields(
  meta: Record<string, unknown>,
  kind: string,
): EventField[] {
  // Determine event type: try event_type first, then payload_type, then kind as fallback
  const eventType = (stringOrNull(meta.event_type)
    ?? stringOrNull(meta.payload_type)
    ?? kind) as string;

  const fields: EventField[] = [];

  switch (eventType) {
    // ── P0: Core ──────────────────────────────────────
    case "exec_command_end": {
      const cmd = computeCommandString(meta);
      const exitCode = meta.exit_code as number | undefined;
      const computedMs = computeDurationMs(meta.duration_ms, meta.duration);

      if (cmd) fields.push({ key: "cmd", label: "Command", value: cmd });
      if (exitCode !== undefined) fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      if (computedMs !== undefined) fields.push({ key: "dur", label: "Duration", value: `${Math.round(computedMs)}ms` });
      break;
    }

    case "patch_apply_end": {
      const changes = meta.changes as unknown[] | undefined;
      const status = stringOrNull(meta.status);

      if (changes) fields.push({ key: "changes", label: "Changes", value: `${changes.length} files` });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "web_search_end": {
      const query = stringOrNull(meta.query);
      const results = meta.results as unknown[] | undefined;
      const computedMs = computeDurationMs(meta.duration_ms, meta.duration);

      if (query) fields.push({ key: "query", label: "Query", value: query });
      if (results) fields.push({ key: "results", label: "Results", value: `${results.length} results` });
      if (computedMs !== undefined) fields.push({ key: "dur", label: "Duration", value: `${Math.round(computedMs)}ms` });
      break;
    }

    case "error":
    case "stream_error": {
      const msg = stringOrNull(meta.message);
      const errType = stringOrNull(meta.error_type);

      if (msg) fields.push({ key: "msg", label: "Message", value: msg });
      if (errType) fields.push({ key: "type", label: "Type", value: errType });
      break;
    }

    case "guardian_assessment": {
      const risk = stringOrNull(meta.risk_level);
      const action = stringOrNull(meta.action);

      if (risk) fields.push({ key: "risk", label: "Risk Level", value: risk });
      if (action) fields.push({ key: "action", label: "Action", value: action });
      break;
    }

    // ── P1: Important ─────────────────────────────────
    case "task_started": {
      const phase = stringOrNull(meta.phase);
      const startedAt = stringOrNull(meta.started_at);

      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      if (startedAt) fields.push({ key: "started", label: "Started", value: startedAt });
      break;
    }

    case "task_complete": {
      const durMs = meta.duration_ms as number | undefined;
      const ttft = meta.time_to_first_token_ms as number | undefined;
      const phase = stringOrNull(meta.phase);

      if (durMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durMs) });
      if (ttft !== undefined) fields.push({ key: "ttft", label: "TTFT", value: formatDuration(ttft) });
      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      break;
    }

    case "user_message": {
      const message = stringOrNull(meta.message);
      const phase = stringOrNull(meta.phase);

      if (message) fields.push({ key: "msg", label: "Message", value: truncate(message, 120) });
      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      break;
    }

    case "agent_message": {
      const message = stringOrNull(meta.message);
      const phase = stringOrNull(meta.phase);

      if (message) fields.push({ key: "msg", label: "Message", value: truncate(message, 120) });
      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      break;
    }

    case "token_count": {
      const total = meta.total_tokens as number | undefined;
      const input = meta.total_input_tokens as number | undefined;
      const output = meta.total_output_tokens as number | undefined;
      const cached = meta.total_cached_input_tokens as number | undefined;

      if (total !== undefined) fields.push({ key: "total", label: "Total Tokens", value: formatNumber(total) });
      if (input !== undefined) fields.push({ key: "input", label: "Input", value: formatNumber(input) });
      if (output !== undefined) fields.push({ key: "output", label: "Output", value: formatNumber(output) });
      if (cached !== undefined) fields.push({ key: "cached", label: "Cached", value: formatNumber(cached) });
      break;
    }

    case "turn_aborted": {
      const reason = stringOrNull(meta.detail_note);
      if (reason) fields.push({ key: "reason", label: "Reason", value: reason });
      break;
    }

    case "thread_rolled_back": {
      const reason = stringOrNull(meta.reason);
      if (reason) fields.push({ key: "reason", label: "Reason", value: reason });
      break;
    }

    case "context_compacted": {
      const summary = stringOrNull(meta.summary);
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "exec_command_begin": {
      const cmd = computeCommandString(meta);
      const cwd = stringOrNull(meta.cwd);

      if (cmd) fields.push({ key: "cmd", label: "Command", value: cmd });
      if (cwd) fields.push({ key: "cwd", label: "CWD", value: cwd });
      break;
    }

    case "turn_diff": {
      const summary = stringOrNull(meta.summary);
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "collab_agent_spawn_end": {
      const nickname = stringOrNull(meta.agent_nickname);
      const role = stringOrNull(meta.agent_role);
      const model = stringOrNull(meta.model);

      if (nickname) fields.push({ key: "nick", label: "Agent", value: nickname });
      if (role) fields.push({ key: "role", label: "Role", value: role });
      if (model) fields.push({ key: "model", label: "Model", value: model });
      break;
    }

    case "collab_agent_interaction_end": {
      const sender = stringOrNull(meta.sender_thread_id);
      const receiver = stringOrNull(meta.receiver_thread_id);
      const status = stringOrNull(meta.status);

      if (sender) fields.push({ key: "sender", label: "Sender", value: sender });
      if (receiver) fields.push({ key: "receiver", label: "Receiver", value: receiver });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "collab_waiting_end": {
      const statuses = meta.agent_statuses as Record<string, string> | undefined;
      if (statuses && typeof statuses === "object") {
        const entries = Object.entries(statuses);
        if (entries.length > 0) {
          fields.push({ key: "agents", label: "Agent Statuses", value: entries.map(([k, v]) => `${k}: ${v}`).join(", ") });
        }
      }
      break;
    }

    case "collab_close_end": {
      const status = stringOrNull(meta.status);
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    // ── P2: Nice to have ──────────────────────────────
    case "view_image_tool_call": {
      const imagePath = stringOrNull(meta.image_path);
      if (imagePath) fields.push({ key: "path", label: "Image", value: imagePath });
      break;
    }

    case "web_search_begin": {
      const query = stringOrNull(meta.query);
      if (query) fields.push({ key: "query", label: "Query", value: query });
      break;
    }

    case "mcp_tool_call_end": {
      const server = stringOrNull(meta.server);
      const toolName = stringOrNull(meta.tool_name);
      const durMs = meta.duration_ms as number | undefined;
      const status = stringOrNull(meta.status);

      if (server) fields.push({ key: "server", label: "Server", value: server });
      if (toolName) fields.push({ key: "tool", label: "Tool", value: toolName });
      if (durMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durMs) });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "plan_update": {
      const summary = stringOrNull(meta.summary);
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "thread_goal_updated": {
      const summary = stringOrNull(meta.summary);
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "hook_started":
    case "hook_completed": {
      const hookName = stringOrNull(meta.hook_name);
      const hookType = stringOrNull(meta.hook_type);
      const durMs = meta.duration_ms as number | undefined;

      if (hookName) fields.push({ key: "name", label: "Hook", value: hookName });
      if (hookType) fields.push({ key: "type", label: "Type", value: hookType });
      if (durMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durMs) });
      break;
    }

    // ── New: R1.2 subagent_session ────────────────────
    case "subagent_session": {
      const childId = stringOrNull(meta.child_session_id);
      const displayName = stringOrNull(meta.title);
      const promptPreview = stringOrNull(meta.prompt_preview);
      const status = stringOrNull(meta.status_preview);

      if (childId) fields.push({ key: "child", label: "Child Session", value: childId });
      if (displayName) fields.push({ key: "name", label: "Agent", value: displayName });
      if (promptPreview) fields.push({ key: "prompt", label: "Prompt", value: truncate(promptPreview, 80) });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    // ── New: R1.3 input_image ─────────────────────────
    case "input_image": {
      const imagePath = stringOrNull(meta.content) ?? stringOrNull(meta.summary);
      const detailNote = stringOrNull(meta.detail_note);

      if (imagePath) fields.push({ key: "path", label: "Image", value: imagePath });
      if (detailNote) fields.push({ key: "type", label: "Type", value: detailNote });
      break;
    }

    // ── Fallback: always show at least basic info ─────
    default: {
      const title = stringOrNull(meta.title);
      const summary = stringOrNull(meta.summary);
      const content = stringOrNull(meta.content);
      const toolName = stringOrNull(meta.tool_name);
      const name = stringOrNull(meta.name);
      const recordType = stringOrNull(meta.record_type);
      const payloadType = stringOrNull(meta.payload_type) ?? stringOrNull(meta.event_type);

      if (recordType) fields.push({ key: "record_type", label: "Type", value: recordType });
      if (payloadType) fields.push({ key: "payload_type", label: "Payload Type", value: payloadType });
      if (title) fields.push({ key: "title", label: "Title", value: truncate(title, 80) });
      if (toolName || name) fields.push({ key: "tool", label: "Tool", value: (toolName || name)! });
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      if (content && !summary) fields.push({ key: "content", label: "Content", value: truncate(content, 120) });
      break;
    }
  }

  return fields;
}

/**
 * Merge nested metadata layers (the same logic as GraphTooltip's preamble).
 *
 * Handles the case where node.metadata = TurnEvent, and TurnEvent.metadata
 * is a nested object (or JSON string) containing the actual event data.
 */
export function mergeMetaLayers(rawMeta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!rawMeta) return {};

  let parsed: Record<string, unknown> = { ...rawMeta };

  // First level: merge TurnEvent with its .metadata (RawEvent)
  const inner1 = rawMeta.metadata;
  if (inner1 && typeof inner1 === "object" && !Array.isArray(inner1)) {
    parsed = { ...parsed, ...(inner1 as Record<string, unknown>) };
  }
  const inner2 = parsed.metadata;
  if (typeof inner2 === "string") {
    try {
      parsed = { ...parsed, ...JSON.parse(inner2) };
    } catch { /* keep original */ }
  } else if (inner2 && typeof inner2 === "object" && !Array.isArray(inner2)) {
    parsed = { ...parsed, ...(inner2 as Record<string, unknown>) };
  }

  return parsed;
}
