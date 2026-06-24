import type { GraphNode } from "./graph-layout";

/**
 * Priority mapping for sorting node kinds in the legend.
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
  kind: string;
  sampleNode: GraphNode;
}

/**
 * Extract unique node kinds from the graph data and sort them by semantic priority.
 * Returns a sample node for each kind to enable eventTypeLabel() resolution.
 * Used to dynamically populate the legend with only the node types present in the current session.
 * Excludes user_input and assistant_output as they are anchor nodes not meant for filtering.
 */
export function extractVisibleKinds(nodes: GraphNode[]): LegendItem[] {
  const kindMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    // Skip anchor nodes (user input and assistant output)
    if (node.kind === "user_input" || node.kind === "assistant_output") {
      continue;
    }
    if (!kindMap.has(node.kind)) {
      kindMap.set(node.kind, node);
    }
  }

  const items = Array.from(kindMap.entries()).map(([kind, sampleNode]) => ({
    kind,
    sampleNode,
  }));

  items.sort((a, b) => {
    const prioA = KIND_SORT_ORDER[a.kind] ?? DEFAULT_PRIORITY;
    const prioB = KIND_SORT_ORDER[b.kind] ?? DEFAULT_PRIORITY;
    if (prioA !== prioB) return prioA - prioB;
    return a.kind.localeCompare(b.kind); // Same priority: alphabetical
  });

  return items;
}
