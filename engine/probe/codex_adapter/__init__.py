from __future__ import annotations

from pathlib import Path
from typing import Any

from .extractors import build_tool_call_pairs, process_line
from .models import ExtractionBuffers, FileContext
from .reader import discover_rollout_files, iter_parsed_lines
from .summary import build_summary
from .writer import write_outputs

__all__ = ["parse_codex_rollout", "run_codex_rollout_demo"]


def _extract_buffers(input_path: str | Path) -> ExtractionBuffers:
    buffers = ExtractionBuffers()
    rollout_files = discover_rollout_files(input_path)

    for rollout_file in rollout_files:
        file_context = FileContext(
            source_path=str(rollout_file),
            file_name=rollout_file.name,
            file_size=rollout_file.stat().st_size,
        )

        for parsed_line, parse_error in iter_parsed_lines(rollout_file):
            file_context.line_count += 1
            if parse_error is not None:
                file_context.parse_error_count += 1
                buffers.parse_errors.append(parse_error)
                continue
            process_line(parsed_line, file_context, buffers)

        tool_call_pairs = build_tool_call_pairs(file_context)
        if tool_call_pairs:
            buffers.tool_call_pairs.extend(tool_call_pairs)
            file_context.table_counts["tool_call_pairs"] += len(tool_call_pairs)

        buffers.file_manifest.append(file_context.to_manifest_entry())

    return buffers


def parse_codex_rollout(input_path: str | Path | list[str | Path]) -> dict[str, Any]:
    buffers = _extract_buffers(input_path)
    return build_summary(buffers)


def run_codex_rollout_demo(
    input_path: str | Path | list[str | Path],
    output_dir: str | Path,
) -> dict[str, Any]:
    buffers = _extract_buffers(input_path)
    summary = build_summary(buffers)
    write_outputs(output_dir, buffers, summary)
    return summary
