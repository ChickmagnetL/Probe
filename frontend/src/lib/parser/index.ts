import type { JSONDict } from "./models";
import { createFileContext, createExtractionBuffers } from "./models";
import { parseAllLines } from "./reader";
import { processLine, buildToolCallPairs } from "./extractors";
import { buildSummary } from "./summary";

export type { ParsedLine, FileContext, ExtractionBuffers, JSONDict } from "./models";
export { parseAllLines } from "./reader";
export { processLine, buildToolCallPairs } from "./extractors";
export { buildSummary } from "./summary";

export interface ParseFileResult {
  source_path: string;
  file_name: string;
  file_size: number;
  parsed_count: number;
  error_count: number;
}

/**
 * Process a single file's content through the full parser pipeline.
 * Returns the updated buffers and metadata about the file.
 */
export function processFile(
  source_path: string,
  content: string,
  buffers: ReturnType<typeof createExtractionBuffers>,
): ParseFileResult {
  const file_name = source_path.split("/").pop() ?? source_path;
  const file_size = new TextEncoder().encode(content).byteLength;
  const file_context = createFileContext(source_path, file_name, file_size);

  const { lines, errors } = parseAllLines(source_path, content);

  for (const err of errors) {
    buffers.parse_errors.push(err as unknown as JSONDict);
    file_context.parse_error_count += 1;
  }

  file_context.line_count = lines.length + errors.length;

  for (const line of lines) {
    processLine(line, file_context, buffers);
  }

  const pairs = buildToolCallPairs(file_context);
  for (const pair of pairs) {
    buffers.tool_call_pairs.push(pair);
    file_context.table_counts.tool_call_pairs = (file_context.table_counts.tool_call_pairs ?? 0) + 1;
  }

  buffers.file_manifest.push({
    source_path: file_context.source_path,
    file_name: file_context.file_name,
    file_size: file_context.file_size,
    line_count: file_context.line_count,
    parsed_record_count: file_context.parsed_record_count,
    parse_error_count: file_context.parse_error_count,
    conversation_id: file_context.conversation_id,
    turn_count: file_context.turn_ids.size,
    table_counts: Object.fromEntries(Object.entries(file_context.table_counts).sort()),
    reserved_route_counts: Object.fromEntries(Object.entries(file_context.reserved_route_counts).sort()),
    unknown_route_counts: Object.fromEntries(Object.entries(file_context.unknown_route_counts).sort()),
  });

  return {
    source_path,
    file_name,
    file_size,
    parsed_count: file_context.parsed_record_count,
    error_count: file_context.parse_error_count,
  };
}

/**
 * Process multiple files and build the complete summary.
 */
export function processFiles(
  files: Array<{ path: string; content: string }>,
): JSONDict {
  const buffers = createExtractionBuffers();
  for (const file of files) {
    processFile(file.path, file.content, buffers);
  }
  return buildSummary(buffers);
}
