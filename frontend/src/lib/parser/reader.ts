import type { ParsedLine, JSONDict } from "./models";

export interface ParseError {
  parse_error_id: string;
  source_path: string;
  source_line_no: number;
  raw_text: string;
  error: string;
  error_type: string;
}

function buildParseError(opts: {
  source_path: string;
  source_line_no: number;
  raw_text: string;
  error: string;
  error_type: string;
}): ParseError {
  return {
    parse_error_id: `${opts.source_path}:${opts.source_line_no}`,
    source_path: opts.source_path,
    source_line_no: opts.source_line_no,
    raw_text: opts.raw_text,
    error: opts.error,
    error_type: opts.error_type,
  };
}

export type ParsedLineResult = { line: ParsedLine; error: null } | { line: null; error: ParseError };

/**
 * Parse a single JSONL text line into a ParsedLine or a ParseError.
 */
export function parseLine(
  source_path: string,
  line_no: number,
  raw_text: string,
): ParsedLineResult {
  const text = raw_text.replace(/\n+$/, "");
  if (!text.trim()) {
    return { line: null, error: buildParseError({
      source_path, source_line_no: line_no, raw_text: text,
      error: "blank line is not valid JSON", error_type: "blank_line",
    })};
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return { line: null, error: buildParseError({
      source_path, source_line_no: line_no, raw_text: text,
      error: msg, error_type: "json_decode_error",
    })};
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { line: null, error: buildParseError({
      source_path, source_line_no: line_no, raw_text: text,
      error: "top-level record must be a JSON object", error_type: "schema_error",
    })};
  }

  const dict = data as JSONDict;
  const record_type = dict.type;
  if (typeof record_type !== "string" || !record_type) {
    return { line: null, error: buildParseError({
      source_path, source_line_no: line_no, raw_text: text,
      error: "record is missing string field 'type'", error_type: "schema_error",
    })};
  }

  const payload = dict.payload;
  const payload_type =
    typeof payload === "object" && payload !== null &&
    typeof (payload as JSONDict).type === "string"
      ? ((payload as JSONDict).type as string)
      : null;

  const ts = dict.timestamp;
  const timestamp = typeof ts === "string" ? ts : null;

  return {
    line: {
      source_path,
      source_line_no: line_no,
      raw_text: text,
      data: dict,
      record_type,
      payload_type,
      timestamp,
    },
    error: null,
  };
}

/**
 * Parse all lines from a text string. Returns parsed lines and errors.
 */
export function parseAllLines(
  source_path: string,
  content: string,
): { lines: ParsedLine[]; errors: ParseError[] } {
  const lines: ParsedLine[] = [];
  const errors: ParseError[] = [];
  const rawLines = content.split("\n");

  for (let i = 0; i < rawLines.length; i++) {
    const result = parseLine(source_path, i + 1, rawLines[i]);
    if (result.line) {
      lines.push(result.line);
    } else {
      errors.push(result.error);
    }
  }

  return { lines, errors };
}
