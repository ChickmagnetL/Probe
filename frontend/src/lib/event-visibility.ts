import type { EventRow } from "../ipc/types";

interface EventWithMetadata {
  metadata?: EventRow["metadata"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMetadata(
  metadata: EventWithMetadata["metadata"],
): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata !== "string") return isRecord(metadata) ? metadata : null;
  try {
    const parsed = JSON.parse(metadata);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isGraphHiddenEvent(event: EventWithMetadata): boolean {
  return parseMetadata(event.metadata)?.graph_hidden === true;
}

export function filterGraphVisibleEvents<T extends EventWithMetadata>(
  events: readonly T[],
): T[] {
  return events.filter((event) => !isGraphHiddenEvent(event));
}
