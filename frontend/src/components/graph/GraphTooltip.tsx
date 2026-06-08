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

function extractFields(node: GraphNode): TooltipField[] {
  if (!node.metadata) return [];

  const meta = node.metadata;

  // Parse metadata if it's a JSON string
  let parsedMeta = meta;
  if (typeof meta.metadata === "string") {
    try {
      parsedMeta = { ...meta, ...JSON.parse(meta.metadata) };
    } catch {
      // Keep original if parsing fails
    }
  } else if (meta.metadata && typeof meta.metadata === "object") {
    parsedMeta = { ...meta, ...meta.metadata };
  }

  // Try multiple sources for event type:
  // 1. event_type (from frontend parser extractors.ts)
  // 2. payload_type (from raw JSONL)
  // 3. node.kind (fallback, though it's usually "tool_output" not "exec_command_end")
  const eventType = (parsedMeta.event_type || parsedMeta.payload_type || node.kind) as string | undefined;

  switch (eventType) {
    case "exec_command_end": {
      const fields: TooltipField[] = [];
      // Try both parsed field names (command_text from extractors) and raw payload field names (command from JSONL)
      const commandText = parsedMeta.command_text as string | undefined;
      const command = parsedMeta.command;
      const commandString = commandText || (typeof command === "string" ? command : Array.isArray(command) ? command.join(" ") : undefined);
      const exitCode = parsedMeta.exit_code as number | undefined;
      const durationMs = parsedMeta.duration_ms as number | undefined;
      // Fallback to parsing duration object if duration_ms not available
      const duration = parsedMeta.duration as { secs?: number; nanos?: number } | undefined;
      const computedDurationMs = durationMs ?? (duration ? Math.round((duration.secs || 0) * 1000 + (duration.nanos || 0) / 1_000_000) : undefined);

      if (commandString) {
        fields.push({ key: "cmd", label: "Command", value: commandString });
      }
      if (exitCode !== undefined) {
        fields.push({ key: "exit", label: "Exit Code", value: String(exitCode) });
      }
      if (computedDurationMs !== undefined) {
        fields.push({ key: "dur", label: "Duration", value: `${computedDurationMs}ms` });
      }
      return fields;
    }

    case "patch_apply_end": {
      const fields: TooltipField[] = [];
      const changes = parsedMeta.changes as unknown[] | undefined;
      const status = parsedMeta.status as string | undefined;

      if (changes) {
        fields.push({ key: "changes", label: "Changes", value: `${changes.length} files` });
      }
      if (status) {
        fields.push({ key: "status", label: "Status", value: status });
      }
      return fields;
    }

    case "web_search_end": {
      const fields: TooltipField[] = [];
      const query = parsedMeta.query as string | undefined;
      const results = parsedMeta.results as unknown[] | undefined;
      const durationMs = parsedMeta.duration_ms as number | undefined;
      // Fallback to parsing duration object if duration_ms not available
      const duration = parsedMeta.duration as { secs?: number; nanos?: number } | undefined;
      const computedDurationMs = durationMs ?? (duration ? Math.round((duration.secs || 0) * 1000 + (duration.nanos || 0) / 1_000_000) : undefined);

      if (query) {
        fields.push({ key: "query", label: "Query", value: query });
      }
      if (results) {
        fields.push({ key: "results", label: "Results", value: `${results.length} results` });
      }
      if (computedDurationMs !== undefined) {
        fields.push({ key: "dur", label: "Duration", value: `${computedDurationMs}ms` });
      }
      return fields;
    }

    case "error":
    case "stream_error": {
      const fields: TooltipField[] = [];
      const message = parsedMeta.message as string | undefined;
      const errorType = parsedMeta.error_type as string | undefined;

      if (message) {
        fields.push({ key: "msg", label: "Message", value: message });
      }
      if (errorType) {
        fields.push({ key: "type", label: "Type", value: errorType });
      }
      return fields;
    }

    case "guardian_assessment": {
      const fields: TooltipField[] = [];
      const riskLevel = parsedMeta.risk_level as string | undefined;
      const action = parsedMeta.action as string | undefined;

      if (riskLevel) {
        fields.push({ key: "risk", label: "Risk Level", value: riskLevel });
      }
      if (action) {
        fields.push({ key: "action", label: "Action", value: action });
      }
      return fields;
    }

    default:
      return [];
  }
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
