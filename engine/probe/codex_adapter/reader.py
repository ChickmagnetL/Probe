from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from .models import JSONDict, ParsedLine


def is_rollout_file(path: Path) -> bool:
    return path.is_file() and path.name.startswith("rollout-") and path.suffix == ".jsonl"


def discover_rollout_files(input_path: str | Path) -> list[Path]:
    path = Path(input_path).expanduser()
    if path.is_file():
        if not is_rollout_file(path):
            raise ValueError(f"unsupported input file: {path}")
        return [path.resolve()]

    if path.is_dir():
        files = sorted(candidate.resolve() for candidate in path.iterdir() if is_rollout_file(candidate))
        if not files:
            raise ValueError(f"no rollout-*.jsonl files found in directory: {path}")
        return files

    raise FileNotFoundError(f"input path does not exist: {path}")


def iter_parsed_lines(
    path: str | Path,
) -> Iterator[tuple[ParsedLine | None, JSONDict | None]]:
    source = Path(path).resolve()
    with source.open("r", encoding="utf-8") as handle:
        for line_no, raw_text in enumerate(handle, start=1):
            text = raw_text.rstrip("\n")
            if not text.strip():
                yield None, build_parse_error(
                    source_path=str(source),
                    source_line_no=line_no,
                    raw_text=text,
                    error="blank line is not valid JSON",
                    error_type="blank_line",
                )
                continue

            try:
                data = json.loads(text)
            except json.JSONDecodeError as exc:
                yield None, build_parse_error(
                    source_path=str(source),
                    source_line_no=line_no,
                    raw_text=text,
                    error=f"{exc.msg} (line {exc.lineno}, column {exc.colno})",
                    error_type="json_decode_error",
                )
                continue

            if not isinstance(data, dict):
                yield None, build_parse_error(
                    source_path=str(source),
                    source_line_no=line_no,
                    raw_text=text,
                    error="top-level record must be a JSON object",
                    error_type="schema_error",
                )
                continue

            record_type = data.get("type")
            if not isinstance(record_type, str) or not record_type:
                yield None, build_parse_error(
                    source_path=str(source),
                    source_line_no=line_no,
                    raw_text=text,
                    error="record is missing string field 'type'",
                    error_type="schema_error",
                )
                continue

            payload = data.get("payload")
            payload_type = (
                payload.get("type")
                if isinstance(payload, dict) and isinstance(payload.get("type"), str)
                else None
            )
            timestamp = data.get("timestamp")
            yield (
                ParsedLine(
                    source_path=str(source),
                    source_line_no=line_no,
                    raw_text=text,
                    data=data,
                    record_type=record_type,
                    payload_type=payload_type,
                    timestamp=timestamp if isinstance(timestamp, str) else None,
                ),
                None,
            )


def build_parse_error(
    *,
    source_path: str,
    source_line_no: int,
    raw_text: str,
    error: str,
    error_type: str,
) -> JSONDict:
    return {
        "parse_error_id": f"{source_path}:{source_line_no}",
        "source_path": source_path,
        "source_line_no": source_line_no,
        "raw_text": raw_text,
        "error": error,
        "error_type": error_type,
    }
