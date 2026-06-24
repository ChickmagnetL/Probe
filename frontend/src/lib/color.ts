const ROLE_COLORS: Record<string, string> = {
  user: "#007AFF",
  assistant: "#34C759",
  tool: "#5856D6",
  system: "#FF9500",
  reasoning: "#AF52DE",
};

export function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "#8E8E93";
}

export function roleColorDim(role: string): string {
  const c = roleColor(role);
  return c + "33"; // 20% opacity hex suffix
}

/**
 * Color by event kind for spindle graph rendering.
 * All node types have distinctive colors for better visual differentiation.
 */
export function kindColor(kind: string): string {
  // Input types (blue shades)
  if (kind === "user_input") return "#3b82f6"; // blue
  if (kind === "agents_md") return "#3b82f6"; // blue
  if (kind === "input_context") return "#0891b2"; // cyan
  if (kind === "input_image") return "#06b6d4"; // light cyan
  if (kind === "input_attachment") return "#0284c7"; // sky blue
  if (kind === "input_hook") return "#0369a1"; // dark cyan
  if (kind.startsWith("input_")) return "#3b82f6"; // blue fallback

  // Output types (green shades)
  if (kind === "assistant_output") return "#10b981"; // green
  if (kind === "assistant_update") return "#10b981"; // green

  // Tool types (amber/orange shades)
  if (kind === "tool_call") return "#f59e0b"; // amber
  if (kind === "tool_output") return "#a855f7"; // purple
  if (kind === "tool_event") return "#f97316"; // orange
  if (kind === "search_event") return "#fb923c"; // light orange

  // Instruction/System types (indigo/slate shades)
  if (kind === "instruction") return "#6366f1"; // indigo
  if (kind === "system_prompt") return "#8b5cf6"; // violet

  // Agent/reasoning types (purple/gray shades)
  if (kind === "subagent_session") return "#AF52DE"; // purple
  if (kind === "reasoning") return "#6b7280"; // gray

  // System/event types (red/pink shades)
  if (kind === "system_event") return "#ef4444"; // red
  if (kind === "compaction_event") return "#ec4899"; // pink
  if (kind === "turn_aborted") return "#dc2626"; // dark red

  // Fallback (should rarely be used now)
  return "#94a3b8"; // slate-400 instead of gray
}

/** @deprecated Use kindColor for graph nodes */
export function typeColor(eventType: string): string {
  return kindColor(eventType);
}
