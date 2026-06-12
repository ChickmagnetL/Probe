import { useMemo } from "react";
import type { GraphNode } from "./graph-layout";
import { extractFields, mergeMetaLayers, type EventField } from "../../lib/event-fields";

interface GraphTooltipProps {
  node: GraphNode;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function GraphTooltip({ node, x, y, viewportWidth, viewportHeight }: GraphTooltipProps) {
  const fields: EventField[] = useMemo(() => {
    if (!node.metadata) return [];
    const merged = mergeMetaLayers(node.metadata as Record<string, unknown> | undefined);
    return extractFields(merged, node.kind);
  }, [node]);

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