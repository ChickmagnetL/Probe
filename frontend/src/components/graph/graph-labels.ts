/**
 * Human-readable labels for graph detail nodes.
 */

const KIND_LABELS: Record<string, string> = {
  agents_md: "AGENTS.md",
  user_input: "User",
  assistant_output: "AI",
  assistant_update: "AI",
  tool_call: "Tool",
  tool_output: "Result",
  instruction: "Instruction",
  subagent_session: "Sub-agent",
  input_context: "Context",
  system_prompt: "System Prompt",
  input_hook: "Hook",
  input_image: "Image",
  input_attachment: "Attachment",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function extractToolName(metadata: string | Record<string, unknown> | null | undefined): string {
  if (!metadata) return "";
  let parsed: Record<string, unknown>;
  if (typeof metadata === "string") {
    try { parsed = JSON.parse(metadata); } catch { return ""; }
  } else {
    parsed = metadata;
  }
  // Try parsing raw_text -> payload.name
  const rawText = parsed.raw_text;
  if (typeof rawText === "string") {
    try {
      const jsonl = JSON.parse(rawText);
      const payload = jsonl.payload ?? jsonl;
      if (typeof payload.name === "string" && payload.name) return payload.name;
    } catch { /* fall through */ }
  }
  // Fallback: extract from title "工具调用 · {name}"
  const title = parsed.title;
  if (typeof title === "string" && title.includes(" · ")) {
    return title.split(" · ")[1] ?? "";
  }
  return "";
}

export function detailLabel(kind: string, summary?: string, title?: string): string {
  // Prefer summary if it's short and meaningful
  if (summary && summary.length > 0 && summary.length <= 40) return summary;
  if (title && title.length > 0 && title.length <= 40) return title;
  return KIND_LABELS[kind] ?? kind;
}
