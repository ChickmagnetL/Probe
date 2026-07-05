from __future__ import annotations

import json
from pathlib import Path

from probe.path_utils import path_from_user_input


_KNOWN_CLAUDE_RECORD_TYPES = frozenset(
    {
        "agent-color",
        "agent-name",
        "agent-setting",
        "ai-title",
        "assistant",
        "attachment",
        "attribution-snapshot",
        "content-replacement",
        "custom-title",
        "file-history-snapshot",
        "last-prompt",
        "marble-origami-commit",
        "marble-origami-snapshot",
        "mode",
        "permission-mode",
        "pr-link",
        "progress",
        "queue-operation",
        "speculation-accept",
        "summary",
        "system",
        "tag",
        "task-summary",
        "user",
        "worktree-state",
    }
)


def is_claude_code_file(path: Path) -> bool:
    if not path.is_file() or path.suffix != ".jsonl":
        return False
    if path.name.startswith("rollout-"):
        return False
    if path.parent.name == "subagents" and path.name.startswith("agent-"):
        return True
    if path.name == ".claude" or any(part == ".claude" for part in path.parts):
        return True
    if path.name == "projects" or any(part == "projects" for part in path.parts):
        return True
    return _probe_claude_jsonl(path)


def resolve_claude_scan_root(path_value: str) -> Path:
    expanded = path_from_user_input(path_value)
    if expanded.name == ".claude":
        return expanded / "projects"
    projects_dir = expanded / "projects"
    if projects_dir.is_dir():
        return projects_dir
    return expanded


def discover_claude_scan_files(root: Path) -> list[Path]:
    return sorted(
        candidate.resolve()
        for candidate in root.rglob("*.jsonl")
        if is_claude_code_file(candidate)
    )


def discover_claude_code_files(input_path: str | Path | list[str | Path]) -> list[Path]:
    if isinstance(input_path, list):
        files: list[Path] = []
        for entry in input_path:
            path = path_from_user_input(str(entry))
            if not is_claude_code_file(path):
                raise ValueError(f"unsupported Claude Code input file: {path}")
            files.append(path.resolve())
        if not files:
            raise ValueError("empty file list passed to discover_claude_code_files")
        return _dedupe_paths(files)

    path = path_from_user_input(str(input_path))
    if path.is_file():
        if not is_claude_code_file(path):
            raise ValueError(f"unsupported Claude Code input file: {path}")
        return [path.resolve()]

    if path.is_dir():
        files = discover_claude_scan_files(path)
        if not files:
            raise ValueError(f"no Claude Code jsonl files found in directory: {path}")
        return files

    raise FileNotFoundError(f"input path does not exist: {path}")


def _dedupe_paths(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    ordered: list[Path] = []
    for path in paths:
        if path not in seen:
            seen.add(path)
            ordered.append(path)
    return ordered


def _probe_claude_jsonl(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                text = raw_line.strip()
                if not text:
                    continue
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    return False
                if not isinstance(data, dict):
                    return False
                record_type = data.get("type")
                if not isinstance(record_type, str) or not record_type:
                    return False
                if record_type in _KNOWN_CLAUDE_RECORD_TYPES:
                    return True
                if isinstance(data.get("sessionId"), str) and (
                    isinstance(data.get("message"), dict)
                    or isinstance(data.get("attachment"), dict)
                ):
                    return True
                return False
    except OSError:
        return False
    return False
