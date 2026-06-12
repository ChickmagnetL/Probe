import type { EventRow } from "../../ipc/types";
import { roleColor } from "../../lib/color";
import { formatTime } from "../../lib/format";
import { kindLabel } from "../graph/graph-labels";
import { extractFields, type EventField } from "../../lib/event-fields";

interface EventNodeProps {
  event: EventRow;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}

function getEventFields(event: EventRow): EventField[] {
  // Build metadata object from event row and parsed metadata JSON
  const meta: Record<string, unknown> = {
    event_type: event.kind,
    content: event.content,
    title: undefined,
    summary: undefined,
  };

  if (event.metadata) {
    try {
      const parsed = JSON.parse(event.metadata);
      Object.assign(meta, parsed);
    } catch { /* ignore parse errors */ }
  }

  return extractFields(meta, event.kind);
}

export function EventNode({ event, index, isSelected, onClick }: EventNodeProps) {
  const color = roleColor(event.role ?? "");
  const label = kindLabel(event.kind);
  const fields = getEventFields(event);

  return (
    <div className="relative flex gap-3">
      {/* Timeline track */}
      <div className="flex flex-col items-center shrink-0 w-5">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ring-2 ring-background z-10"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 w-px bg-border/60" />
      </div>

      {/* Card */}
      <button
        onClick={onClick}
        className={`flex-1 text-left rounded-xl border px-4 py-3 mb-3 transition-all duration-150 ${
          isSelected
            ? "bg-primary/5 border-primary shadow-sm"
            : "bg-card border-border/50 hover:border-border hover:shadow-sm"
        }`}
      >
        {/* Header row */}
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
              isSelected
                ? "bg-primary/10 text-primary"
                : "bg-muted text-foreground"
            }`}
          >
            {label}
          </span>
          <span className={`ml-auto text-[11px] font-mono ${isSelected ? "text-primary/60" : "text-muted-foreground/50"}`}>
            #{index + 1}
          </span>
        </div>

        {/* Content preview */}
        {event.content && (
          <p className={`mt-2 text-xs leading-relaxed line-clamp-2 ${isSelected ? "text-foreground/80" : "text-muted-foreground"}`}>
            {event.content.slice(0, 160)}
          </p>
        )}

        {/* Field summary row (R3) */}
        {fields.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            {fields.map((f) => (
              <span key={f.key} className={`text-[11px] inline-flex gap-1 ${isSelected ? "text-foreground/60" : "text-muted-foreground/50"}`}>
                <span className="font-medium">{f.label}:</span>
                <span className="truncate max-w-[180px]">{f.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* Timestamp */}
        {event.timestamp && (
          <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${isSelected ? "text-foreground/50" : "text-muted-foreground/40"}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{formatTime(event.timestamp)}</span>
          </div>
        )}
      </button>
    </div>
  );
}