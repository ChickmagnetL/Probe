import { useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EventRow } from "../../ipc/types";
import { filterGraphVisibleEvents } from "../../lib/event-visibility";
import { EventNode } from "./EventNode";

interface TimelineViewProps {
  events: EventRow[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

export function TimelineView({ events, selectedEventId, onSelectEvent }: TimelineViewProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleEvents = useMemo(
    () => filterGraphVisibleEvents(events),
    [events],
  );

  useEffect(() => {
    if (!selectedEventId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(
      `[data-event-id="${selectedEventId}"]`,
    );
    if (!el) return;
    const container = scrollRef.current;
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const relativeTop = elRect.top - containerRect.top;
    const targetScrollTop =
      container.scrollTop + relativeTop - (container.clientHeight - el.offsetHeight) / 2;
    container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
  }, [selectedEventId]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-end px-5 pt-8 pb-2">
        {visibleEvents.length > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("timeline.events_other", { count: visibleEvents.length })}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-4">
        {visibleEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t("timeline.noEvents")}</p>
        ) : (
          <div>
            {visibleEvents.map((ev, i) => (
              <div key={ev.id} data-event-id={ev.id}>
                <EventNode
                  event={ev}
                  index={i}
                  isSelected={ev.id === selectedEventId}
                  onClick={() => onSelectEvent(ev.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
