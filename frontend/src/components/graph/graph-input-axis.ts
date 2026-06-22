import type { Transform } from "./graph-interaction";
import type { GraphNode } from "./graph-layout";
import type { GraphViewportSize } from "./graph-viewport";

export interface InputAxisItem {
  node: GraphNode;
  tooltipText: string | null;
}

export function buildInputAxisItems(nodes: GraphNode[]): InputAxisItem[] {
  return nodes
    .filter((node) => node.isInput)
    .sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return a.id.localeCompare(b.id);
    })
    .map((node) => ({
      node,
      tooltipText: extractInputAxisTooltipText(node),
    }));
}

export function centerGraphNodeInViewport(
  node: Pick<GraphNode, "x" | "y">,
  viewport: GraphViewportSize,
  transform: Transform,
): Transform {
  return {
    x: viewport.width / 2 - node.x * transform.k,
    y: viewport.height / 2 - node.y * transform.k,
    k: transform.k,
  };
}

export function inputAxisIndexFromRelativeY(
  relativeY: number,
  axisHeight: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0 || axisHeight <= 0) return null;
  if (itemCount === 1) return 0;

  const clampedY = Math.min(Math.max(relativeY, 0), axisHeight);
  const normalizedY = clampedY / axisHeight;
  return Math.round(normalizedY * (itemCount - 1));
}

export function extractInputAxisTooltipText(
  node: Pick<GraphNode, "metadata">,
): string | null {
  const meta = node.metadata;
  if (!meta) return null;

  const preserved = stringField(meta.input_content_text);
  if (preserved) return preserved;

  const payloadText = textFromPayload(meta);
  if (payloadText) return payloadText;

  return null;
}

function textFromPayload(record: Record<string, unknown>): string | null {
  return isRecord(record.payload) ? textFromContent(record.payload.content) : null;
}

function textFromContent(content: unknown): string | null {
  if (!isRecord(content)) return null;
  return stringField(content.text);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
