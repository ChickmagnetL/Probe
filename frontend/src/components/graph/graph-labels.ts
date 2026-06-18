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
