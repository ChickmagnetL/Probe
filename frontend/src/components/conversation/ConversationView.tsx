import { useState, useMemo, useRef, useEffect } from "react";
import type { EventRow } from "../../ipc/types";
import { kindLabel } from "../graph/graph-labels";

interface ConversationViewProps {
  events: EventRow[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

interface Turn {
  user: EventRow | null;
  assistant: EventRow | null;
  inputDetails: EventRow[];
  outputDetails: EventRow[];
}

const AUX_INPUT_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<session-context>",
  "<current-state>",
  "<workflow>",
  "<guidelines>",
  "<instructions>",
  "<skill>",
  "<turn_aborted>",
];

function isAuxInput(ev: EventRow): boolean {
  const text = (ev.content ?? "").trimStart();
  if (!text) return false;
  return AUX_INPUT_PREFIXES.some((p) => text.startsWith(p));
}

function buildTurns(events: EventRow[]): Turn[] {
  const sorted = [...events].sort((a, b) => {
    if (!a.timestamp && !b.timestamp)
      return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    const cmp = a.timestamp.localeCompare(b.timestamp);
    if (cmp !== 0) return cmp;
    return (a.source_line_no ?? 0) - (b.source_line_no ?? 0);
  });

  const turns: Turn[] = [];
  let pendingUser: EventRow[] = [];
  let pendingAssistant: EventRow[] = [];

  function flush() {
    if (pendingUser.length === 0 && pendingAssistant.length === 0) return;

    const userInputEvents = pendingUser.filter((e) => e.kind === "user_input" || e.kind === "agents_md");
    const nonAux = userInputEvents.filter((e) => !isAuxInput(e));
    const anchor = nonAux.length > 0
      ? nonAux[nonAux.length - 1]
      : userInputEvents.length > 0
        ? userInputEvents[userInputEvents.length - 1]
        : pendingUser[pendingUser.length - 1];

    const inputDetails = pendingUser.filter((e) => e.id !== anchor?.id);

    const assistantOutputs = pendingAssistant.filter((e) => e.kind === "assistant_output");
    const assistantAnchor = assistantOutputs.length > 0
      ? assistantOutputs[assistantOutputs.length - 1]
      : null;

    const outputDetails = pendingAssistant.filter(
      (e) => !assistantAnchor || e.id !== assistantAnchor.id,
    );

    turns.push({
      user: anchor ?? null,
      assistant: assistantAnchor,
      inputDetails,
      outputDetails,
    });
    pendingUser = [];
    pendingAssistant = [];
  }

  for (const ev of sorted) {
    if (ev.kind === "user_input" || ev.kind === "agents_md" || ev.kind === "instruction") {
      if (pendingAssistant.length > 0) flush();
      pendingUser.push(ev);
    } else {
      pendingAssistant.push(ev);
    }
  }
  flush();

  return turns;
}

function StepList({
  label,
  steps,
  selectedEventId,
  onSelectEvent,
}: {
  label: string;
  steps: EventRow[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selectedEventId && steps.some((s) => s.id === selectedEventId)) {
      setOpen(true);
    }
  }, [selectedEventId, steps]);

  if (steps.length === 0) return null;

  return (
    <div className="my-1">
      <div className="flex justify-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors
                     flex items-center gap-1 px-3 py-1 rounded-full hover:bg-muted"
          type="button"
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {label}
        </button>
      </div>
      {open && (
        <div className="mt-1 space-y-1 animate-fade-in">
          {steps.map((step) => {
            const isSelected = step.id === selectedEventId;
            return (
              <div
                key={step.id}
                data-event-id={step.id}
                onClick={() => onSelectEvent(step.id)}
                className={`
                  flex items-start gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer
                  transition-all bg-muted/50 hover:bg-muted
                  ${isSelected ? "ring-1 ring-ring" : ""}
                `}
              >
                <span className="shrink-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wide min-w-[60px]">
                  {kindLabel(step.kind)}
                </span>
                <span className="text-muted-foreground truncate">
                  {step.content?.slice(0, 120) || "(empty)"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConversationView({
  events,
  selectedEventId,
  onSelectEvent,
}: ConversationViewProps) {
  const turns = useMemo(() => buildTurns(events), [events]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedEventId || !scrollRef.current) return;
    // Delay to allow StepList auto-expand to render the DOM element
    const id = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(
        `[data-event-id="${selectedEventId}"]`,
      );
      if (!el) return;
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top;
      const targetScrollTop =
        container.scrollTop + relativeTop - (container.clientHeight - el.offsetHeight) / 2;
      container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedEventId]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-end px-5 pt-8 pb-2">
        {turns.length > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground">
            {turns.length} {turns.length === 1 ? "turn" : "turns"}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-4">
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No events</p>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, i) => (
              <div key={turn.user?.id ?? `turn-${i}`} className="space-y-2">
                <StepList
                  label={`${turn.inputDetails.length} ${turn.inputDetails.length === 1 ? "system prompt" : "system prompts"}`}
                  steps={turn.inputDetails}
                  selectedEventId={selectedEventId}
                  onSelectEvent={onSelectEvent}
                />

                {turn.user && (
                  <div className="flex justify-end" data-event-id={turn.user!.id}>
                    <div
                      onClick={() => onSelectEvent(turn.user!.id)}
                      className={`
                        max-w-[70%] rounded-2xl px-4 py-3 cursor-pointer transition-all
                        bg-primary text-on-primary rounded-br-md
                        hover:shadow-md
                        ${turn.user!.id === selectedEventId ? "ring-2 ring-ring ring-offset-2" : ""}
                      `}
                    >
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {turn.user!.content || "(empty)"}
                      </div>
                      {turn.user!.timestamp && (
                        <div className="text-[10px] mt-2 opacity-50">
                          {new Date(turn.user!.timestamp).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <StepList
                  label={`${turn.outputDetails.length} ${turn.outputDetails.length === 1 ? "step" : "steps"}`}
                  steps={turn.outputDetails}
                  selectedEventId={selectedEventId}
                  onSelectEvent={onSelectEvent}
                />

                {turn.assistant && (
                  <div className="flex justify-start" data-event-id={turn.assistant!.id}>
                    <div
                      onClick={() => onSelectEvent(turn.assistant!.id)}
                      className={`
                        max-w-[70%] rounded-2xl px-4 py-3 cursor-pointer transition-all
                        bg-muted text-foreground rounded-bl-md
                        hover:shadow-md
                        ${turn.assistant!.id === selectedEventId ? "ring-2 ring-ring ring-offset-2" : ""}
                      `}
                    >
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {turn.assistant!.content || "(empty)"}
                      </div>
                      {turn.assistant!.timestamp && (
                        <div className="text-[10px] mt-2 opacity-50">
                          {new Date(turn.assistant!.timestamp).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
