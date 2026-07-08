import type { GraphData, GraphNode } from "./graph-layout";
import { graphNodeLabelPadding } from "./graph-layout";
import type { Transform } from "./graph-interaction";

const GRAPH_FIT_PADDING = 120;
const RESET_VIEW_SCALE = 1;

export interface GraphViewportSize {
  width: number;
  height: number;
}

/** Compute world-space bounding box for graph data. */
export function graphBounds(data: GraphData): { minX: number; minY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of data.nodes) {
    const labelPadding = graphNodeLabelPadding(n);
    if (n.x - labelPadding.left < minX) minX = n.x - labelPadding.left;
    if (n.y - labelPadding.y < minY) minY = n.y - labelPadding.y;
    if (n.x + labelPadding.right > maxX) maxX = n.x + labelPadding.right;
    if (n.y + labelPadding.y > maxY) maxY = n.y + labelPadding.y;
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

export function computeFitToGraphTransform(
  data: GraphData,
  viewport: GraphViewportSize,
): Transform {
  const bounds = graphBounds(data);
  const scaleX = viewport.width / (bounds.w + GRAPH_FIT_PADDING);
  const scaleY = viewport.height / (bounds.h + GRAPH_FIT_PADDING);
  const k = Math.min(scaleX, scaleY, 1);
  const cx = bounds.minX + bounds.w / 2;
  const cy = bounds.minY + bounds.h / 2;
  return centerNodeTransform({ x: cx, y: cy }, viewport, k);
}

export function computeResetViewTransform(
  data: GraphData,
  viewport: GraphViewportSize,
  mainSessionId?: string,
): Transform {
  const node = firstMainUserInputNode(data, mainSessionId);
  if (node) return centerNodeTransform(node, viewport, RESET_VIEW_SCALE);
  // Fallback: center on the first visible node at a reasonable scale instead of
  // fitting the entire graph (which can zoom way out for sub-agent sessions that
  // lack a user_input anchor).
  if (data.nodes.length > 0) {
    return centerNodeTransform(data.nodes[0], viewport, RESET_VIEW_SCALE);
  }
  return computeFitToGraphTransform(data, viewport);
}

function firstMainUserInputNode(data: GraphData, mainSessionId?: string): GraphNode | undefined {
  if (mainSessionId) {
    const node = data.nodes.find((n) => n.isInput && n.sessionId === mainSessionId);
    if (node) return node;
  }
  return data.nodes.find((n) => n.isInput);
}

function centerNodeTransform(
  node: Pick<GraphNode, "x" | "y">,
  viewport: GraphViewportSize,
  k: number,
): Transform {
  return {
    x: viewport.width / 2 - node.x * k,
    y: viewport.height / 2 - node.y * k,
    k,
  };
}
