/**
 * Browser dev-mock system. Provides an in-memory invoke function
 * that replaces Tauri IPC in browser mode (no __TAURI_INTERNALS__).
 */
import type { JSONDict } from "./lib/parser/models";
import { processFiles } from "./lib/parser/index";
import type {
  ImportResult,
  SessionRow,
  SessionDetail,
  ListSessionsParams,
  EventRow,
  SessionSummary,
  SessionMetrics,
  SessionEvent,
  GraphTurn,
} from "./ipc/types";

// ── In-memory store ─────────────────────────────────────

let currentSummary: JSONDict | null = null;
let rawFileContents: Map<string, string> = new Map();
let pendingFiles: Array<{ path: string; content: string }> = [];

function getSessions(): SessionRow[] {
  if (!currentSummary) return [];
  const sessions = (currentSummary.sessions as JSONDict[]) ?? [];
  return sessions
    .filter((s) => !s.is_synthetic)
    .map(sessionSummaryToRow);
}

function sessionSummaryToRow(s: JSONDict): SessionRow {
  return {
    id: String(s.session_id ?? ""),
    source_path: (s.source_path as string) ?? null,
    file_name: (s.file_name as string) ?? null,
    parent_session_id: (s.parent_session_id as string) ?? null,
    is_subagent: s.is_subagent ? 1 : 0,
    agent_nickname: (s.agent_nickname as string) ?? null,
    agent_role: (s.agent_role as string) ?? null,
    start_time: (s.start_time as string) ?? null,
    end_time: (s.end_time as string) ?? null,
    imported_at: new Date().toISOString(),
  };
}

function getSessionDetail(sessionId: string): SessionDetail | null {
  if (!currentSummary) return null;
  const sessions = (currentSummary.sessions as JSONDict[]) ?? [];
  const target = sessions.find((s) => s.session_id === sessionId);
  if (!target) return null;

  const events = ((target.events as JSONDict[]) ?? []).map(eventToRow);
  const children = ((target.child_sessions as JSONDict[]) ?? [])
    .filter((cs) => !cs.is_synthetic)
    .map(sessionSummaryToRow);

  return {
    session: sessionSummaryToRow(target),
    events,
    children,
  };
}

function eventToRow(e: JSONDict): EventRow {
  return {
    id: String(e.event_id ?? ""),
    session_id: String(e.session_id ?? ""),
    kind: String(e.kind ?? ""),
    timestamp: (e.timestamp as string) ?? null,
    role: (e.role as string) ?? null,
    phase: (e.phase as string) ?? null,
    content: (e.content as string) ?? (e.summary as string) ?? null,
    metadata: e.raw_text ? JSON.stringify({ raw_text: e.raw_text, source_record: e.source_record }) : null,
    source_line_no: typeof e.source_line_no === "number" ? e.source_line_no : null,
  };
}

function buildImportResult(summary: JSONDict): ImportResult {
  return {
    total_files: Number(summary.total_files ?? 0),
    parsed_records: Number(summary.parsed_records ?? 0),
    parse_errors: Number(summary.parse_errors ?? 0),
    imported_session_count: Number(summary.imported_session_count ?? 0),
    root_session_count: Number(summary.root_session_count ?? 0),
    sessions: (summary.sessions as JSONDict[] ?? [])
      .filter((s) => !s.is_synthetic)
      .map(toSessionSummary),
    root_sessions: (summary.root_sessions as JSONDict[] ?? [])
      .map(toSessionSummary),
    table_counts: (summary.table_counts as Record<string, number>) ?? {},
  };
}

function toSessionSummary(s: JSONDict): SessionSummary {
  return {
    session_id: String(s.session_id ?? ""),
    short_id: String(s.short_id ?? ""),
    display_name: String(s.display_name ?? ""),
    source_path: (s.source_path as string) ?? null,
    file_name: (s.file_name as string) ?? null,
    source_label: String(s.source_label ?? ""),
    parent_session_id: (s.parent_session_id as string) ?? null,
    is_subagent: Boolean(s.is_subagent),
    is_synthetic: Boolean(s.is_synthetic),
    agent_nickname: (s.agent_nickname as string) ?? null,
    agent_role: (s.agent_role as string) ?? null,
    start_time: (s.start_time as string) ?? null,
    end_time: (s.end_time as string) ?? null,
    own_metrics: s.own_metrics as SessionMetrics,
    metrics: s.metrics as SessionMetrics,
    events: (s.events as SessionEvent[]) ?? [],
    timeline: (s.timeline as SessionEvent[]) ?? [],
    graph_turns: (s.graph_turns as GraphTurn[]) ?? [],
    child_sessions: (s.child_sessions as SessionSummary[]) ?? [],
  };
}

// ── File input helper ───────────────────────────────────

function openFilePicker(): Promise<Array<{ path: string; content: string }>> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".jsonl";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const files = input.files;
      if (!files || files.length === 0) {
        resolve([]);
        document.body.removeChild(input);
        return;
      }

      const results: Array<{ path: string; content: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();
        results.push({ path: file.name, content });
        rawFileContents.set(file.name, content);
      }
      resolve(results);
      document.body.removeChild(input);
    });

    input.addEventListener("cancel", () => {
      resolve([]);
      document.body.removeChild(input);
    });

    input.click();
  });
}

// ── Load sample helper (for E2E testing) ────────────────

async function loadSample(url: string): Promise<void> {
  const response = await fetch(url);
  const content = await response.text();
  const fileName = url.split("/").pop() ?? "sample.jsonl";
  rawFileContents.set(fileName, content);
  const files = [{ path: fileName, content }];
  currentSummary = processFiles(files);
  window.dispatchEvent(new CustomEvent("dev-mock-updated"));
}

// ── Mock invoke ─────────────────────────────────────────

export async function mockInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const params = (args as Record<string, unknown>) ?? {};

  if (cmd === "engine_call") {
    const method = params.method as string | undefined;
    const methodParams = (params.params as Record<string, unknown>) ?? {};

    switch (method) {
      case "import_files": {
        const files = pendingFiles.length > 0 ? pendingFiles : await openFilePicker();
        pendingFiles = [];
        if (files.length === 0) {
          return { cancelled: true } as T;
        }
        currentSummary = processFiles(files);
        return buildImportResult(currentSummary) as T;
      }

      case "list_sessions": {
        const sessions = getSessions();
        const _params = methodParams as ListSessionsParams;
        let filtered = sessions;
        if (_params.filter) {
          const q = _params.filter.toLowerCase();
          filtered = sessions.filter(
            (s) =>
              s.id.toLowerCase().includes(q) ||
              (s.file_name ?? "").toLowerCase().includes(q) ||
              (s.agent_nickname ?? "").toLowerCase().includes(q),
          );
        }
        return { sessions: filtered as SessionRow[], total: filtered.length } as T;
      }

      case "get_session_detail": {
        const sessionId = methodParams.session_id as string;
        const detail = getSessionDetail(sessionId);
        if (!detail) {
          throw new Error(`Session not found: ${sessionId}`);
        }
        return detail as T;
      }

      case "delete_sessions": {
        return { deleted_sessions: 0, deleted_files: 0 } as T;
      }
    }
  }

  if (cmd === "open_file_dialog") {
    const files = await openFilePicker();
    if (files.length > 0) {
      pendingFiles = files;
      return files[0].path as T;
    }
    return null as T;
  }

  throw new Error(`Unknown IPC command: ${cmd}`);
}

// ── Setup ───────────────────────────────────────────────

export function installDevMock(): void {
  window.__DEV_MOCK__ = { loadSample };
}

// ── Type augmentation ───────────────────────────────────

declare global {
  interface Window {
    __DEV_MOCK__?: {
      loadSample: (url: string) => Promise<void>;
    };
  }
}
