import { useMemo } from "react";
import type { GraphNode } from "./graph-layout";

interface GraphTooltipProps {
  node: GraphNode;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface TooltipField {
  key: string;
  label: string;
  value: string;
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

function extractFields(node: GraphNode): TooltipField[] {
  if (!node.metadata) return [];

  const meta = node.metadata;

  // Parse metadata - handle nested structure:
  // node.metadata = TurnEvent
  // TurnEvent.metadata = RawEvent
  // RawEvent.metadata = JSON string (actual event data)
  let parsedMeta: Record<string, unknown> = meta;

  // First level: merge TurnEvent with RawEvent
  if (meta.metadata && typeof meta.metadata === "object") {
    parsedMeta = { ...meta, ...meta.metadata };
  }

  // Second level: parse RawEvent.metadata (JSON string with actual event data)
  const innerMeta = parsedMeta.metadata;
  if (typeof innerMeta === "string") {
    try {
      parsedMeta = { ...parsedMeta, ...JSON.parse(innerMeta) };
    } catch {
      // Keep original if parsing fails
    }
  } else if (innerMeta && typeof innerMeta === "object") {
    parsedMeta = { ...parsedMeta, ...innerMeta };
  }

  // Try multiple sources for event type:
  // 1. event_type (from frontend parser extractors.ts)
  // 2. payload_type (from raw JSONL)
  // 3. node.kind (fallback, though it's usually "tool_output" not "exec_command_end")
  const eventType = (parsedMeta.event_type || parsedMeta.payload_type || node.kind) as string | undefined;

  const fields: TooltipField[] = [];
  const nodeMeta = node.metadata as Record<string, unknown> | undefined;

  switch (eventType) {
    case "exec_command_end": {
      const commandText = parsedMeta.command_text as string | undefined;
      const command = parsedMeta.command;
      const commandString = commandText || (typeof command === "string" ? command : Array.isArray(command) ? command.join(" ") : undefined);
      const exitCode = parsedMeta.exit_code as number | undefined;
      const durationMs = parsedMeta.duration_ms as number | undefined;
      const duration = parsedMeta.duration as { secs?: number; nanos?: number } | undefined;
      const computedDurationMs = durationMs ?? (duration ? Math.round((duration.secs || 0) * 1000 + (duration.nanos || 0) / 1_000_000) : undefined);

      if (commandString) fields.push({ key: "cmd", label: "Command", value: commandString });
      if (exitCode !== undefined) fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      if (computedDurationMs !== undefined) fields.push({ key: "dur", label: "Duration", value: `${computedDurationMs}ms` });
      break;
    }

    case "patch_apply_end": {
      const changes = parsedMeta.changes as unknown[] | undefined;
      const status = parsedMeta.status as string | undefined;

      if (changes) fields.push({ key: "changes", label: "Changes", value: `${changes.length} files` });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "web_search_end": {
      const query = parsedMeta.query as string | undefined;
      const results = parsedMeta.results as unknown[] | undefined;
      const durationMs = parsedMeta.duration_ms as number | undefined;
      const duration = parsedMeta.duration as { secs?: number; nanos?: number } | undefined;
      const computedDurationMs = durationMs ?? (duration ? Math.round((duration.secs || 0) * 1000 + (duration.nanos || 0) / 1_000_000) : undefined);

      if (query) fields.push({ key: "query", label: "Query", value: query });
      if (results) fields.push({ key: "results", label: "Results", value: `${results.length} results` });
      if (computedDurationMs !== undefined) fields.push({ key: "dur", label: "Duration", value: `${computedDurationMs}ms` });
      break;
    }

    case "error":
    case "stream_error": {
      const message = parsedMeta.message as string | undefined;
      const errorType = parsedMeta.error_type as string | undefined;

      if (message) fields.push({ key: "msg", label: "Message", value: message });
      if (errorType) fields.push({ key: "type", label: "Type", value: errorType });
      break;
    }

    case "guardian_assessment": {
      const riskLevel = parsedMeta.risk_level as string | undefined;
      const action = parsedMeta.action as string | undefined;

      if (riskLevel) fields.push({ key: "risk", label: "Risk Level", value: riskLevel });
      if (action) fields.push({ key: "action", label: "Action", value: action });
      break;
    }

    // ── P0: Core ──────────────────────────────────────────

    case "task_started": {
      const phase = parsedMeta.phase as string | undefined;
      const startedAt = parsedMeta.started_at as string | undefined;

      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      if (startedAt) fields.push({ key: "started", label: "Started", value: startedAt });
      break;
    }

    case "task_complete": {
      const durationMs = parsedMeta.duration_ms as number | undefined;
      const ttft = parsedMeta.time_to_first_token_ms as number | undefined;
      const phase = parsedMeta.phase as string | undefined;

      if (durationMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durationMs) });
      if (ttft !== undefined) fields.push({ key: "ttft", label: "Time to First Token", value: formatDuration(ttft) });
      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      break;
    }

    case "user_message": {
      const message = parsedMeta.message as string | undefined;
      const phase = parsedMeta.phase as string | undefined;

      if (message) fields.push({ key: "msg", label: "Message", value: truncate(message, 120) });
      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      break;
    }

    case "agent_message": {
      const message = parsedMeta.message as string | undefined;
      const phase = parsedMeta.phase as string | undefined;

      if (message) fields.push({ key: "msg", label: "Message", value: truncate(message, 120) });
      if (phase) fields.push({ key: "phase", label: "Phase", value: phase });
      break;
    }

    // ── P1: Important ─────────────────────────────────────

    case "token_count": {
      const total = parsedMeta.total_tokens as number | undefined;
      const input = parsedMeta.total_input_tokens as number | undefined;
      const output = parsedMeta.total_output_tokens as number | undefined;
      const cached = parsedMeta.total_cached_input_tokens as number | undefined;

      if (total !== undefined) fields.push({ key: "total", label: "Total Tokens", value: formatNumber(total) });
      if (input !== undefined) fields.push({ key: "input", label: "Input", value: formatNumber(input) });
      if (output !== undefined) fields.push({ key: "output", label: "Output", value: formatNumber(output) });
      if (cached !== undefined) fields.push({ key: "cached", label: "Cached", value: formatNumber(cached) });
      break;
    }

    case "turn_aborted": {
      const reason = parsedMeta.reason as string | undefined;
      const lastMsg = parsedMeta.last_agent_message as string | undefined;

      if (reason) fields.push({ key: "reason", label: "Reason", value: reason });
      if (lastMsg) fields.push({ key: "last_msg", label: "Last Message", value: truncate(lastMsg, 80) });
      break;
    }

    case "thread_rolled_back": {
      const reason = parsedMeta.reason as string | undefined;

      if (reason) fields.push({ key: "reason", label: "Reason", value: reason });
      break;
    }

    case "context_compacted": {
      const summary = parsedMeta.summary as string | undefined;

      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "exec_command_begin": {
      const commandText = parsedMeta.command_text as string | undefined;
      const command = parsedMeta.command;
      const commandString = commandText || (typeof command === "string" ? command : Array.isArray(command) ? command.join(" ") : undefined);
      const cwd = parsedMeta.cwd as string | undefined;

      if (commandString) fields.push({ key: "cmd", label: "Command", value: commandString });
      if (cwd) fields.push({ key: "cwd", label: "CWD", value: cwd });
      break;
    }

    case "turn_diff": {
      const summary = parsedMeta.summary as string | undefined;

      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "collab_agent_spawn_end": {
      const nickname = parsedMeta.agent_nickname as string | undefined;
      const role = parsedMeta.agent_role as string | undefined;
      const model = parsedMeta.model as string | undefined;

      if (nickname) fields.push({ key: "nick", label: "Agent", value: nickname });
      if (role) fields.push({ key: "role", label: "Role", value: role });
      if (model) fields.push({ key: "model", label: "Model", value: model });
      break;
    }

    case "collab_agent_interaction_end": {
      const sender = parsedMeta.sender_thread_id as string | undefined;
      const receiver = parsedMeta.receiver_thread_id as string | undefined;
      const status = parsedMeta.status as string | undefined;

      if (sender) fields.push({ key: "sender", label: "Sender", value: sender });
      if (receiver) fields.push({ key: "receiver", label: "Receiver", value: receiver });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "collab_waiting_end": {
      const statuses = parsedMeta.agent_statuses as Record<string, string> | undefined;

      if (statuses && typeof statuses === "object") {
        const entries = Object.entries(statuses);
        if (entries.length > 0) {
          fields.push({ key: "agents", label: "Agent Statuses", value: entries.map(([k, v]) => `${k}: ${v}`).join(", ") });
        }
      }
      break;
    }

    case "collab_close_end": {
      const status = parsedMeta.status as string | undefined;

      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    // ── P2: Nice to have ──────────────────────────────────

    case "view_image_tool_call": {
      const imagePath = parsedMeta.image_path as string | undefined;

      if (imagePath) fields.push({ key: "path", label: "Image", value: imagePath });
      break;
    }

    case "web_search_begin": {
      const query = parsedMeta.query as string | undefined;

      if (query) fields.push({ key: "query", label: "Query", value: query });
      break;
    }

    case "mcp_tool_call_end": {
      const server = parsedMeta.server as string | undefined;
      const toolName = parsedMeta.tool_name as string | undefined;
      const durationMs = parsedMeta.duration_ms as number | undefined;
      const status = parsedMeta.status as string | undefined;

      if (server) fields.push({ key: "server", label: "Server", value: server });
      if (toolName) fields.push({ key: "tool", label: "Tool", value: toolName });
      if (durationMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durationMs) });
      if (status) fields.push({ key: "status", label: "Status", value: status });
      break;
    }

    case "plan_update": {
      const summary = parsedMeta.summary as string | undefined;

      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "thread_goal_updated": {
      const summary = parsedMeta.summary as string | undefined;

      if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
      break;
    }

    case "hook_started":
    case "hook_completed": {
      const hookName = parsedMeta.hook_name as string | undefined;
      const hookType = parsedMeta.hook_type as string | undefined;
      const durationMs = parsedMeta.duration_ms as number | undefined;

      if (hookName) fields.push({ key: "name", label: "Hook", value: hookName });
      if (hookType) fields.push({ key: "type", label: "Type", value: hookType });
      if (durationMs !== undefined) fields.push({ key: "dur", label: "Duration", value: formatDuration(durationMs) });
      break;
    }
  }

  // ── Fallback: always show at least basic info ───────────
  if (fields.length === 0) {
    const kind = node.kind as string | undefined;
    const title = (parsedMeta.title || nodeMeta?.title) as string | undefined;
    const summary = (parsedMeta.summary || nodeMeta?.summary) as string | undefined;
    const content = (parsedMeta.content || nodeMeta?.content) as string | undefined;
    const toolName = parsedMeta.tool_name as string | undefined;
    const name = parsedMeta.name as string | undefined;

    if (kind) fields.push({ key: "kind", label: "Type", value: kind });
    if (title) fields.push({ key: "title", label: "Title", value: truncate(title, 80) });
    if (toolName || name) fields.push({ key: "tool", label: "Tool", value: (toolName || name)! });
    if (summary) fields.push({ key: "summary", label: "Summary", value: truncate(summary, 120) });
    if (content && !summary) fields.push({ key: "content", label: "Content", value: truncate(content, 120) });

    // Ultimate fallback
    if (fields.length === 0 && node.kind) {
      fields.push({ key: "kind", label: "Type", value: node.kind });
    }
  }

  return fields;
}

export function GraphTooltip({ node, x, y, viewportWidth, viewportHeight }: GraphTooltipProps) {
  const fields = useMemo(() => extractFields(node), [node]);

  if (fields.length === 0) return null;

  // Estimate tooltip dimensions (approximate values based on typical content)
  const estimatedWidth = 280;
  const estimatedHeight = 24 + fields.length * 20;

  // Calculate adjusted position with boundary detection
  let adjustedX = x + 12;
  let adjustedY = y - 10;

  // Check right boundary
  if (adjustedX + estimatedWidth > viewportWidth) {
    adjustedX = x - estimatedWidth - 12;
  }

  // Check bottom boundary
  if (adjustedY + estimatedHeight > viewportHeight) {
    adjustedY = y - estimatedHeight - 10;
  }

  // Check left boundary
  if (adjustedX < 0) {
    adjustedX = 12;
  }

  // Check top boundary
  if (adjustedY < 0) {
    adjustedY = 12;
  }

  return (
    <div
      className="absolute glass-card rounded-lg p-3 text-xs space-y-1 pointer-events-none z-50"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {fields.map((f) => (
        <div key={f.key} className="flex gap-2">
          <span className="text-muted-foreground font-medium">{f.label}:</span>
          <span className="text-card-foreground">{f.value}</span>
        </div>
      ))}
    </div>
  );
}
