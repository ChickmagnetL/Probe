"""SQLite connection management — singleton, context manager, platform-aware path."""

from __future__ import annotations

import logging
import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

logger = logging.getLogger(__name__)

_DEFAULT_DB_NAME = "probe_desktop.sqlite"
_FALLBACK_DIR = Path.home() / ".probe"

# Process-level capability flags, populated lazily by probe_fts_capabilities().
# None = not yet probed. Once probed they are stable for the connection's life.
_fts5_available: bool | None = None
_trigram_available: bool | None = None


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


def probe_fts_capabilities(conn: sqlite3.Connection | None = None) -> tuple[bool, bool]:
    """Probe whether the SQLite build supports FTS5 and the trigram tokenizer.

    Returns ``(fts5_available, trigram_available)``. Results are cached as
    process-level flags after the first call. Any failure during probing is
    treated as "unsupported" and logged at warning level — this function never
    raises, so callers can gate schema/query logic on the result without
    handling a third error branch.

    The probe uses a temporary table on the given connection (or the singleton
    connection when ``conn`` is None) so it leaves no persistent artefacts and
    works on a freshly opened in-memory database.
    """
    global _fts5_available, _trigram_available
    if _fts5_available is not None and _trigram_available is not None:
        return _fts5_available, _trigram_available

    probe_conn = conn if conn is not None else get_connection()
    fts5_ok = False
    trigram_ok = False
    try:
        probe_conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS _probe_fts5 USING fts5(content)"
        )
        probe_conn.execute("DROP TABLE IF EXISTS _probe_fts5")
        fts5_ok = True
    except sqlite3.OperationalError as exc:
        # FTS5 extension not compiled in (e.g. some PyInstaller-bundled SQLite).
        # Fall back to LIKE-only search; functionality stays available.
        logger.warning("FTS5 not available, content search will use LIKE: %s", exc)

    if fts5_ok:
        try:
            probe_conn.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS _probe_trigram"
                " USING fts5(content, tokenize='trigram')"
            )
            probe_conn.execute("DROP TABLE IF EXISTS _probe_trigram")
            trigram_ok = True
        except sqlite3.OperationalError as exc:
            # Trigram tokenizer requires SQLite >= 3.34; older builds lack it.
            logger.warning(
                "trigram tokenizer not available, short queries will use LIKE: %s",
                exc,
            )

    _fts5_available = fts5_ok
    _trigram_available = trigram_ok
    return fts5_ok, trigram_ok


def reset_capability_cache() -> None:
    """Clear cached capability flags. For tests that re-probe on a fresh DB."""
    global _fts5_available, _trigram_available
    _fts5_available = None
    _trigram_available = None
