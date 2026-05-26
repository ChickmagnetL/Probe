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
 * user_input -> blue, assistant_output -> green, tool_call -> amber,
 * tool_output -> purple, reasoning -> gray, subagent_session -> purple, other -> #ccc.
 */
export function kindColor(kind: string): string {
  if (kind === "user_input" || kind === "agents_md" || kind.startsWith("input_")) return "#3b82f6";
  if (kind === "assistant_output" || kind === "assistant_update") return "#10b981";
  if (kind === "tool_call") return "#f59e0b";
  if (kind === "tool_output") return "#a855f7";
  if (kind === "subagent_session") return "#AF52DE";
  if (kind === "reasoning") return "#6b7280";
  return "#ccc";
}

/** @deprecated Use kindColor for graph nodes */
export function typeColor(eventType: string): string {
  return kindColor(eventType);
}
