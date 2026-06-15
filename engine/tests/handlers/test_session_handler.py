from __future__ import annotations

import pytest

from probe.handlers import session_handler
from probe.storage import event_dao, session_dao
from probe.storage.connection import open_connection
from probe.storage.schema import initialize_schema


def test_handle_detail_returns_nested_children(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    conn = open_connection(tmp_path / "probe.sqlite")
    initialize_schema(conn)
    session_dao.upsert_many(
        conn,
        [
            {"id": "root", "is_subagent": 0, "start_time": "2026-01-01T00:00:00Z"},
            {
                "id": "child",
                "parent_session_id": "root",
                "is_subagent": 1,
                "start_time": "2026-01-01T00:01:00Z",
            },
            {
                "id": "grandchild",
                "parent_session_id": "child",
                "is_subagent": 1,
                "start_time": "2026-01-01T00:02:00Z",
            },
        ],
    )
    event_dao.insert_many(
        conn,
        [
            {"event_id": "root-event", "session_id": "root", "kind": "user_input"},
            {"event_id": "child-event", "session_id": "child", "kind": "assistant_output"},
            {"event_id": "grandchild-event", "session_id": "grandchild", "kind": "assistant_output"},
        ],
    )
    conn.commit()
    monkeypatch.setattr(session_handler, "get_connection", lambda: conn)

    detail = session_handler.handle_detail({"session_id": "root"})

    child = detail["children"][0]
    grandchild = child["children"][0]
    assert child["id"] == "child"
    assert child["events"][0]["id"] == "child-event"
    assert grandchild["id"] == "grandchild"
    assert grandchild["events"][0]["id"] == "grandchild-event"


def test_handle_detail_requires_session_id() -> None:
    with pytest.raises(ValueError, match="session_id is required"):
        session_handler.handle_detail({})
