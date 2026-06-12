export interface IpcError {
  code: string;
  message: string;
}

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
  debug_basket?: DebugBasket;
}

export interface DebugBasket {
  extracted_fields: DebugBasketGroup[];
  residual_fields: DebugBasketGroup[];
  unknown_routes: DebugBasketUnknownRoute[];
  residual_field_count: number;
  unknown_record_count: number;
}

export interface DebugBasketGroup {
  route_key: string;
  table_name: string;
  count: number;
  keys: string[];
}

export interface DebugBasketUnknownRoute {
  route_key: string;
  count: number;
  sources: string[];
}

export interface SessionMetrics {
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_output_tokens: number;
  total_cached_input_tokens: number;
  total_tokens: number;
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
  own_metrics: SessionMetrics;
  metrics: SessionMetrics;
  events: SessionEvent[];
  timeline: SessionEvent[];
  graph_turns: GraphTurn[];
  child_sessions: SessionSummary[];
  debug_basket?: DebugBasket | null;
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
}

export interface SessionRow {
  id: string;
  source_path: string | null;
  file_name: string | null;
  parent_session_id: string | null;
  is_subagent: number;
  agent_nickname: string | null;
  agent_role: string | null;
  start_time: string | null;
  end_time: string | null;
  imported_at: string;
  debug_basket?: DebugBasket | null;
}

export interface EventRow {
  id: string;
  session_id: string;
  kind: string;
  timestamp: string | null;
  role: string | null;
  phase: string | null;
  content: string | null;
  metadata: string | null;
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
  title: string;
  summary: string;
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
  label: string;
  note: string;
}

// ── IPC params ──────────────────────────────────────────

export interface ListSessionsParams {
  filter?: string;
  sort?: string;
  sort_order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface ListSessionsResult {
  sessions: SessionRow[];
  total: number;
}
