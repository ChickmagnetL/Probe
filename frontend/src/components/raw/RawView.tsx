import { useEffect, useRef, useState, useCallback, memo } from "react";
import { VariableSizeList as VirtualList } from "react-window";
import { invoke } from "../../ipc/invoke";
import { useSessionStore } from "../../stores/session";

// ── Types ──────────────────────────────────────────────

interface RawLine {
  lineNo: number;
  text: string;
  formatted: string;
  eventId: string | null;
}

// ── Helpers ────────────────────────────────────────────

const LINE_THRESHOLD = 200;

const CHAR_WIDTH = 7.2; // approximate for 12px monospace (fallback only)
const LINE_HEIGHT = 12 * 1.55; // 12px font * 1.55 leading (fallback only)
const BORDER_HEIGHT = 1; // border-b on row container

const TYPE_BADGE_STYLES: Record<string, { bg: string; fg: string }> = {
  session_meta: { bg: "#CFFAFE", fg: "#155E75" },
  turn_context: { bg: "#E0F2FE", fg: "#0369A1" },
  task_started: { bg: "#D1FAE5", fg: "#065F46" },
  user_msg: { bg: "#DBEAFE", fg: "#1D4ED8" },
  developer_msg: { bg: "#FEF3C7", fg: "#92400E" },
  assistant_msg: { bg: "#D1FAE5", fg: "#065F46" },
  agent_message: { bg: "#D1FAE5", fg: "#065F46" },
  user_message: { bg: "#DBEAFE", fg: "#1D4ED8" },
  token_count: { bg: "#F1F5F9", fg: "#475569" },
  reasoning: { bg: "#EDE9FE", fg: "#5B21B6" },
  tool_call: { bg: "#FEF3C7", fg: "#92400E" },
  tool_output: { bg: "#EDE9FE", fg: "#5B21B6" },
  exec_command_end: { bg: "#F1F5F9", fg: "#475569" },
};

function getTypeLabel(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "unknown";
  const record = obj as Record<string, unknown>;
  const t = record.type;
  if (typeof t !== "string") return "unknown";
  if (t === "session_meta") return "session_meta";
  if (t === "turn_context") return "turn_context";
  if (t === "event_msg") {
    const payload = record.payload as Record<string, unknown> | undefined;
    return (typeof payload?.type === "string" ? payload.type : "event_msg") as string;
  }
  if (t === "response_item") {
    const payload = record.payload as Record<string, unknown> | undefined;
    const rt = typeof payload?.type === "string" ? payload.type : "response";
    if (rt === "message") {
      const role = typeof payload?.role === "string" ? payload.role : "";
      return `${role}_msg`;
    }
    if (rt === "reasoning") return "reasoning";
    if (rt === "function_call") return "tool_call";
    if (rt === "function_call_output") return "tool_output";
    return rt as string;
  }
  return t;
}

function formatJSON(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

// ── Single raw line (memo for perf) ────────────────────

interface RawLineItemProps {
  line: RawLine;
  isSelected: boolean;
  onClick: (eventId: string) => void;
  style?: React.CSSProperties;
}

const RawLineItem = memo(function RawLineItem({
  line,
  isSelected,
  onClick,
  style,
}: RawLineItemProps) {
  return (
    <div
      className={`border-b border-border/50 cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/[0.06] border-l-2 border-l-primary/40"
          : line.eventId
            ? "border-l-2 border-l-primary/20 hover:bg-accent/30"
            : "hover:bg-accent/30"
      }`}
      style={style}
      onClick={() => {
        if (line.eventId) onClick(line.eventId);
      }}
    >
      <div className="flex items-center gap-2 pr-4 pt-1.5">
        <span
          className={`w-10 text-right pr-3 text-[11px] select-none shrink-0 ${
            isSelected ? "text-primary font-semibold" : "text-muted-foreground"
          }`}
        >
          {line.lineNo}
        </span>
        {line.eventId && <TypeBadge label={getTypeBadgeLabel(line.text)} />}
      </div>
      <pre className="px-4 pl-[52px] pb-2 pt-1 whitespace-pre-wrap overflow-x-hidden text-[12px] leading-[1.55] text-secondary-foreground" style={{ wordBreak: "break-word" }}>
        {line.formatted}
      </pre>
    </div>
  );
});

function getTypeBadgeLabel(rawText: string): string {
  try {
    const obj = JSON.parse(rawText);
    return getTypeLabel(obj);
  } catch {
    return "unknown";
  }
}

function TypeBadge({ label }: { label: string }) {
  const style = TYPE_BADGE_STYLES[label] ?? { bg: "#F1F5F9", fg: "#64748B" };
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-px rounded whitespace-nowrap"
      style={{ background: style.bg, color: style.fg }}
    >
      {label}
    </span>
  );
}

// ── Virtualized row ────────────────────────────────────

interface VirtualRowProps {
  index: number;
  data: { lines: RawLine[]; selectedEventId: string | null; onSelect: (id: string) => void };
  style: React.CSSProperties;
}

function VirtualRow({ index, data, style }: VirtualRowProps) {
  const { lines, selectedEventId, onSelect } = data;
  const line = lines[index];
  return (
    <RawLineItem
      line={line}
      isSelected={line.eventId === selectedEventId}
      onClick={onSelect}
      style={style}
    />
  );
}

// ── Main component ─────────────────────────────────────

export function RawView() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const detail = useSessionStore((s) => s.detail);
  const selectedEventId = useSessionStore((s) => s.selectedEventId);
  const selectEvent = useSessionStore((s) => s.selectEvent);

  const [rawContent, setRawContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<VirtualList>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const preMeasureRef = useRef<HTMLPreElement | null>(null);
  const headerHeightRef = useRef<number>(20);
  const heightCacheRef = useRef<Map<string, number>>(new Map());
  const lastMeasureWidthRef = useRef<number>(0);

  // Measure container for accurate row height calculation
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Create off-screen measurement elements for accurate row height calculation
  useEffect(() => {
    const pre = document.createElement("pre");
    Object.assign(pre.style, {
      position: "absolute",
      visibility: "hidden",
      pointerEvents: "none",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflowWrap: "break-word",
      overflowX: "hidden",
      margin: "0",
      padding: "4px 16px 8px 52px",
      fontSize: "12px",
      lineHeight: "1.55",
      fontFamily: "monospace",
      boxSizing: "border-box",
    });
    document.body.appendChild(pre);
    preMeasureRef.current = pre;

    // Measure header height once (matches the flex row with line number + badge)
    const headerDiv = document.createElement("div");
    Object.assign(headerDiv.style, {
      position: "absolute",
      visibility: "hidden",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      paddingRight: "16px",
      paddingTop: "6px",
    });
    const span = document.createElement("span");
    Object.assign(span.style, {
      width: "40px",
      textAlign: "right",
      paddingRight: "12px",
      fontSize: "11px",
    });
    span.textContent = "999";
    headerDiv.appendChild(span);
    document.body.appendChild(headerDiv);
    headerHeightRef.current = headerDiv.scrollHeight;
    headerDiv.remove();

    return () => {
      pre.remove();
    };
  }, []);

  // Clear height measurement cache when container width changes (different width = different wrapping)
  useEffect(() => {
    if (containerSize.width !== lastMeasureWidthRef.current) {
      heightCacheRef.current.clear();
      lastMeasureWidthRef.current = containerSize.width;
      virtualListRef.current?.resetAfterIndex(0);
    }
  }, [containerSize.width]);

  // Measure the actual rendered height of a row's text content
  const measureRowHeight = useCallback(
    (text: string, containerWidth: number): number => {
      const headerH = headerHeightRef.current;
      const pre = preMeasureRef.current;

      if (!pre || containerWidth <= 0) {
        // Fallback estimation when measurement div is not available
        const textWidth = containerWidth - 68;
        const charsPerLine = Math.max(1, Math.floor(textWidth / CHAR_WIDTH));
        const wrapLines = Math.max(1, Math.ceil(text.length / charsPerLine));
        return BORDER_HEIGHT + headerH + 4 + wrapLines * LINE_HEIGHT + 8;
      }

      const cacheKey = `${containerWidth}|${text}`;
      const cached = heightCacheRef.current.get(cacheKey);
      if (cached !== undefined) return cached;

      pre.style.width = `${containerWidth}px`;
      pre.textContent = text;
      const preHeight = pre.scrollHeight;
      const total = BORDER_HEIGHT + headerH + preHeight;

      if (heightCacheRef.current.size > 2000) heightCacheRef.current.clear();
      heightCacheRef.current.set(cacheKey, total);

      return total;
    },
    [],
  );

  // Build lines from raw content
  const lines: RawLine[] = rawContent
    ? rawContent
        .split("\n")
        .filter((l) => l.length > 0)
        .map((text, i) => ({
          lineNo: i + 1,
          text,
          formatted: formatJSON(text),
          eventId: null as string | null,
        }))
    : [];

  // Build lineNo -> eventId map from detail.events
  const lineEventMap = new Map<number, string>();
  if (detail?.events) {
    for (const ev of detail.events) {
      if (ev.source_line_no != null && !lineEventMap.has(ev.source_line_no)) {
        lineEventMap.set(ev.source_line_no, ev.id);
      }
    }
  }

  // Attach event IDs to lines
  for (const line of lines) {
    const eventId = lineEventMap.get(line.lineNo);
    if (eventId) line.eventId = eventId;
  }

  const useVirtualization = lines.length > LINE_THRESHOLD;

  // Fetch raw content on mount / session change
  useEffect(() => {
    if (!activeSessionId) {
      setRawContent(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRawContent(null);

    invoke
      .readRawFile(activeSessionId)
      .then((content) => {
        if (!cancelled) {
          setRawContent(content);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : String(e);
          setError(msg);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  // Scroll to selected line
  useEffect(() => {
    if (selectedEventId == null) return;

    const line = lines.find((l) => l.eventId === selectedEventId);
    if (!line) return;

    const idx = lines.indexOf(line);

    if (useVirtualization && virtualListRef.current) {
      virtualListRef.current.scrollToItem(idx, "center");
    } else {
      const container = scrollContainerRef.current;
      const el = lineRefs.current.get(line.lineNo);
      if (container && el) {
        // Use manual scrollTop instead of scrollIntoView to prevent scroll bleed.
        // scrollIntoView scrolls ALL ancestors (even overflow:hidden), causing
        // the entire page to shift. Manual scrollTop scopes the scroll to this container only.
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const relativeTop = elRect.top - containerRect.top;
        const containerHeight = container.clientHeight;
        const elHeight = el.offsetHeight;
        const targetScrollTop =
          container.scrollTop + relativeTop - (containerHeight - elHeight) / 2;
        container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      }
    }
  }, [selectedEventId, lines, useVirtualization]);

  const handleSelect = useCallback(
    (eventId: string) => {
      selectEvent(eventId);
    },
    [selectEvent],
  );

  // ── Edge states ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm px-6 text-center">
        Could not read source file: {error}
      </div>
    );
  }

  if (!rawContent || lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No source file available for this session
      </div>
    );
  }

  // ── Render ──
  if (useVirtualization) {
    const getItemSize = (index: number) => {
      const line = lines[index];
      return measureRowHeight(line.formatted, containerSize.width);
    };

    return (
      <div ref={scrollContainerRef} className="h-full overflow-hidden">
        <VirtualList
          ref={virtualListRef}
          height={containerSize.height}
          itemCount={lines.length}
          itemSize={getItemSize}
          width="100%"
          itemData={{ lines, selectedEventId, onSelect: handleSelect }}
        >
          {VirtualRow}
        </VirtualList>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto">
      {lines.map((line) => (
        <div
          key={line.lineNo}
          ref={(el) => {
            if (el) lineRefs.current.set(line.lineNo, el);
            else lineRefs.current.delete(line.lineNo);
          }}
        >
          <RawLineItem
            line={line}
            isSelected={line.eventId === selectedEventId}
            onClick={handleSelect}
          />
        </div>
      ))}
    </div>
  );
}
