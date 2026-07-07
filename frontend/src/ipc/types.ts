export interface IpcError {
  code: string;
  message: string;
}

export interface AppInfo {
  version: string;
  name: string;
}

export interface UpdateInfo {
  current_version: string;
  version: string;
  notes: string | null;
  pub_date: string | null;
}

export type SessionPlatform = "codex_cli" | "claude_code";
export type AppearanceMode = "system" | "light" | "dark";

export type UpdateStatus =
  | "checking"
  | "up-to-date"
  | "update-available"
  | "downloading"
  | "ready-to-restart"
  | "error";

// ── Import ──────────────────────────────────────────────

export interface ImportResult {
  total_files: number;
  parsed_records: number;
  parse_errors: number;
  unknown_record_count: number;
  unknown_route_keys: string[];
  imported_session_count: number;
  root_session_count: number;
  sessions: SessionSummary[];
  root_sessions: SessionSummary[];
  table_counts: Record<string, number>;
  record_type_counts?: Record<string, number>;
  payload_type_counts?: Record<string, number>;
  reserved_route_counts?: Record<string, number>;
  unknown_route_counts?: Record<string, number>;
}

export interface SessionMetrics {
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_output_tokens: number;
  total_cached_input_tokens: number;
  total_tokens: number;
  last_input_tokens: number;
  last_output_tokens: number;
  last_reasoning_output_tokens: number;
  last_cached_input_tokens: number;
  last_total_tokens: number;
  node_count: number;
  display_node_count: number;
  session_count: number;
  imported_file_count: number;
  elapsed_sec: number;
  task_elapsed_sec: number | null;
  start_time: string | null;
  end_time: string | null;
}

export interface SessionSummary {
  session_id: string;
  platform: SessionPlatform;
  short_id: string;
  display_name: string;
  source_path: string | null;
  file_name: string | null;
  source_label: string;
  parent_session_id: string | null;
  is_subagent: boolean;
  is_synthetic: boolean;
  agent_nickname: string | null;
  agent_role: string | null;
  cli_version: string | null;
  start_time: string | null;
  end_time: string | null;
  cwd: string | null;
  title: string | null;
  own_metrics: SessionMetrics;
  metrics: SessionMetrics;
  events: SessionEvent[];
  timeline: SessionEvent[];
  graph_turns: GraphTurn[];
  child_sessions: SessionSummary[];
}

export interface GraphTurn {
  turn_id: string;
  input: SessionEvent | null;
  input_details: SessionEvent[];
  output: SessionEvent | null;
  output_details: SessionEvent[];
}

// ── Session detail (from SQLite) ────────────────────────

export interface SessionDetail {
  session: SessionRow;
  events: EventRow[];
  children: ChildSessionDetail[];
}

export interface ChildSessionDetail extends SessionRow {
  events: EventRow[];
  children?: ChildSessionDetail[];
}

export interface SessionRow {
  id: string;
  platform: SessionPlatform;
  source_path: string | null;
  file_name: string | null;
  parent_session_id: string | null;
  is_subagent: number;
  agent_nickname: string | null;
  agent_role: string | null;
  start_time: string | null;
  end_time: string | null;
  imported_at: string;
  title: string | null;
  cwd: string | null;
}

export interface EventRow {
  id: string;
  session_id: string;
  kind: string;
  timestamp: string | null;
  role: string | null;
  phase: string | null;
  content: string | null;
  content_preview?: string | null;
  metadata: string | Record<string, unknown> | null;
  source_line_no: number | null;
}

// ── Session event (from build_summary) ──────────────────

export interface SessionEvent {
  event_id: string;
  session_id: string;
  timestamp: string | null;
  kind: string;
  role?: string;
  phase?: string;
  title?: string;
  summary?: string;
  content?: string | null;
  content_parts?: unknown[];
  content_label?: string;
  intro?: string;
  estimated_input_tokens?: number;
  detail_note?: string;
  args?: string;
  usage?: UsageBadge;
  // graph turn extras
  prompt_preview?: string;
  child_session_id?: string;
  // input detail extras
  raw_record_id?: string;
  source_path?: string;
  source_line_no?: number;
  raw_text?: string;
  source_record?: Record<string, unknown> | null;
  event_type?: string;
  extracted_fields?: unknown[];
  extra_fields?: Record<string, unknown>;
}

export interface UsageBadge {
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  last_token_usage: TokenUsage;
  total_token_usage: TokenUsage;
  label: string;
  note: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
}

// ── IPC params ──────────────────────────────────────────

export interface ListSessionsParams {
  filter?: string;
  platform?: SessionPlatform;
  sort?: string;
  sort_order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface ListSessionsResult {
  sessions: SessionRow[];
  total: number;
}

// ── Settings (engine KV store) ─────────────────────────

export interface Settings {
  /** Configured Codex CLI sessions root path (may be absent). */
  codex_path?: string;
  /** OS-default Codex path, present when the engine can infer one. */
  default_codex_path?: string;
  /** Configured Claude Code sessions root path (may be absent). */
  claude_path?: string;
  /** OS-default Claude path, present when the engine can infer one. */
  default_claude_path?: string;
  /** Persisted platform filter for the session library. */
  active_platform?: SessionPlatform;
  /** Persisted interface appearance preference. */
  appearance_mode?: AppearanceMode;
  /** Persisted interface language code (e.g. "en", "zh"). */
  interface_language?: string;
  /** Whether to auto-scan and import sessions on startup (default true). */
  auto_sync?: boolean;
  [key: string]: string | boolean | undefined;
}

export interface SetSettingsParams {
  key: string;
  value: string | number | boolean;
}

export interface ImportFilesParams {
  input_path: string;
  platform?: SessionPlatform;
}

export interface ScanSessionsParams {
  path: string;
  platform: SessionPlatform;
}

export interface ImportFilesBatchParams {
  file_paths: string[];
  platform?: SessionPlatform;
}

// ── Incremental scan / batch import ────────────────────

export interface PendingFile {
  path: string;
  mtime: number;
  size: number;
}

export interface ScanResult {
  total: number;
  pending: PendingFile[];
  pending_count: number;
  skipped: number;
}

export interface ImportBatchResult {
  /** Number of files parsed in this batch (drives the progress bar numerator). */
  parsed_files: number;
  imported_session_count: number;
  root_session_count: number;
  sessions_count: number;
  sessions: SessionSummary[];
  root_sessions: SessionSummary[];
  parsed_records: number;
  parse_errors: number;
  unknown_record_count: number;
  unknown_route_keys: string[];
  table_counts: Record<string, number>;
  errors: { path: string; message: string }[];
}
