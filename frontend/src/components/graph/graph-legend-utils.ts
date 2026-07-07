import type { GraphNode } from "./graph-layout";

/**
 * Priority mapping for sorting node labels in the legend.
 * Lower numbers appear first. Grouped by semantic meaning:
 * - Input types: 0-19
 * - Output types: 20-29
 * - Tool types: 30-49
 * - Other: 50+
 */
const KIND_SORT_ORDER: Record<string, number> = {
  // Input class (0-19)
  "user_input": 0,
  "agents_md": 1,
  "input_context": 2,
  "input_image": 3,
  "input_attachment": 4,
  "input_hook": 5,
  "instruction": 6,
  "system_prompt": 7,

  // Output class (20-29)
  "assistant_output": 20,
  "assistant_update": 21,

  // Tool class (30-49)
  "tool_call": 30,
  "tool_output": 31,
  "tool_event": 32,
  "search_event": 33,

  // Other (50+)
  "reasoning": 50,
  "subagent_session": 51,
  "system_event": 52,
  "compaction_event": 53,
  "turn_aborted": 54,
};

const DEFAULT_PRIORITY = 99;

export interface LegendItem {
  label: string;
  sampleNode: GraphNode;
}

const EXCLUDED_LEGEND_LABELS = new Set(["User", "AI"]);

/**
 * Extract unique visible labels from the graph data and sort them by semantic priority.
 * Used to dynamically populate the legend with only the labels present in the current session.
 * Excludes User and AI anchor labels because they are not meant for filtering.
 */
export function extractVisibleLegendItems(nodes: GraphNode[]): LegendItem[] {
  const labelMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (EXCLUDED_LEGEND_LABELS.has(node.label)) {
      continue;
    }
    if (!labelMap.has(node.label)) {
      labelMap.set(node.label, node);
    }
  }

  const items = Array.from(labelMap.entries()).map(([label, sampleNode]) => ({
    label,
    sampleNode,
  }));

  items.sort((a, b) => {
    const prioA = KIND_SORT_ORDER[a.sampleNode.kind] ?? DEFAULT_PRIORITY;
    const prioB = KIND_SORT_ORDER[b.sampleNode.kind] ?? DEFAULT_PRIORITY;
    if (prioA !== prioB) return prioA - prioB;
    return a.label.localeCompare(b.label); // Same priority: alphabetical
  });

  return items;
}
