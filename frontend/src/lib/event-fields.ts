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

function parseMcpToolName(toolName: string): { server: string | null; tool: string | null } {
  const parts = toolName.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") {
    return { server: null, tool: null };
  }
  return {
    server: parts[1] || null,
    tool: parts.slice(2).join("__") || null,
  };
}

/**
 * Parse a claude_code tool_call's stringified ``args`` (JSON) into an object.
 * Tool_call events carry the input fields (file_path/command/pattern/...) only
 * inside ``args``; tool_result events carry them directly on metadata. Returning
 * null lets callers fall back to direct metadata fields.
 */
export function parseArgsObject(meta: Record<string, unknown>): Record<string, unknown> | null {
  const raw = meta.args;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function argsField(
  meta: Record<string, unknown>,
  args: Record<string, unknown> | null,
  key: string,
): string | null {
  return stringOrNull(meta[key]) ?? stringOrNull(args?.[key]);
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
  // Determine event type. claude_code events carry ``claude_event_type`` (native
  // identity); codex events do not, so they fall through to event_type /
  // payload_type / kind unchanged.
  const eventType = (stringOrNull(meta.claude_event_type)
    ?? stringOrNull(meta.event_type)
    ?? stringOrNull(meta.payload_type)
    ?? kind) as string;

  const fields: EventField[] = [];

  // claude_code MCP tool_call: identity is the raw ``mcp__<server>__<tool>`` name.
  // Switch can't pattern-match a prefix, so handle it before the switch.
  if (eventType.startsWith("mcp__")) {
    const parsedMcp = parseMcpToolName(eventType);
    const explicitToolName = stringOrNull(meta.tool_name);
    const server = stringOrNull(meta.server) ?? parsedMcp.server;
    const toolName = (
      explicitToolName && explicitToolName !== eventType
        ? explicitToolName
        : parsedMcp.tool
    ) ?? stringOrNull(meta.name);
    if (server) fields.push({ key: "server", label: "Server", value: server });
    if (toolName && toolName !== eventType) fields.push({ key: "tool", label: "Tool", value: toolName });
    return fields;
  }

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
      const agentName = stringOrNull(meta.agent_nickname);
      const agentRole = stringOrNull(meta.agent_role);
      if (agentName) fields.push({ key: "agent", label: "Agent", value: agentName });
      if (agentRole) fields.push({ key: "role", label: "Role", value: agentRole });
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

    // ── claude_code native-identity cases ──────────────
    // claude_code events dispatch on ``claude_event_type`` (resolved into
    // ``eventType`` above). Tool_call inputs live inside the stringified
    // ``args`` JSON; ``argsField`` reads a key from either args or meta so the
    // same case serves tool_call (input in args) and tool_result (direct).
    case "Bash": {
      const args = parseArgsObject(meta);
      const cmd = argsField(meta, args, "command");
      const description = argsField(meta, args, "description");
      const exitCode = meta.exit_code;
      const status = stringOrNull(meta.status);
      if (cmd) fields.push({ key: "cmd", label: "Command", value: cmd });
      if (description) fields.push({ key: "desc", label: "Description", value: truncate(description, 120) });
      if (typeof exitCode === "number") fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "Edit": {
      const args = parseArgsObject(meta);
      const filePath = argsField(meta, args, "file_path");
      const status = stringOrNull(meta.status);
      if (filePath) fields.push({ key: "path", label: "Path", value: filePath });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "Write": {
      const args = parseArgsObject(meta);
      const filePath = argsField(meta, args, "file_path");
      const content = stringOrNull(args?.content);
      const status = stringOrNull(meta.status);
      if (filePath) fields.push({ key: "path", label: "Path", value: filePath });
      if (content) fields.push({ key: "content", label: "Content", value: truncate(content, 80) });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "MultiEdit": {
      const args = parseArgsObject(meta);
      const filePath = argsField(meta, args, "file_path");
      const editCount = Array.isArray(meta.changes)
        ? meta.changes.length
        : Array.isArray(args?.edits) ? args.edits.length : undefined;
      if (filePath) fields.push({ key: "path", label: "Path", value: filePath });
      if (editCount !== undefined) fields.push({ key: "changes", label: "Changes", value: `${editCount} edits` });
      break;
    }

    case "Read": {
      const args = parseArgsObject(meta);
      const filePath = argsField(meta, args, "file_path");
      if (filePath) fields.push({ key: "path", label: "Path", value: filePath });
      break;
    }

    case "Grep": {
      const args = parseArgsObject(meta);
      const pattern = argsField(meta, args, "pattern");
      const path = argsField(meta, args, "path");
      if (pattern) fields.push({ key: "pattern", label: "Pattern", value: pattern });
      if (path) fields.push({ key: "path", label: "Path", value: path });
      break;
    }

    case "Glob": {
      const args = parseArgsObject(meta);
      const pattern = argsField(meta, args, "pattern");
      const path = argsField(meta, args, "path");
      if (pattern) fields.push({ key: "pattern", label: "Pattern", value: pattern });
      if (path) fields.push({ key: "path", label: "Path", value: path });
      break;
    }

    case "Agent":
    case "Task": {
      const args = parseArgsObject(meta);
      const subagentType = argsField(meta, args, "subagent_type");
      const description = argsField(meta, args, "description");
      const prompt = argsField(meta, args, "prompt");
      if (subagentType) fields.push({ key: "subagent", label: "Subagent", value: subagentType });
      if (description) fields.push({ key: "desc", label: "Description", value: truncate(description, 120) });
      if (prompt) fields.push({ key: "prompt", label: "Prompt", value: truncate(prompt, 120) });
      break;
    }

    case "WebSearch": {
      const args = parseArgsObject(meta);
      const query = argsField(meta, args, "query");
      if (query) fields.push({ key: "query", label: "Query", value: query });
      break;
    }

    case "WebFetch": {
      const args = parseArgsObject(meta);
      const url = argsField(meta, args, "url");
      if (url) fields.push({ key: "url", label: "URL", value: url });
      break;
    }

    case "TodoWrite": {
      const args = parseArgsObject(meta);
      if (Array.isArray(args?.todos)) fields.push({ key: "todos", label: "Todos", value: String(args.todos.length) });
      break;
    }

    case "tool_result": {
      const status = stringOrNull(meta.status);
      const rawToolName = stringOrNull(meta.tool_name) ?? stringOrNull(meta.name);
      const parsedMcp = rawToolName?.startsWith("mcp__")
        ? parseMcpToolName(rawToolName)
        : { server: null, tool: null };
      const toolName = parsedMcp.tool ?? rawToolName;
      const server = stringOrNull(meta.server) ?? parsedMcp.server;
      const filePath = stringOrNull(meta.file_path);
      const query = stringOrNull(meta.query);
      const exitCode = meta.exit_code;
      const stdout = stringOrNull(meta.stdout);
      const stderr = stringOrNull(meta.stderr);
      const content = stringOrNull(meta.content);
      if (toolName) fields.push({ key: "tool", label: "Tool", value: toolName });
      if (server) fields.push({ key: "server", label: "Server", value: server });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      if (!status && meta.is_error === true) fields.push({ key: "err", label: "Error", value: "true" });
      if (typeof exitCode === "number") fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      if (stdout) fields.push({ key: "stdout", label: "Output", value: truncate(stdout, 80) });
      if (stderr) fields.push({ key: "stderr", label: "Error Output", value: truncate(stderr, 80) });
      if (!stdout && !stderr && content) fields.push({ key: "content", label: toolName === "Write" ? "Content" : "Output", value: truncate(content, 80) });
      if (filePath) fields.push({ key: "path", label: "Path", value: filePath });
      if (query) fields.push({ key: "query", label: "Query", value: query });
      break;
    }

    case "text": {
      const contentPreview = stringOrNull(meta.input_content_text)
        ?? (stringOrNull(meta.claude_event_type) ? stringOrNull(meta.content) : null);
      const stopReason = stringOrNull(meta.stop_reason);
      if (contentPreview) fields.push({ key: "content", label: "Content", value: truncate(contentPreview, 80) });
      if (stopReason) fields.push({ key: "stop", label: "Stop Reason", value: stopReason });
      break;
    }

    case "thinking": {
      const contentPreview = stringOrNull(meta.input_content_text)
        ?? (stringOrNull(meta.claude_event_type) ? stringOrNull(meta.content) : null);
      if (contentPreview) fields.push({ key: "content", label: "Thinking", value: truncate(contentPreview, 80) });
      break;
    }

    case "api_error": {
      const msg = stringOrNull(meta.message);
      const errType = stringOrNull(meta.error_type);
      const retryAttempt = meta.retry_attempt;
      const maxRetries = meta.max_retries;
      if (msg) fields.push({ key: "msg", label: "Message", value: msg });
      if (errType) fields.push({ key: "type", label: "Type", value: errType });
      if (typeof retryAttempt === "number") {
        const retry = typeof maxRetries === "number"
          ? `${retryAttempt}/${maxRetries}`
          : String(retryAttempt);
        fields.push({ key: "retry", label: "Retry", value: retry });
      }
      break;
    }

    case "compact_boundary": {
      const summary = stringOrNull(meta.summary);
      const preTokens = meta.original_token_count;
      const postTokens = meta.compacted_token_count;
      const trigger = stringOrNull(meta.trigger);
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      if (typeof preTokens === "number") fields.push({ key: "pre", label: "Pre Tokens", value: formatNumber(preTokens) });
      if (typeof postTokens === "number") fields.push({ key: "post", label: "Post Tokens", value: formatNumber(postTokens) });
      if (trigger) fields.push({ key: "trigger", label: "Trigger", value: trigger });
      break;
    }

    case "compact_summary": {
      const summary = stringOrNull(meta.summary);
      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "stop_hook_summary": {
      const message = stringOrNull(meta.message);
      const stopReason = stringOrNull(meta.stop_reason);
      const hookCount = meta.hook_count;
      const prevented = meta.prevented_continuation;
      const durMs = meta.duration_ms as number | undefined;
      if (message) fields.push({ key: "message", label: "Message", value: truncate(message, 120) });
      if (stopReason && stopReason !== message) fields.push({ key: "stop", label: "Stop Reason", value: stopReason });
      if (typeof hookCount === "number") fields.push({ key: "hooks", label: "Hooks", value: String(hookCount) });
      if (typeof prevented === "boolean") fields.push({ key: "prevented", label: "Prevented Continuation", value: String(prevented) });
      if (durMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durMs) });
      break;
    }

    case "hook": {
      const hookName = stringOrNull(meta.hook_name);
      const command = stringOrNull(meta.command);
      const hookType = stringOrNull(meta.hook_type);
      const status = stringOrNull(meta.status);
      const decision = stringOrNull(meta.decision);
      const message = stringOrNull(meta.message);
      const stdout = stringOrNull(meta.stdout);
      const stderr = stringOrNull(meta.stderr);
      const exitCode = meta.exit_code;
      const durMs = meta.duration_ms as number | undefined;
      if (hookName) fields.push({ key: "name", label: "Name", value: hookName });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      if (decision) fields.push({ key: "decision", label: "Decision", value: decision });
      if (message) fields.push({ key: "message", label: "Message", value: truncate(message, 120) });
      if (stdout) fields.push({ key: "stdout", label: "Output", value: truncate(stdout, 80) });
      if (stderr) fields.push({ key: "stderr", label: "Error Output", value: truncate(stderr, 80) });
      if (command) fields.push({ key: "cmd", label: "Command", value: command });
      if (hookType) fields.push({ key: "type", label: "Type", value: hookType });
      if (typeof exitCode === "number") fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      if (durMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durMs) });
      break;
    }

    case "edited_text_file": {
      const filename = stringOrNull(meta.filename) ?? stringOrNull(meta.file_path);
      if (filename) fields.push({ key: "path", label: "Path", value: filename });
      break;
    }

    case "command_permissions": {
      const allowed = meta.allowed_tools as unknown[] | undefined;
      if (allowed) fields.push({ key: "allowed", label: "Allowed Tools", value: String(allowed.length) });
      break;
    }

    case "skill_listing": {
      const names = meta.names as unknown[] | undefined;
      if (names) fields.push({ key: "skills", label: "Skills", value: String(names.length) });
      break;
    }

    case "task_reminder": {
      const todos = meta.todos as unknown[] | undefined;
      if (todos) fields.push({ key: "todos", label: "Todos", value: String(todos.length) });
      break;
    }

    case "image": {
      const mediaType = stringOrNull(meta.media_type) ?? stringOrNull(meta.detail_note);
      if (mediaType) fields.push({ key: "media", label: "Media Type", value: mediaType });
      break;
    }

    case "queue_operation": {
      const operation = stringOrNull(meta.queue_operation);
      const content = stringOrNull(meta.content);
      if (operation) fields.push({ key: "operation", label: "Operation", value: operation });
      if (content) fields.push({ key: "prompt", label: "Prompt", value: truncate(content, 120) });
      break;
    }

    case "local_command": {
      const command = computeCommandString(meta) ?? stringOrNull(meta.content);
      const exitCode = meta.exit_code;
      const status = stringOrNull(meta.status);
      if (command) fields.push({ key: "cmd", label: "Command", value: command });
      if (typeof exitCode === "number") fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    // ── Fallback: always show at least basic info ─────
    default: {
      const title = stringOrNull(meta.title);
      const summary = stringOrNull(meta.summary);
      const content = stringOrNull(meta.content);
      const toolName = stringOrNull(meta.tool_name);
      const name = stringOrNull(meta.name);

      // record_type/payload_type are Codex CLI concepts. Claude Code events
      // (identified by claude_event_type) must not show these labels.
      const isClaudeCodeEvent = stringOrNull(meta.claude_event_type) !== null;
      if (!isClaudeCodeEvent) {
        const recordType = stringOrNull(meta.record_type);
        const payloadType = stringOrNull(meta.payload_type) ?? stringOrNull(meta.event_type);
        if (recordType) fields.push({ key: "record_type", label: "Type", value: recordType });
        if (payloadType) fields.push({ key: "payload_type", label: "Payload Type", value: payloadType });
      }
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
