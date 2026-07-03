"""Table creation and migration for the Probe SQLite database."""

from __future__ import annotations

import logging
import sqlite3

from .connection import probe_fts_capabilities

logger = logging.getLogger(__name__)

# Event kinds whose ``content`` column is indexed for full-text search.
# Maps the PRD's semantic categories (message / reasoning / tool-call commands)
# to the actual kind values written by the codex_adapter:
#   - message (user/assistant): user_input, assistant_output, assistant_update
#   - reasoning: assistant_update (streaming assistant text is the reasoning surface)
#   - tool-call params/commands: tool_call (args live in metadata, content is
#     NULL but harmless to include) + tool_event (carries "$ command" text)
# tool_output is intentionally excluded — large, noisy command output/stacks.
INDEXABLE_KINDS: frozenset[str] = frozenset(
    {"user_input", "assistant_output", "assistant_update", "tool_call", "tool_event"}
)

# SQL fragment reused by triggers and backfill to keep the kind filter in sync.
_KIND_FILTER = ",".join(f"'{k}'" for k in sorted(INDEXABLE_KINDS))

_TABLES_SQL = [
    """CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'codex_cli',
        source_path TEXT,
        file_name TEXT,
        parent_session_id TEXT,
        is_subagent INTEGER DEFAULT 0,
        agent_nickname TEXT,
        agent_role TEXT,
        start_time TEXT,
        end_time TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        kind TEXT,
        timestamp TEXT,
        role TEXT,
        phase TEXT,
        content TEXT,
        metadata TEXT,
        source_line_no INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS rule_results (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        event_id TEXT REFERENCES events(id),
        rule_id TEXT,
        rule_type TEXT,
        severity TEXT,
        message TEXT,
        evidence TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS imports (
        id TEXT PRIMARY KEY,
        input_path TEXT,
        platform TEXT NOT NULL DEFAULT 'codex_cli',
        file_count INTEGER,
        session_count INTEGER,
        status TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS imported_files (
        source_path TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'codex_cli',
        mtime REAL,
        size INTEGER,
        session_id TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""",
]

_INDEXES_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)",
    "CREATE INDEX IF NOT EXISTS idx_rule_results_session_id ON rule_results(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_rule_results_rule_type ON rule_results(rule_type)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_imported_at ON sessions(imported_at)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform)",
    "CREATE INDEX IF NOT EXISTS idx_imported_files_platform ON imported_files(platform)",
    "CREATE INDEX IF NOT EXISTS idx_imports_platform ON imports(platform)",
    "CREATE INDEX IF NOT EXISTS idx_imported_files_session_id ON imported_files(session_id)",
]

# Idempotent column additions for tables that already exist on upgraded DBs.
# CREATE TABLE IF NOT EXISTS does not add columns, so each new column needs an
# explicit ALTER TABLE guarded by a PRAGMA table_info existence check.
_SESSION_COLUMN_ADDITIONS = {
    "platform": "ALTER TABLE sessions ADD COLUMN platform TEXT NOT NULL DEFAULT 'codex_cli'",
    "title": "ALTER TABLE sessions ADD COLUMN title TEXT",
    "cwd": "ALTER TABLE sessions ADD COLUMN cwd TEXT",
}
_IMPORTS_COLUMN_ADDITIONS = {
    "platform": "ALTER TABLE imports ADD COLUMN platform TEXT NOT NULL DEFAULT 'codex_cli'",
}
_IMPORTED_FILES_COLUMN_ADDITIONS = {
    "platform": "ALTER TABLE imported_files ADD COLUMN platform TEXT NOT NULL DEFAULT 'codex_cli'",
}


def initialize_schema(conn: sqlite3.Connection) -> None:
    for sql in _TABLES_SQL:
        conn.execute(sql)
    _migrate_columns(conn, "sessions", _SESSION_COLUMN_ADDITIONS)
    _migrate_columns(conn, "imports", _IMPORTS_COLUMN_ADDITIONS)
    _migrate_columns(conn, "imported_files", _IMPORTED_FILES_COLUMN_ADDITIONS)
    for sql in _INDEXES_SQL:
        conn.execute(sql)
    _initialize_fts(conn)
    conn.commit()


def _migrate_columns(
    conn: sqlite3.Connection,
    table_name: str,
    additions: dict[str, str],
) -> None:
    """Add missing columns for an upgraded table (idempotent)."""
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})")}
    for column, alter_sql in additions.items():
        if column not in existing:
            conn.execute(alter_sql)


def _initialize_fts(conn: sqlite3.Connection) -> None:
    """Create the events_fts external-content table, sync triggers, and backfill.

    Skipped entirely when the SQLite build lacks FTS5 or the trigram tokenizer;
    in that case search falls back to LIKE-only (see session_dao.list_sessions).
    """
    fts5_ok, trigram_ok = probe_fts_capabilities(conn)
    if not (fts5_ok and trigram_ok):
        return

    conn.execute(
        """CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
            content,
            content_rowid='rowid',
            tokenize='trigram'
        )"""
    )
    _create_fts_triggers(conn)
    _backfill_fts(conn)


def _create_fts_triggers(conn: sqlite3.Connection) -> None:
    """Triggers keeping events_fts in sync with events, kind-filtered.

    External-content mode stores only tokens in events_fts; the original text
    stays in events.content. Each trigger fires on events row changes and only
    touches events_fts when the row's kind is indexable.
    """
    conn.executescript(
        f"""
        CREATE TRIGGER IF NOT EXISTS events_fts_ai AFTER INSERT ON events BEGIN
            INSERT INTO events_fts(rowid, content)
            SELECT new.rowid, new.content
            WHERE new.kind IN ({_KIND_FILTER})
                AND new.content IS NOT NULL AND new.content != '';
        END;

        CREATE TRIGGER IF NOT EXISTS events_fts_ad AFTER DELETE ON events BEGIN
            DELETE FROM events_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS events_fts_au AFTER UPDATE ON events BEGIN
            DELETE FROM events_fts WHERE rowid = old.rowid;
            INSERT INTO events_fts(rowid, content)
            SELECT new.rowid, new.content
            WHERE new.kind IN ({_KIND_FILTER})
                AND new.content IS NOT NULL AND new.content != '';
        END;
        """
    )


def _backfill_fts(conn: sqlite3.Connection) -> None:
    """Populate events_fts from existing events on first upgrade.

    Runs once: when events has rows but events_fts is empty. On a fresh DB
    (no events) the trigger handles all future inserts, so the backfill is a
    no-op. The kind filter mirrors the INSERT trigger so non-indexable kinds
    (notably tool_output) never enter the index.
    """
    fts_count = conn.execute("SELECT COUNT(*) FROM events_fts").fetchone()[0]
    if fts_count > 0:
        return
    events_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    if events_count == 0:
        return

    cursor = conn.execute(
        f"""INSERT INTO events_fts(rowid, content)
            SELECT rowid, content FROM events
            WHERE kind IN ({_KIND_FILTER})
              AND content IS NOT NULL AND content != ''"""
    )
    logger.info(
        "backfilled events_fts with %d rows for content search", cursor.rowcount
    )
