import type { EventRow } from "../../ipc/types";
import { EventNode } from "./EventNode";

interface TimelineViewProps {
  events: EventRow[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

export function TimelineView({ events, selectedEventId, onSelectEvent }: TimelineViewProps) {
  return (
    <div className="flex flex-col h-full">
      {/* 顶部留出空间给浮动 tab，右侧显示事件数 */}
      <div className="shrink-0 flex items-center justify-end px-5 pt-8 pb-2">
        {events.length > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground">
            {events.length} events
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No events</p>
        ) : (
          <div>
            {events.map((ev, i) => (
              <EventNode
                key={ev.id}
                event={ev}
                index={i}
                isSelected={ev.id === selectedEventId}
                onClick={() => onSelectEvent(ev.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
