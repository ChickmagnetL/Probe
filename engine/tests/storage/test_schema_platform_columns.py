from __future__ import annotations

from probe.storage.connection import open_connection
from probe.storage.schema import initialize_schema


def test_initialize_schema_adds_platform_columns_on_fresh_db(tmp_path) -> None:
    conn = open_connection(tmp_path / "probe.sqlite")
    initialize_schema(conn)

    sessions_columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    imports_columns = {row[1] for row in conn.execute("PRAGMA table_info(imports)")}
    imported_files_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(imported_files)")
    }

    assert "platform" in sessions_columns
    assert "platform" in imports_columns
    assert "platform" in imported_files_columns


def test_initialize_schema_backfills_platform_columns_for_existing_rows(tmp_path) -> None:
    conn = open_connection(tmp_path / "probe.sqlite")
    conn.execute(
        """CREATE TABLE sessions (
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
        )"""
    )
    conn.execute(
        """CREATE TABLE imports (
            id TEXT PRIMARY KEY,
            input_path TEXT,
            file_count INTEGER,
            session_count INTEGER,
            status TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    conn.execute(
        """CREATE TABLE imported_files (
            source_path TEXT PRIMARY KEY,
            mtime REAL,
            size INTEGER,
            session_id TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    conn.execute("INSERT INTO sessions (id, source_path) VALUES ('legacy-session', '/legacy.jsonl')")
    conn.execute(
        "INSERT INTO imports (id, input_path, file_count, session_count, status) VALUES ('legacy-import', '/legacy.jsonl', 1, 1, 'completed')"
    )
    conn.execute(
        "INSERT INTO imported_files (source_path, mtime, size, session_id) VALUES ('/legacy.jsonl', 1.0, 12, 'legacy-session')"
    )
    conn.commit()

    initialize_schema(conn)

    session_platform = conn.execute(
        "SELECT platform FROM sessions WHERE id = 'legacy-session'"
    ).fetchone()[0]
    import_platform = conn.execute(
        "SELECT platform FROM imports WHERE id = 'legacy-import'"
    ).fetchone()[0]
    imported_file_platform = conn.execute(
        "SELECT platform FROM imported_files WHERE source_path = '/legacy.jsonl'"
    ).fetchone()[0]

    assert session_platform == "codex_cli"
    assert import_platform == "codex_cli"
    assert imported_file_platform == "codex_cli"
