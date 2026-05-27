/** Mutable record type alias for JSON-like objects. */
export type JSONDict = Record<string, unknown>;

/** Sentinel turn_id for records before any explicit turn_context. */
export const PRE_TURN_ID = "pre_turn";

/** Required table names in the extraction buffers. */
export const REQUIRED_JSONL_TABLES = [
  "parse_errors",
  "raw_records",
  "conversation_meta_raw",
  "turn_manifest",
  "message_items_raw",
  "reasoning_items_raw",
  "tool_calls_raw",
  "tool_call_outputs_raw",
  "tool_call_pairs",
  "telemetry_events",
  "lifecycle_events",
] as const;

export type TableName = (typeof REQUIRED_JSONL_TABLES)[number];

/** A successfully parsed JSONL line. */
export interface ParsedLine {
  source_path: string;
  source_line_no: number;
  raw_text: string;
  data: JSONDict;
  record_type: string;
  payload_type: string | null;
  timestamp: string | null;
}

export function getPayload(line: ParsedLine): JSONDict {
  const payload = line.data.payload;
  return typeof payload === "object" && payload !== null
    ? (payload as JSONDict)
    : {};
}

export function rawRecordId(line: ParsedLine): string {
  return `${line.source_path}:${line.source_line_no}`;
}

/** Per-file processing state. */
export interface FileContext {
  source_path: string;
  file_name: string;
  file_size: number;
  line_count: number;
  parsed_record_count: number;
  parse_error_count: number;
  conversation_id: string | null;
  active_turn_id: string | null;
  turn_ids: Set<string>;
  table_counts: Record<string, number>;
  call_records: Record<string, string[]>;
  call_outputs: Record<string, string[]>;
  reserved_route_counts: Record<string, number>;
  unknown_route_counts: Record<string, number>;
}

export function createFileContext(
  source_path: string,
  file_name: string,
  file_size: number,
): FileContext {
  return {
    source_path,
    file_name,
    file_size,
    line_count: 0,
    parsed_record_count: 0,
    parse_error_count: 0,
    conversation_id: null,
    active_turn_id: null,
    turn_ids: new Set(),
    table_counts: {},
    call_records: {},
    call_outputs: {},
    reserved_route_counts: {},
    unknown_route_counts: {},
  };
}

/** Buffers that accumulate extracted rows across all files. */
export interface ExtractionBuffers {
  file_manifest: JSONDict[];
  parse_errors: JSONDict[];
  raw_records: JSONDict[];
  conversation_meta_raw: JSONDict[];
  turn_manifest: JSONDict[];
  message_items_raw: JSONDict[];
  reasoning_items_raw: JSONDict[];
  tool_calls_raw: JSONDict[];
  tool_call_outputs_raw: JSONDict[];
  tool_call_pairs: JSONDict[];
  telemetry_events: JSONDict[];
  lifecycle_events: JSONDict[];
  structured_tool_end_events: JSONDict[];
  collaboration_events: JSONDict[];
  search_events: JSONDict[];
  system_events: JSONDict[];
  compaction_events: JSONDict[];
  record_type_counts: Record<string, number>;
  payload_type_counts: Record<string, number>;
  reserved_route_counts: Record<string, number>;
  unknown_route_counts: Record<string, number>;
}

export function createExtractionBuffers(): ExtractionBuffers {
  return {
    file_manifest: [],
    parse_errors: [],
    raw_records: [],
    conversation_meta_raw: [],
    turn_manifest: [],
    message_items_raw: [],
    reasoning_items_raw: [],
    tool_calls_raw: [],
    tool_call_outputs_raw: [],
    tool_call_pairs: [],
    telemetry_events: [],
    lifecycle_events: [],
    structured_tool_end_events: [],
    collaboration_events: [],
    search_events: [],
    system_events: [],
    compaction_events: [],
    record_type_counts: {},
    payload_type_counts: {},
    reserved_route_counts: {},
    unknown_route_counts: {},
  };
}
