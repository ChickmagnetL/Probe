"""Table creation and migration for the Probe SQLite database."""

from __future__ import annotations

import sqlite3

_TABLES_SQL = [
    """CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
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
    "CREATE INDEX IF NOT EXISTS idx_imported_files_session_id ON imported_files(session_id)",
]

# Idempotent column additions for tables that already exist on upgraded DBs.
# CREATE TABLE IF NOT EXISTS does not add columns, so each new column needs an
# explicit ALTER TABLE guarded by a PRAGMA table_info existence check.
_SESSION_COLUMN_ADDITIONS = {
    "title": "ALTER TABLE sessions ADD COLUMN title TEXT",
    "cwd": "ALTER TABLE sessions ADD COLUMN cwd TEXT",
}


def initialize_schema(conn: sqlite3.Connection) -> None:
    for sql in _TABLES_SQL:
        conn.execute(sql)
    _migrate_sessions_columns(conn)
    for sql in _INDEXES_SQL:
        conn.execute(sql)
    conn.commit()


def _migrate_sessions_columns(conn: sqlite3.Connection) -> None:
    """Add new sessions columns if missing (idempotent)."""
    existing = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    for column, alter_sql in _SESSION_COLUMN_ADDITIONS.items():
        if column not in existing:
            conn.execute(alter_sql)
