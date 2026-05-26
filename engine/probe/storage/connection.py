"""SQLite connection management — singleton, context manager, platform-aware path."""

from __future__ import annotations

import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

_DEFAULT_DB_NAME = "probe_desktop.sqlite"
_FALLBACK_DIR = Path.home() / ".probe"


def current_platform() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform == "win32":
        return "windows"
    return "linux"


def default_database_path() -> Path:
    env_override = _non_empty(os.environ.get("PROBE_DB_PATH"))
    if env_override:
        return Path(env_override)
    return resolve_database_path(
        platform=current_platform(),
        environment=dict(os.environ),
        fallback_path=str(_FALLBACK_DIR / _DEFAULT_DB_NAME),
    )


def resolve_database_path(
    *,
    platform: str,
    environment: dict[str, str],
    fallback_path: str,
) -> Path:
    base: Path | None = None

    if platform == "macos":
        home = _non_empty(environment.get("HOME"))
        if home:
            base = Path(home) / "Library" / "Application Support"
    elif platform == "windows":
        local_app_data = _non_empty(environment.get("LOCALAPPDATA"))
        if local_app_data:
            base = Path(local_app_data)
        else:
            app_data = _non_empty(environment.get("APPDATA"))
            if app_data:
                base = Path(app_data)
    else:
        xdg = _non_empty(environment.get("XDG_DATA_HOME"))
        if xdg:
            base = Path(xdg)
        else:
            home = _non_empty(environment.get("HOME"))
            if home:
                base = Path(home) / ".local" / "share"

    if base is None:
        base = Path(fallback_path).parent

    return base / "probe_desktop" / _DEFAULT_DB_NAME


def _non_empty(value: str | None) -> str | None:
    if value is not None and value.strip():
        return value
    return None


def open_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else default_database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


_connection: sqlite3.Connection | None = None


def get_connection() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        _connection = open_connection()
    return _connection


def close_connection() -> None:
    global _connection
    if _connection is not None:
        _connection.close()
        _connection = None


@contextmanager
def transaction() -> Generator[sqlite3.Connection, None, None]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
