import { extractFields, mergeMetaLayers, type EventField } from "../../lib/event-fields";

const DISPLAY_FIELD_KEYS = new Set([
  "title",
  "summary",
  "detail_note",
  "content",
  "content_label",
  "intro",
]);

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function omitDisplayFields(meta: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...meta };
  for (const key of DISPLAY_FIELD_KEYS) {
    delete next[key];
  }
  return next;
}

function withoutBaselineDuplicates(fields: EventField[], baseline: EventField[]): EventField[] {
  const baselineLabels = new Set(baseline.map((field) => field.label));
  const baselineKeys = new Set(baseline.map((field) => field.key));
  return fields.filter((field) => (
    !baselineKeys.has(field.key)
    && !baselineLabels.has(field.label)
    && field.label !== "Call ID"
    && field.label !== "Duration"
  ));
}

export function extractGraphTooltipFields(
  rawMeta: Record<string, unknown> | undefined,
  kind: string,
): EventField[] {
  const meta = omitDisplayFields(mergeMetaLayers(rawMeta));
  const fields = extractFields(meta, kind);

  // Subagent nodes show only their agent name + role, matching the session list.
  if (kind === "subagent_session") {
    return fields;
  }

  const baseline: EventField[] = [];
  // claude_code events carry a native identity (``claude_event_type``); prepend
  // it as the baseline so the tooltip always shows the identity first. codex
  // events have no such field and fall through to the record_type / payload_type
  // baseline unchanged.
  const claudeEventType = stringOrNull(meta.claude_event_type);
  if (claudeEventType) {
    baseline.push({ key: "claude_event_type", label: "Identity", value: claudeEventType });
  } else {
    const recordType = stringOrNull(meta.record_type);
    const payloadType = stringOrNull(meta.payload_type) ?? stringOrNull(meta.event_type);
    if (recordType) baseline.push({ key: "record_type", label: "Type", value: recordType });
    if (payloadType) baseline.push({ key: "payload_type", label: "Payload Type", value: payloadType });
  }

  return [...baseline, ...withoutBaselineDuplicates(fields, baseline)].slice(0, 3);
}
