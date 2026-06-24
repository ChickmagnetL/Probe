/**
 * Human-readable labels for graph node kinds.
 */

const KIND_LABELS: Record<string, string> = {
  agents_md: "AGENTS.md",
  user_input: "User",
  assistant_output: "AI",
  assistant_update: "AI",
  tool_call: "Tool",
  tool_output: "Result",
  tool_event: "Tool Event",
  search_event: "Search",
  system_event: "System",
  compaction_event: "Compaction",
  instruction: "Instruction",
  subagent_session: "Sub-agent",
  turn_aborted: "Turn Aborted",
  input_context: "Context",
  system_prompt: "System Prompt",
  input_hook: "Hook",
  input_image: "Image",
  input_attachment: "Attachment",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

// ── Shared event type label (used by graph, timeline, chat, raw) ──

type LabelSource = { kind: string; metadata?: unknown };

function tryParseMeta(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

function strField(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Resolves the original JSONL event type from metadata,
 * using the same priority chain as graphDetailNodeLabel.
 * Falls back to kindLabel(kind) if no original type is found.
 */
export function eventTypeLabel(src: LabelSource): string {
  const raw = tryParseMeta(src.metadata);
  const rawMeta = raw ? tryParseMeta(raw.metadata) : null;
  const sourceRecord = tryParseMeta(rawMeta?.source_record)
    ?? tryParseMeta(raw?.source_record);
  const sourcePayload = sourceRecord ? tryParseMeta(sourceRecord.payload) : null;

  const label =
    strField(rawMeta, "payload_type")
    ?? strField(raw, "payload_type")
    ?? strField(raw, "record_type")
    ?? strField(sourceRecord, "payload_type")
    ?? strField(sourceRecord, "record_type")
    ?? strField(sourcePayload, "type")
    ?? null;

  // If we got a raw event type different from the simplified kind, show it
  if (label && label !== src.kind) return label;

  // Fall back to the friendly kind label
  return kindLabel(src.kind);
}
