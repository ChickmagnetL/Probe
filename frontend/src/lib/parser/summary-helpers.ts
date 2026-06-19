export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function asInt(value: unknown): number {
  if (typeof value === "boolean") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

export function truncate(text: string, limit: number): string {
  const normalized = text.split(/\s+/).join(" ");
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 1) + "…";
}

export function shortId(value: string | null): string {
  if (!value) return "unknown";
  return value.split("-")[0];
}

/**
 * Parse an ISO timestamp string into milliseconds since epoch.
 * Returns 0 for invalid/missing timestamps.
 */
export function parseTimestamp(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  try {
    const t = new Date(timestamp.replace("Z", "+00:00")).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

/**
 * Sort key for timestamps: earlier = smaller number.
 */
export function sortKeyFromTimestamp(timestamp: string | null | undefined): number {
  return parseTimestamp(timestamp);
}

const EVENT_ORDER: Record<string, number> = {
  agents_md: 10,
  user_input: 10,
  instruction: 20,
  input_image: 42,
  assistant_update: 40,
  turn_aborted: 45,
  tool_call: 50,
  tool_event: 55,
  tool_output: 60,
  search_event: 62,
  system_event: 64,
  compaction_event: 66,
  assistant_output: 70,
  subagent_session: 80,
};

export function eventSortKey(event: Record<string, unknown>): [number, number, number, string] {
  return [
    sortKeyFromTimestamp(typeof event.timestamp === "string" ? event.timestamp : null),
    typeof event.source_line_no === "number" ? event.source_line_no : 1e9,
    EVENT_ORDER[(typeof event.kind === "string" ? event.kind : "")] ?? 999,
    typeof event.event_id === "string" ? event.event_id : "",
  ];
}

export function detailSortKey(event: Record<string, unknown>): [number, number, string] {
  return [
    typeof event.source_line_no === "number" ? event.source_line_no : 1e9,
    sortKeyFromTimestamp(typeof event.timestamp === "string" ? event.timestamp : null),
    typeof event.event_id === "string" ? event.event_id : "",
  ];
}

const AUX_INPUT_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<session-context>",
  "<current-state>",
  "<workflow>",
  "<guidelines>",
  "<instructions>",
  "<skill>",
  "<turn_aborted>",
  "The following is the Codex agent history",
  "Follow exactly the worker role file",
  "You are performing a risk assessment of a coding-agent tool call",
];

export function looksLikeAuxInput(event: Record<string, unknown>): boolean {
  const text = (stringOrNull(event.content) ?? stringOrNull(event.summary) ?? "").trimStart();
  if (!text) return false;
  if (AUX_INPUT_PREFIXES.some((p) => text.startsWith(p))) return true;
  if (text.includes("request action you are assessing")) return true;
  if (text.includes("Write only inside this write set")) return true;
  if ((text.match(/</g) ?? []).length >= 4 && (text.match(/>/g) ?? []).length >= 4) return true;
  return false;
}

export function pickPrimaryInputAnchor(userEvents: Record<string, unknown>[]): Record<string, unknown> | null {
  if (userEvents.length === 0) return null;
  const primary = userEvents.filter((e) => !looksLikeAuxInput(e));
  if (primary.length > 0) return primary[primary.length - 1];
  return userEvents[userEvents.length - 1];
}

const IMAGE_PATH_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

export function classifyInputDetailKind(event: Record<string, unknown>): string {
  if (stringOrNull(event.kind) === "instruction") return "input_prompt";
  const parts = event.content_parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (typeof part !== "object" || part === null) continue;
      const dk = classifyInputPartKind(part as Record<string, unknown>);
      if (dk !== "input_context") return dk;
    }
  }
  const text = (stringOrNull(event.content) ?? "").toLowerCase();
  if (text.includes("hook")) return "input_hook";
  if (IMAGE_PATH_SUFFIXES.some((s) => text.endsWith(s))) return "input_image";
  if (looksLikeAuxInput(event)) return "input_prompt";
  return "input_context";
}

export function classifyInputPartKind(part: Record<string, unknown>): string {
  const partType = (stringOrNull(part.type) ?? "").toLowerCase();
  const content = (extractInputPartContent(part) ?? "").toLowerCase();
  if (partType.includes("image") || IMAGE_PATH_SUFFIXES.some((s) => content.endsWith(s))) return "input_image";
  if (partType.includes("hook") || content.includes("hook")) return "input_hook";
  if (partType.includes("prompt") || "prompt" in part) return "input_prompt";
  if (partType && !["input_text", "text"].includes(partType)) return "input_attachment";
  if (looksLikePromptText(content)) return "input_prompt";
  return "input_context";
}

export function extractInputPartContent(part: Record<string, unknown>): string | null {
  for (const key of ["text", "content", "prompt", "image_path", "path", "file_path", "local_path", "url", "uri", "hook", "value"]) {
    const val = part[key];
    const s = stringOrNull(val);
    if (s) return s;
  }
  return jsonishText(part);
}

function looksLikePromptText(content: string): boolean {
  const normalized = content.trimStart();
  if (!normalized) return false;
  if (AUX_INPUT_PREFIXES.some((p) => normalized.startsWith(p.toLowerCase()))) return true;
  if (normalized.includes("prompt") && normalized.length > 40) return true;
  return false;
}

export function describeInputDetail(
  detailKind: string,
  content: string | null,
  sourceTitle?: string | null,
  partType?: string | null,
): { summary: string } {
  // Only the raw content summary is retained for input-detail events.
  // Display labels (title/content_label/intro) were parser-built Chinese
  // and have been removed; Show Detail displays the JSONL raw line instead.
  void detailKind;
  void sourceTitle;
  void partType;
  return { summary: truncate(content ?? "", 120) };
}

function jsonishText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
