"""Shared platform routing for Codex CLI and Claude Code imports/scans."""

from __future__ import annotations

import tempfile
from pathlib import Path

from probe.claude_code_adapter import (
    discover_claude_scan_files,
    is_claude_code_file,
    parse_claude_code,
    resolve_claude_scan_root,
)
from probe.codex_adapter import run_codex_rollout_demo
from probe.codex_adapter.reader import is_rollout_file
from probe.path_utils import path_from_user_input

DEFAULT_SESSION_PLATFORM = "codex_cli"
SUPPORTED_SESSION_PLATFORMS = frozenset({"claude_code", "codex_cli"})


def normalize_platform(platform: str | None) -> str | None:
    if platform is None:
        return None
    if platform not in SUPPORTED_SESSION_PLATFORMS:
        raise ValueError(f"unsupported platform: {platform}")
    return platform


def detect_input_platform(path: Path) -> str:
    if _looks_like_codex_input(path):
        return "codex_cli"
    if _looks_like_claude_input(path):
        return "claude_code"
    raise ValueError(f"unsupported input path: {path}")


def ensure_platform_for_paths(
    *,
    explicit_platform: str | None,
    paths: list[Path],
) -> str:
    if explicit_platform is not None:
        return explicit_platform
    detected = {detect_input_platform(path) for path in paths}
    if len(detected) != 1:
        raise ValueError(
            "file_paths span multiple platforms; import each platform separately"
        )
    return next(iter(detected))


def resolve_scan_root(platform: str, path_value: str) -> Path:
    if platform == "claude_code":
        return resolve_claude_scan_root(path_value)
    return _resolve_codex_sessions_dir(path_value)


def discover_scan_files(platform: str, root: Path) -> list[Path]:
    if platform == "claude_code":
        return discover_claude_scan_files(root)
    return sorted(
        candidate.resolve()
        for candidate in root.rglob("rollout-*.jsonl")
        if is_rollout_file(candidate)
    )


def parse_files(platform: str, paths: list[Path]) -> dict:
    if platform == "claude_code":
        return parse_claude_code([str(path) for path in paths])
    with tempfile.TemporaryDirectory() as tmp_dir:
        return run_codex_rollout_demo([str(path) for path in paths], tmp_dir)


def _looks_like_codex_input(path: Path) -> bool:
    if path.is_file():
        return is_rollout_file(path)
    if not path.is_dir():
        return False
    if path.name == "sessions" or (path / "sessions").is_dir():
        return True
    return any(is_rollout_file(candidate) for candidate in path.rglob("rollout-*.jsonl"))


def _looks_like_claude_input(path: Path) -> bool:
    if path.is_file():
        return is_claude_code_file(path)
    if not path.is_dir():
        return False
    if path.name in {".claude", "projects", "subagents"}:
        return True
    if (path / "projects").is_dir():
        return True
    return any(is_claude_code_file(candidate) for candidate in path.rglob("*.jsonl"))


def _resolve_codex_sessions_dir(path_value: str) -> Path:
    expanded = path_from_user_input(path_value)
    if expanded.name == "sessions":
        return expanded
    sessions_subdir = expanded / "sessions"
    if sessions_subdir.is_dir():
        return sessions_subdir
    return expanded
