from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

JSONDict = dict[str, Any]

PRE_TURN_ID = "pre_turn"

REQUIRED_JSONL_TABLES = (
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
)

OPTIONAL_JSONL_TABLES = (
    "structured_tool_end_events",
    "collaboration_events",
    "search_events",
    "system_events",
    "compaction_events",
)


@dataclass(frozen=True)
class ParsedLine:
    source_path: str
    source_line_no: int
    raw_text: str
    data: JSONDict
    record_type: str
    payload_type: str | None
    timestamp: str | None

    @property
    def payload(self) -> JSONDict:
        payload = self.data.get("payload")
        return payload if isinstance(payload, dict) else {}

    @property
    def raw_record_id(self) -> str:
        return f"{self.source_path}:{self.source_line_no}"


@dataclass
class FileContext:
    source_path: str
    file_name: str
    file_size: int
    line_count: int = 0
    parsed_record_count: int = 0
    parse_error_count: int = 0
    conversation_id: str | None = None
    active_turn_id: str | None = None
    turn_ids: set[str] = field(default_factory=set)
    table_counts: Counter[str] = field(default_factory=Counter)
    call_records: dict[str, list[str]] = field(
        default_factory=lambda: defaultdict(list)
    )
    call_outputs: dict[str, list[str]] = field(
        default_factory=lambda: defaultdict(list)
    )
    reserved_route_counts: Counter[str] = field(default_factory=Counter)
    unknown_route_counts: Counter[str] = field(default_factory=Counter)

    def to_manifest_entry(self) -> JSONDict:
        return {
            "source_path": self.source_path,
            "file_name": self.file_name,
            "file_size": self.file_size,
            "line_count": self.line_count,
            "parsed_record_count": self.parsed_record_count,
            "parse_error_count": self.parse_error_count,
            "conversation_id": self.conversation_id,
            "turn_count": len(self.turn_ids),
            "table_counts": dict(sorted(self.table_counts.items())),
            "reserved_route_counts": dict(sorted(self.reserved_route_counts.items())),
            "unknown_route_counts": dict(sorted(self.unknown_route_counts.items())),
        }


@dataclass
class ExtractionBuffers:
    file_manifest: list[JSONDict] = field(default_factory=list)
    parse_errors: list[JSONDict] = field(default_factory=list)
    raw_records: list[JSONDict] = field(default_factory=list)
    conversation_meta_raw: list[JSONDict] = field(default_factory=list)
    turn_manifest: list[JSONDict] = field(default_factory=list)
    message_items_raw: list[JSONDict] = field(default_factory=list)
    reasoning_items_raw: list[JSONDict] = field(default_factory=list)
    tool_calls_raw: list[JSONDict] = field(default_factory=list)
    tool_call_outputs_raw: list[JSONDict] = field(default_factory=list)
    tool_call_pairs: list[JSONDict] = field(default_factory=list)
    telemetry_events: list[JSONDict] = field(default_factory=list)
    lifecycle_events: list[JSONDict] = field(default_factory=list)
    structured_tool_end_events: list[JSONDict] = field(default_factory=list)
    collaboration_events: list[JSONDict] = field(default_factory=list)
    search_events: list[JSONDict] = field(default_factory=list)
    system_events: list[JSONDict] = field(default_factory=list)
    compaction_events: list[JSONDict] = field(default_factory=list)
    record_type_counts: Counter[str] = field(default_factory=Counter)
    payload_type_counts: Counter[str] = field(default_factory=Counter)
    reserved_route_counts: Counter[str] = field(default_factory=Counter)
    unknown_route_counts: Counter[str] = field(default_factory=Counter)
