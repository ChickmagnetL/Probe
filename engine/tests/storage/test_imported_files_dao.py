from __future__ import annotations

from probe.storage import imported_files_dao
from probe.storage.connection import open_connection
from probe.storage.schema import initialize_schema


def test_delete_by_session_ids_removes_matching_rows(tmp_path):
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    imported_files_dao.upsert(
        conn, source_path="/a/b.jsonl", mtime=1000.0, size=200, session_id="sid-1"
    )
    imported_files_dao.upsert(
        conn, source_path="/a/c.jsonl", mtime=2000.0, size=400, session_id="sid-2"
    )
    conn.commit()

    imported_files_dao.delete_by_session_ids(conn, ["sid-1"])
    conn.commit()

    assert imported_files_dao.get(conn, "/a/b.jsonl") is None
    # sid-2 row untouched
    assert imported_files_dao.get(conn, "/a/c.jsonl") is not None


def test_delete_by_session_ids_empty_list_is_noop(tmp_path):
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    imported_files_dao.upsert(
        conn, source_path="/x.jsonl", mtime=1.0, size=10, session_id="sid-1"
    )
    conn.commit()

    imported_files_dao.delete_by_session_ids(conn, [])
    conn.commit()

    assert imported_files_dao.get(conn, "/x.jsonl") is not None


def test_delete_by_session_ids_handles_nonexistent_session_ids(tmp_path):
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    imported_files_dao.upsert(
        conn, source_path="/y.jsonl", mtime=1.0, size=10, session_id="sid-real"
    )
    conn.commit()

    # Deleting a non-existent session_id should not raise.
    imported_files_dao.delete_by_session_ids(conn, ["sid-nonexistent"])
    conn.commit()

    assert imported_files_dao.get(conn, "/y.jsonl") is not None


def test_delete_by_session_ids_deletes_multiple_sessions(tmp_path):
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    imported_files_dao.upsert(
        conn, source_path="/1.jsonl", mtime=1.0, size=1, session_id="a"
    )
    imported_files_dao.upsert(
        conn, source_path="/2.jsonl", mtime=2.0, size=2, session_id="a"
    )
    imported_files_dao.upsert(
        conn, source_path="/3.jsonl", mtime=3.0, size=3, session_id="b"
    )
    conn.commit()

    imported_files_dao.delete_by_session_ids(conn, ["a", "b"])
    conn.commit()

    all_files = imported_files_dao.get_all(conn)
    assert len(all_files) == 0


def test_delete_orphaned_removes_rows_with_missing_session(tmp_path):
    """delete_orphaned should remove imported_files rows whose session_id is
    not in the sessions table."""
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    # Insert a session row so sid-1 exists.
    conn.execute(
        "INSERT INTO sessions (id, source_path) VALUES (?, ?)",
        ("sid-1", "/a/b.jsonl"),
    )
    conn.commit()

    # Upsert two imported_files rows: one with a valid session_id, one orphan.
    imported_files_dao.upsert(
        conn, source_path="/a/b.jsonl", mtime=1000.0, size=200, session_id="sid-1"
    )
    imported_files_dao.upsert(
        conn, source_path="/a/orphan.jsonl", mtime=2000.0, size=400, session_id="sid-orphan"
    )
    conn.commit()

    count = imported_files_dao.delete_orphaned(conn)
    conn.commit()

    # Only the orphan row should be deleted.
    assert count == 1
    assert imported_files_dao.get(conn, "/a/b.jsonl") is not None
    assert imported_files_dao.get(conn, "/a/orphan.jsonl") is None


def test_delete_orphaned_returns_zero_when_no_orphans(tmp_path):
    """delete_orphaned should return 0 when all imported_files have valid session_ids."""
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    conn.execute(
        "INSERT INTO sessions (id, source_path) VALUES (?, ?)",
        ("sid-1", "/x.jsonl"),
    )
    conn.commit()

    imported_files_dao.upsert(
        conn, source_path="/x.jsonl", mtime=1.0, size=10, session_id="sid-1"
    )
    conn.commit()

    count = imported_files_dao.delete_orphaned(conn)
    conn.commit()

    assert count == 0
    assert imported_files_dao.get(conn, "/x.jsonl") is not None


def test_delete_orphaned_handles_empty_imported_files(tmp_path):
    """delete_orphaned should return 0 when the imported_files table is empty."""
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)

    count = imported_files_dao.delete_orphaned(conn)
    conn.commit()

    assert count == 0
