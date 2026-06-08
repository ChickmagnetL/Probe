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
        debug_basket TEXT,
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
]

_INDEXES_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)",
    "CREATE INDEX IF NOT EXISTS idx_rule_results_session_id ON rule_results(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_rule_results_rule_type ON rule_results(rule_type)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_imported_at ON sessions(imported_at)",
]


def initialize_schema(conn: sqlite3.Connection) -> None:
    for sql in _TABLES_SQL:
        conn.execute(sql)
    _ensure_column(conn, "sessions", "debug_basket", "debug_basket TEXT")
    for sql in _INDEXES_SQL:
        conn.execute(sql)
    conn.commit()


def _ensure_column(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    columns = {
        row[1]
        for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_definition}")
