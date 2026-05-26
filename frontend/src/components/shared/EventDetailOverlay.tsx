import { useEffect, useState } from "react";
import type { EventRow } from "../../ipc/types";
import { kindLabel, extractToolName } from "../graph/graph-labels";
import {
  MetaCardsGrid,
  ContentRenderer,
  MetadataSection,
  MergedToolCallContent,
} from "./EventDetailContent";

interface EventDetailOverlayProps {
  event: EventRow;
  pairedEvent?: EventRow;
  onClose: () => void;
}

export function EventDetailOverlay({
  event,
  pairedEvent,
  onClose,
}: EventDetailOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    setShouldRender(true);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  if (!shouldRender) return null;

  return (
    <div className="absolute inset-0 z-50 flex pointer-events-none">
      {/* Backdrop - pointer-events-none allows interaction with canvas underneath */}
      <div
        className={`flex-1 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      />

      {/* Panel */}
      <div
        className={`w-[400px] shrink-0 pointer-events-auto bg-card border-l border-border flex flex-col transition-transform duration-200 ease-out ${visible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
          <button
            onClick={handleClose}
            className="rounded-md bg-muted/50 px-3 py-1.5 hover:bg-muted active:bg-muted/70 active:scale-95 transition-all"
            aria-label="Back"
            type="button"
          >
            <svg
              width="22"
              height="12"
              viewBox="0 0 22 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6H2M7 1L2 6l5 5" />
            </svg>
          </button>
          <h3 className="text-sm font-semibold text-card-foreground">
            {event.kind === "tool_call" || event.kind === "tool_output"
              ? (() => {
                  const callEvent = event.kind === "tool_call" ? event : pairedEvent;
                  const toolName = extractToolName(callEvent?.metadata);
                  return toolName ? `function_call:${toolName}` : kindLabel(event.kind);
                })()
              : kindLabel(event.kind)
            }
          </h3>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-5 space-y-5">
            {(event.kind === "tool_call" || event.kind === "tool_output") && pairedEvent ? (
              <MergedToolCallContent
                callEvent={event.kind === "tool_call" ? event : pairedEvent}
                outputEvent={event.kind === "tool_output" ? event : pairedEvent}
              />
            ) : (event.kind === "tool_call" || event.kind === "tool_output") && !pairedEvent ? (
              <>
                {event.content && <ContentRenderer event={event} />}
                {event.metadata && (
                  <MetadataSection metadata={event.metadata} sourceLineNo={event.source_line_no} />
                )}
              </>
            ) : (
              <>
                <MetaCardsGrid event={event} />

                {event.content && (
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                      Content
                    </h4>
                    <ContentRenderer event={event} />
                  </div>
                )}

                {event.metadata && (
                  <MetadataSection metadata={event.metadata} sourceLineNo={event.source_line_no} />
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
