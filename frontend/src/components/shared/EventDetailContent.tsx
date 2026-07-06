import { useTranslation } from "react-i18next";
import type { EventRow, TokenUsage } from "../../ipc/types";
import { buildEventMetadataCards } from "../../lib/event-metadata-cards";
import { MarkdownContent } from "./MarkdownContent";

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function formatDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = ((ms % 60_000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

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
  const cards = buildEventMetadataCards({ event });
  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => (
        <MetaCard key={`${card.label}:${card.value}`} label={card.label} value={card.value} />
      ))}
    </div>
  );
}

// ── Content renderer by role/kind ────────────────────────

function isHookEvent(event: EventRow): boolean {
  const meta = parseRecord(event.metadata);
  return stringOrNull(meta.claude_event_type) === "hook";
}

export function ContentRenderer({ event }: { event: EventRow }) {
  const { role, kind, content, content_preview } = event;
  const displayContent = content ?? content_preview;

  if (kind === "tool_call") return <ToolCallContent event={event} />;
  if (kind === "tool_output") return <ToolOutputContent event={event} />;
  if (kind === "tool_event") return <ToolEventContent event={event} />;
  if (isHookEvent(event)) return <HookEventContent event={event} />;
  if (!displayContent) return null;
  if (role === "user") return <PlainContent content={displayContent} />;
  if (role === "assistant" || kind.includes("assistant"))
    return <MarkdownContent content={displayContent} />;
  return <PlainContent content={displayContent} />;
}

// ── Token usage ─────────────────────────────────────────

export function TokenUsageSection({ event }: { event: EventRow }) {
  const { t } = useTranslation();
  const usage = readEventUsage(event);
  if (!usage) return null;
  const primaryLabel = usage.is_claude_code ? t("detail.thisResponse") : t("detail.lastCall");

  return (
    <section className="rounded-md border border-border bg-card overflow-hidden">
      <div className="px-3.5 py-2 border-b border-border">
        <div className="text-xs font-semibold text-card-foreground">
          {t("detail.tokenUsage")}
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-3 p-3.5 ${usage.is_claude_code ? "" : "sm:grid-cols-2"}`}>
        <TokenUsageCard label={primaryLabel} usage={usage.last_token_usage} />
        {!usage.is_claude_code && (
          <TokenUsageCard label={t("detail.sessionTotal")} usage={usage.total_token_usage} />
        )}
      </div>
    </section>
  );
}

function TokenUsageCard({ label, usage }: { label: string; usage: TokenUsage }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
        {label}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {tokenUsageRows(usage, t).map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-semibold text-card-foreground tabular-nums">
              {formatTokenValue(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function tokenUsageRows(usage: TokenUsage, t: (key: string) => string): Array<{ label: string; value: number }> {
  return [
    { label: t("detail.input"), value: usage.input_tokens },
    { label: t("detail.output"), value: usage.output_tokens },
    { label: t("detail.reasoning"), value: usage.reasoning_output_tokens },
    { label: t("detail.cached"), value: usage.cached_input_tokens },
    { label: t("detail.total"), value: usage.total_tokens },
  ];
}

function readEventUsage(event: EventRow): {
  last_token_usage: TokenUsage;
  total_token_usage: TokenUsage;
  is_claude_code: boolean;
} | null {
  if (!isAiReplyEvent(event)) return null;
  const meta = parseRecord(event.metadata);
  const usage = parseRecord(meta.usage);
  const totalUsage = readTokenUsage(usage.total_token_usage) ?? readTokenUsage(usage);
  if (!totalUsage) return null;
  const lastUsage = readTokenUsage(usage.last_token_usage) ?? emptyTokenUsage();
  return {
    last_token_usage: lastUsage,
    total_token_usage: totalUsage,
    is_claude_code: stringOrNull(meta.claude_event_type) !== null,
  };
}

function isAiReplyEvent(event: EventRow): boolean {
  return event.role === "assistant"
    || event.kind === "assistant_output"
    || event.kind === "assistant_update";
}

function readTokenUsage(value: unknown): TokenUsage | null {
  const data = parseRecord(value);
  const input = numberOrNull(data.input_tokens);
  const output = numberOrNull(data.output_tokens);
  const reasoning = numberOrNull(data.reasoning_output_tokens ?? data.reasoning_tokens);
  const cached = numberOrNull(data.cached_input_tokens);
  const total = numberOrNull(data.total_tokens);
  if (input === null && output === null && reasoning === null && cached === null && total === null) {
    return null;
  }
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    reasoning_output_tokens: reasoning ?? 0,
    cached_input_tokens: cached ?? 0,
    total_tokens: total ?? (input ?? 0) + (output ?? 0),
  };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyTokenUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
  };
}

function formatTokenValue(value: number): string {
  return value.toLocaleString("en-US");
}

function PlainContent({ content }: { content: string }) {
  return (
    <pre className="rounded-md bg-muted border border-border p-3.5 text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto leading-relaxed">
      {content}
    </pre>
  );
}

function tryParseOutput(content: string): { fields: Record<string, string>; body: string | null } | null {
  // 1) Try JSON first — handles bare objects, arrays, and double-encoded strings.
  try {
    let parsed: unknown = JSON.parse(content);
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { /* single string */ }
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        fields[k] = valueToString(v);
      }
      return { fields, body: null };
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const texts: string[] = [];
      for (const item of parsed) {
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          texts.push(item.text);
        }
      }
      if (texts.length > 0) return { fields: { output: texts.join("\n") }, body: null };
      // Non-text arrays: show as JSON
      return { fields: { result: JSON.stringify(parsed, null, 2) }, body: null };
    }
    // Parsed value is a primitive (number, boolean, etc.)
    if (parsed !== null && parsed !== undefined) {
      return { fields: { value: String(parsed) }, body: null };
    }
  } catch { /* not valid JSON */ }

  // 2) Text-based key-value header followed by "Output:\n<body>".
  // 87.8% of tool_output events use this format:
  //   Chunk ID: e15c06
  //   Wall time: 0.0000 seconds
  //   Output:
  //   <actual body text>
  const outputSplit = splitAtLastOutputMarker(content);
  const headerText = outputSplit ? outputSplit[0] : content;
  const bodyText = outputSplit ? outputSplit[1] : null;

  const fields: Record<string, string> = {};
  const headerLines = headerText.split("\n");
  let pendingKey: string | null = null;

  for (const line of headerLines) {
    const match = line.match(/^([A-Za-z][\w\s]*?):\s*(.*)/);
    if (match) {
      if (pendingKey) fields[pendingKey] = fields[pendingKey]?.trimEnd() || "";
      pendingKey = null;
      const key = match[1].trim();
      const val = match[2].trim();
      if (val) fields[key] = val;
      else pendingKey = key; // multi-line value possible (rare)
    } else if (pendingKey) {
      fields[pendingKey] = (fields[pendingKey] || "") + line + "\n";
    }
  }
  if (pendingKey) fields[pendingKey] = (fields[pendingKey] || "").trimEnd() || "";

  const body = bodyText?.trim() || null;
  if (Object.keys(fields).length > 0) return { fields, body };
  if (body) return { fields: {}, body };
  return null;
}

/** Split content at the last "Output:\n" marker. Returns [header, body] or null. */
function splitAtLastOutputMarker(content: string): [string, string] | null {
  // Find the last occurrence of a line that is exactly "Output:" (followed by \n or end)
  const idx = content.lastIndexOf("\nOutput:\n");
  if (idx !== -1) {
    return [content.slice(0, idx), content.slice(idx + 9)]; // 9 = "\nOutput:\n".length
  }
  // Content starts with "Output:\n"
  if (content.startsWith("Output:\n")) {
    return ["Output:", content.slice(8)];
  }
  return null;
}

function ToolOutputContent({ event }: { event: EventRow }) {
  const { t } = useTranslation();
  const { content } = event;

  if (!content) return null;

  const parsed = tryParseOutput(content);

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
          className="text-emerald-500 shrink-0"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="text-xs font-semibold text-card-foreground">
          {t("detail.output")}
        </span>
      </div>
      {parsed ? (
        <>
          <div className="p-3.5 space-y-1.5">
            {Object.entries(parsed.fields).map(([key, val]) => (
              <div key={key} className="flex gap-2 text-xs">
                <span className="text-muted-foreground font-medium shrink-0">
                  {key}:
                </span>
                <span className="text-card-foreground font-mono break-all">
                  {val}
                </span>
              </div>
            ))}
          </div>
          {parsed.body && (
            <pre className="text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed p-3.5 border-t border-border">
              {parsed.body}
            </pre>
          )}
        </>
      ) : (
        <pre className="text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed p-3.5">
          {content}
        </pre>
      )}
    </div>
  );
}

function valueToString(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function ToolEventContent({ event }: { event: EventRow }) {
  const { t } = useTranslation();
  const { metadata } = event;
  const meta = parseRecord(metadata);

  const toolName = stringOrNull(meta.tool_name) ?? stringOrNull(meta.name);
  const server = stringOrNull(meta.server);
  const status = stringOrNull(meta.status);
  const durMs = typeof meta.duration_ms === "number" ? meta.duration_ms : null;
  const invocation = typeof meta.invocation === "object" && meta.invocation !== null
    ? (meta.invocation as Record<string, unknown>)
    : null;

  // Flatten important info into one continuous list of key-value rows.
  // Omit call_id (internal detail); omit raw output (available in Show Detail).
  const rows: Array<[string, string]> = [];
  if (server) rows.push(["server", server]);
  if (toolName) rows.push(["tool", toolName]);
  if (durMs !== null) rows.push(["duration", formatDur(durMs)]);
  if (status) rows.push(["status", status]);

  // Flatten invocation input args into the same row block, like ToolCallContent
  const invInput = invocation?.input ?? invocation?.arguments ?? invocation?.args;
  if (typeof invInput === "object" && invInput !== null && !Array.isArray(invInput)) {
    for (const [k, v] of Object.entries(invInput as Record<string, unknown>)) {
      rows.push([k, valueToString(v)]);
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
          {toolName || t("detail.mcpToolCall")}
        </span>
      </div>
      <div className="p-3.5 space-y-1.5">
        {rows.map(([key, val]) => (
          <div key={key} className="flex gap-2 text-xs">
            <span className="text-muted-foreground font-medium shrink-0">
              {key}:
            </span>
            <span className="text-card-foreground font-mono break-all">
              {val}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HookEventContent({ event }: { event: EventRow }) {
  const meta = parseRecord(event.metadata);

  const hookName = stringOrNull(meta.hook_name);
  const command = stringOrNull(meta.command);
  const status = stringOrNull(meta.status);
  const decision = stringOrNull(meta.decision);
  const message = stringOrNull(meta.message);
  const exitCode = typeof meta.exit_code === "number" ? String(meta.exit_code) : null;
  const durMs = typeof meta.duration_ms === "number" ? meta.duration_ms : null;
  const stdoutText = stringOrNull(meta.stdout);
  const stderrText = stringOrNull(meta.stderr);

  // Key-value rows in importance order; only present fields render.
  const rows: Array<[string, string]> = [];
  if (command) rows.push(["command", command]);
  if (status) rows.push(["status", status]);
  if (decision) rows.push(["decision", decision]);
  if (message)
    rows.push([
      "message",
      message.length > 200 ? message.slice(0, 200) + "…" : message,
    ]);
  if (exitCode !== null) rows.push(["exit code", exitCode]);
  if (durMs !== null) rows.push(["duration", formatDur(durMs)]);

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
          {hookName || "Hook"}
        </span>
      </div>
      {rows.length > 0 && (
        <div className="p-3.5 space-y-1.5">
          {rows.map(([key, val]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="text-muted-foreground font-medium shrink-0">
                {key}:
              </span>
              <span className="text-card-foreground font-mono break-all">
                {val}
              </span>
            </div>
          ))}
        </div>
      )}
      {stdoutText && (
        <div className="p-3.5 border-t border-border space-y-1.5">
          <div className="text-xs text-muted-foreground font-medium">stdout</div>
          <pre className="text-xs text-card-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed">
            {stdoutText}
          </pre>
        </div>
      )}
      {stderrText && (
        <div className="p-3.5 border-t border-border space-y-1.5">
          <div className="text-xs text-red-500 font-medium">stderr</div>
          <pre className="text-xs text-red-500 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed">
            {stderrText}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCallContent({ event }: { event: EventRow }) {
  const { t } = useTranslation();
  const { content, metadata } = event;
  let toolName = "";
  let toolArgs: Record<string, unknown> | null = null;

  // Parse metadata first (Claude Code args are in metadata.args as JSON string)
  const meta = (() => {
    if (!metadata) return null;
    if (typeof metadata === "string") {
      try { return JSON.parse(metadata); } catch { return null; }
    }
    return metadata as Record<string, unknown>;
  })();

  // Parse toolName from content (Codex/OpenAI format: JSON with name/function.name)
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

  // Fallback: read toolName from metadata
  if (!toolName && meta) {
    toolName = (meta.name ?? meta.function?.name ?? meta.tool ?? "") as string;
  }

  // Always try to read toolArgs from metadata (Claude Code args are JSON string)
  if (!toolArgs && meta) {
    const rawArgs = meta.arguments ?? meta.parameters ?? meta.input ?? meta.args;
    if (typeof rawArgs === "string") {
      try { toolArgs = JSON.parse(rawArgs); } catch { toolArgs = { raw: rawArgs }; }
    } else if (typeof rawArgs === "object" && rawArgs !== null) {
      toolArgs = rawArgs as Record<string, unknown>;
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
          {toolName || t("detail.toolCall")}
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
  const { t } = useTranslation();
  const parsed = parseMetadata(metadata);

  // Show Detail displays the original JSONL line for this event, not the
  // parser-built metadata. Claude Code stores that line as `source_raw_text`;
  // Codex/detail fallbacks may still use `raw_text`.
  const rawText = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (
      (parsed as Record<string, unknown>).source_raw_text
      ?? (parsed as Record<string, unknown>).raw_text
    )
    : null;
  const displayValue: unknown =
    typeof rawText === "string" && rawText.length > 0 ? rawText : parsed;

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
        {label ?? t("detail.showDetail")}
        {sourceLineNo != null && (
          <span className="text-muted-foreground font-normal ml-1">
            {t("detail.jsonlLine", { lineNo: sourceLineNo })}
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
