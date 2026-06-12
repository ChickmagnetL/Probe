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

const INPUT_DETAIL_TITLES: Record<string, string> = {
  input_prompt: "附加输入 · Prompt/指令",
  input_image: "附加输入 · 图片",
  input_hook: "附加输入 · Hook",
  input_attachment: "附加输入 · 附件",
  input_context: "附加输入 · 上下文",
};

const INPUT_DETAIL_CONTENT_LABELS: Record<string, string> = {
  input_prompt: "Prompt 内容",
  input_image: "图片路径",
  input_hook: "Hook 信息",
  input_attachment: "附加内容",
  input_context: "上下文内容",
};

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
): { title: string; summary: string; content_label: string; intro: string } {
  const normalized = (content ?? "").trimStart();
  const partTypeLower = (partType ?? "").toLowerCase();

  if (normalized.startsWith("You are Codex")) {
    return { title: "系统内置规则", summary: "Codex 默认系统规则（base_instructions）", content_label: "规则内容", intro: "Codex 启动时自动附带给模型的默认规则，不是用户手动输入。" };
  }
  if (normalized.startsWith("# AGENTS.md instructions")) {
    return { title: "项目规则（AGENTS.md）", summary: "项目规则（AGENTS.md）", content_label: "规则内容", intro: "仓库里的 AGENTS.md 规则，会和本轮输入一起提供给模型。" };
  }
  if (normalized.startsWith("<environment_context>")) {
    return { title: "运行环境信息", summary: "运行环境信息", content_label: "环境内容", intro: "当前工作目录、日期、时区等运行环境信息，会随本轮输入一起提供给模型。" };
  }
  if (sourceTitle === "开发者指令") {
    return { title: "开发者附加规则", summary: "开发者附加规则", content_label: "规则内容", intro: "这是开发者在本轮额外附带给模型的执行规则，不是用户直接输入的文本。" };
  }
  if (detailKind === "input_hook" || normalized.toLowerCase().includes("hook") || partTypeLower.includes("hook")) {
    return { title: "Hook 输入", summary: "Hook 输入", content_label: "Hook 内容", intro: "这是本轮额外附带的 Hook 参数或 Hook 名称，会一起传给模型。" };
  }
  if (detailKind === "input_image") {
    return { title: "图片输入", summary: "图片输入", content_label: "图片路径", intro: "这是和本轮提问一起传给模型的图片输入。" };
  }
  if (detailKind === "input_attachment") {
    return { title: "附带附件", summary: "附带附件", content_label: "附件内容", intro: "这是和本轮输入一起附带的额外附件或结构化内容。" };
  }
  if (detailKind === "input_prompt") {
    return { title: "附带规则/指令", summary: "附带规则/指令", content_label: "规则内容", intro: "这段内容不是用户自然语言提问，而是本轮一起传给模型的附加规则或提示。" };
  }
  return {
    title: INPUT_DETAIL_TITLES[detailKind] ?? "附加输入",
    summary: truncate(content ?? "", 120),
    content_label: INPUT_DETAIL_CONTENT_LABELS[detailKind] ?? "内容",
    intro: "这是和用户输入一起提供给模型的补充上下文。",
  };
}

function jsonishText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
