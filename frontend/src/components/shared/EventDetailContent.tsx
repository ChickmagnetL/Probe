import type { EventRow } from "../../ipc/types";
import { formatTime } from "../../lib/format";
import { kindLabel } from "../graph/graph-labels";

// ── MetaCard ─────────────────────────────────────────────

export function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 transition-colors hover:border-muted-foreground">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      <div className="text-xs font-semibold text-card-foreground truncate">
        {value}
      </div>
    </div>
  );
}

// ── MetaCardsGrid ────────────────────────────────────────

export function MetaCardsGrid({ event }: { event: EventRow }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MetaCard label="Role" value={event.role ?? "-"} />
      <MetaCard label="Kind" value={kindLabel(event.kind)} />
      <MetaCard
        label="Time"
        value={event.timestamp ? formatTime(event.timestamp) : "-"}
      />
      {event.phase && <MetaCard label="Phase" value={event.phase} />}
    </div>
  );
}

// ── Content renderer by role/kind ────────────────────────

export function ContentRenderer({ event }: { event: EventRow }) {
  const { role, kind, content } = event;
  if (!content) return null;

  if (kind === "tool_call") return <ToolCallContent event={event} />;
  if (kind === "tool_output") return <ToolOutputContent content={content} />;
  if (role === "user") return <PlainContent content={content} />;
  if (role === "assistant" || kind.includes("assistant"))
    return <MarkdownContent content={content} />;
  return <PlainContent content={content} />;
}

function PlainContent({ content }: { content: string }) {
  return (
    <pre className="rounded-md bg-muted border border-border p-3.5 text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto leading-relaxed">
      {content}
    </pre>
  );
}

function ToolOutputContent({ content }: { content: string }) {
  return (
    <pre className="rounded-md bg-muted border border-border p-3.5 text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed">
      {content}
    </pre>
  );
}

function ToolCallContent({ event }: { event: EventRow }) {
  const { content, metadata } = event;
  let toolName = "";
  let toolArgs: Record<string, unknown> | null = null;

  if (content) {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) {
        toolName =
          parsed.name ?? parsed.function?.name ?? parsed.tool ?? "";
        toolArgs =
          parsed.arguments ?? parsed.parameters ?? parsed.input ?? null;
      }
    } catch {
      toolName = content;
    }
  }

  if (!toolName && metadata) {
    try {
      const meta =
        typeof metadata === "string" ? JSON.parse(metadata) : metadata;
      toolName = meta.name ?? meta.function?.name ?? meta.tool ?? "";
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-muted border-b border-border">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent shrink-0"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span className="text-xs font-semibold text-card-foreground">
          {toolName || "Tool Call"}
        </span>
      </div>
      {toolArgs && (
        <div className="p-3.5 space-y-1.5">
          {Object.entries(toolArgs).map(([key, val]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="text-muted-foreground font-medium shrink-0">
                {key}:
              </span>
              <span className="text-card-foreground font-mono break-all">
                {typeof val === "string" ? val : JSON.stringify(val)}
              </span>
            </div>
          ))}
        </div>
      )}
      {!toolArgs && content && (
        <div className="p-3.5">
          <pre className="text-xs text-card-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="rounded-md bg-muted border border-border p-3.5 text-xs text-card-foreground max-h-[400px] overflow-y-auto leading-relaxed [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-card-foreground [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-card-foreground [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-card-foreground [&_p]:mb-2 [&_p]:last:mb-0 [&_strong]:font-semibold [&_em]:italic [&_code]:font-mono [&_code]:bg-card [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-card [&_pre]:border [&_pre]:border-border [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-0.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-2"
      dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }}
    />
  );
}

function simpleMarkdown(md: string): string {
  let html = md;

  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const safe = /^\s*(https?:\/\/|\/|#)/i.test(url) ? url : "#";
    return `<a href="${safe}" target="_blank" rel="noopener">${text}</a>`;
  });

  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  html = html.replace(
    /(?<!<\/?(p|h[1-3]|ul|ol|li|pre|blockquote)>)\n/g,
    "<br>",
  );

  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>\s*(<(?:h[1-3]|ul|ol|pre|blockquote))/g, "$1");
  html = html.replace(
    /(<\/(?:h[1-3]|ul|ol|pre|blockquote)>)\s*<\/p>/g,
    "$1",
  );

  return html;
}

// ── Collapsible metadata section ─────────────────────────

export function MetadataSection({
  metadata,
  sourceLineNo,
  label,
}: {
  metadata: string | Record<string, unknown> | null;
  sourceLineNo?: number | null;
  label?: string;
}) {
  const parsed = parseMetadata(metadata);

  // Extract raw_text (original JSONL line) from metadata
  const rawText =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).raw_text
      : null;

  const displayValue = rawText ?? parsed;

  return (
    <details className="rounded-md border border-border overflow-hidden group">
      <summary className="px-4 py-3 text-xs font-medium text-foreground cursor-pointer flex items-center gap-2 hover:bg-muted transition-colors">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground transition-transform group-open:rotate-90"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {label ?? "Show Detail"}
        {sourceLineNo != null && (
          <span className="text-muted-foreground font-normal ml-1">
            JSONL #{sourceLineNo}
          </span>
        )}
      </summary>
      <div className="border-t border-border px-3.5 py-3">
        <pre className="text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed">
          {formatPayload(displayValue)}
        </pre>
      </div>
    </details>
  );
}

function parseMetadata(
  metadata: string | Record<string, unknown> | null,
): unknown {
  if (!metadata) return null;
  if (typeof metadata !== "string") return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    // Try JSONL (one JSON object per line)
    const lines = metadata.split("\n").filter((l) => l.trim());
    if (lines.length > 1) {
      const parsed = lines.map((line) => {
        try { return JSON.parse(line); } catch { return line; }
      });
      return parsed;
    }
    return metadata;
  }
}

function formatPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    // Try to parse as JSON and pretty-print
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

// ── Merged tool_call + tool_output panel ─────────────────

export function MergedToolCallContent({
  callEvent,
  outputEvent,
}: {
  callEvent: EventRow;
  outputEvent?: EventRow;
}) {
  return (
    <div className="space-y-4">
      {/* Call section */}
      <div className="rounded-md border border-amber-500/20 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 bg-amber-500/5 border-b border-amber-500/15">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="text-amber-500 shrink-0">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            Input
          </span>
        </div>
        <div className="p-3.5">
          <pre className="text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto font-mono leading-relaxed">
            {(() => {
              if (callEvent.metadata) {
                const parsed = typeof callEvent.metadata === "string"
                  ? (() => { try { return JSON.parse(callEvent.metadata); } catch { return null; } })()
                  : callEvent.metadata;
                if (parsed && typeof parsed === "object" && parsed.args) {
                  const args = parsed.args;
                  try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; }
                }
              }
              return callEvent.content ?? "(no input)";
            })()}
          </pre>
        </div>
      </div>
      {callEvent.metadata && (
        <MetadataSection
          metadata={callEvent.metadata}
          sourceLineNo={callEvent.source_line_no}
          label="Call Detail"
        />
      )}

      {/* Connector */}
      <div className="flex justify-center py-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-muted-foreground">
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      </div>

      {/* Output section */}
      {outputEvent ? (
        <>
          <div className="rounded-md border border-emerald-500/20 overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500/5 border-b border-emerald-500/15">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-emerald-500 shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Output
              </span>
            </div>
            <div className="p-3.5">
              <ContentRenderer event={outputEvent} />
            </div>
          </div>
          {outputEvent.metadata && (
            <MetadataSection
              metadata={outputEvent.metadata}
              sourceLineNo={outputEvent.source_line_no}
              label="Output Detail"
            />
          )}
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <span className="text-xs text-muted-foreground">No output recorded</span>
        </div>
      )}
    </div>
  );
}
