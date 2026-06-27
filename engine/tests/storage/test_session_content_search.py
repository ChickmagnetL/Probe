"""Content full-text search — FTS5 + trigram index on events.content.

Covers the implement.md gates:
  - Trigger 3-state (insert / delete / kind filter)
  - Capability-probe fallback to LIKE
  - Historical backfill migration
  - ≥3-char FTS hit, 1-2-char LIKE hit
  - Metadata search non-regression
  - Special-char / malicious query sanitization
  - Empty-filter behavior unchanged
  - Performance baseline at ~100k events
"""

from __future__ import annotations

import time

import pytest

from probe.storage import event_dao, session_dao
from probe.storage.connection import open_connection
from probe.storage.schema import INDEXABLE_KINDS, initialize_schema

# A kind that is NOT in INDEXABLE_KINDS — its content must never be searchable.
_NON_INDEXABLE_KIND = "tool_output"


def _insert_session(conn, sid: str, **fields) -> None:
    session = {"id": sid}
    session.update(fields)
    session_dao.upsert(conn, session)
    conn.commit()


def _insert_event(conn, eid: str, sid: str, kind: str, content: str) -> None:
    event_dao.insert(
        conn,
        {
            "event_id": eid,
            "session_id": sid,
            "kind": kind,
            "content": content,
            "timestamp": "2024-01-01T00:00:00Z",
        },
    )
    conn.commit()


@pytest.fixture()
def db(tmp_path):
    """A schema-initialized DB on a fresh tmp file. FTS is real on this host."""
    conn = open_connection(tmp_path / "test.sqlite")
    initialize_schema(conn)
    yield conn


# --------------------------------------------------------------------------
# Trigger 3-state: insert / delete / kind filter
# --------------------------------------------------------------------------


def test_each_indexable_kind_is_searchable(db):
    """One event per INDEXABLE_KIND; each distinctive token is FTS-searchable."""
    for i, kind in enumerate(sorted(INDEXABLE_KINDS)):
        sid = f"s-{kind}"
        _insert_session(db, sid, file_name=f"{kind}.jsonl")
        _insert_event(db, f"e-{kind}", sid, kind, f"tokentoken{i}body")

    for i, kind in enumerate(sorted(INDEXABLE_KINDS)):
        sessions, total = session_dao.list_sessions(
            db, filter_text=f"tokentoken{i}body"
        )
        assert total == 1, f"kind {kind} content should be searchable"
        assert sessions[0]["id"] == f"s-{kind}"


def test_tool_output_is_not_searchable(db):
    """tool_output content must be excluded from the index on both paths."""
    _insert_session(db, "s-indexable", file_name="ok.jsonl")
    _insert_event(db, "e-ok", "s-indexable", "user_input", "sharedterm")

    _insert_session(db, "s-tooloutput", file_name="tool.jsonl")
    _insert_event(db, "e-tool", "s-tooloutput", _NON_INDEXABLE_KIND, "sharedterm")

    # ≥3-char FTS path: only the indexable session matches.
    sessions, total = session_dao.list_sessions(db, filter_text="sharedterm")
    assert total == 1
    assert sessions[0]["id"] == "s-indexable"


def test_delete_event_clears_fts(db):
    """Deleting an event must leave no FTS residue."""
    _insert_session(db, "s-del", file_name="del.jsonl")
    _insert_event(db, "e-del", "s-del", "user_input", "uniquedeltoken")

    sessions, _ = session_dao.list_sessions(db, filter_text="uniquedeltoken")
    assert len(sessions) == 1

    db.execute("DELETE FROM events WHERE id = ?", ("e-del",))
    db.commit()

    sessions, total = session_dao.list_sessions(db, filter_text="uniquedeltoken")
    assert total == 0
    assert sessions == []


def test_update_event_replaces_fts_content(db):
    """Updating an event's content must replace the indexed text (no stale copy).

    Covers the events_fts_au trigger — the implement.md review gate asks for
    insert/update/delete three-state regression, and this is the update leg.
    """
    _insert_session(db, "s-upd", file_name="upd.jsonl")
    _insert_event(db, "e-upd", "s-upd", "user_input", "originaltoken")

    assert session_dao.list_sessions(db, filter_text="originaltoken")[1] == 1
    assert session_dao.list_sessions(db, filter_text="replacedtoken")[1] == 0

    db.execute(
        "UPDATE events SET content = ? WHERE id = ?",
        ("replacedtoken", "e-upd"),
    )
    db.commit()

    sessions_old, total_old = session_dao.list_sessions(db, filter_text="originaltoken")
    sessions_new, total_new = session_dao.list_sessions(db, filter_text="replacedtoken")
    assert total_old == 0, "stale content must not remain in FTS after update"
    assert total_new == 1
    assert sessions_new[0]["id"] == "s-upd"


def test_update_event_kind_to_non_indexable_removes_fts_row(db):
    """Changing an event's kind from indexable to tool_output must drop its FTS row."""
    _insert_session(db, "s-kind", file_name="kind.jsonl")
    _insert_event(db, "e-kind", "s-kind", "user_input", "kindchangetoken")

    assert session_dao.list_sessions(db, filter_text="kindchangetoken")[1] == 1

    db.execute(
        "UPDATE events SET kind = ? WHERE id = ?",
        (_NON_INDEXABLE_KIND, "e-kind"),
    )
    db.commit()

    total = session_dao.list_sessions(db, filter_text="kindchangetoken")[1]
    assert total == 0, "FTS row must be removed when kind becomes non-indexable"


# --------------------------------------------------------------------------
# Capability-probe fallback
# --------------------------------------------------------------------------


def test_fts_unavailable_falls_back_to_like(db, monkeypatch):
    """When the probe reports FTS unavailable, a ≥3-char query still works."""
    _insert_session(db, "s-fb", file_name="fb.jsonl")
    _insert_event(db, "e-fb", "s-fb", "user_input", "fallbacktoken")

    # Force the query path to see FTS as unavailable — simulates a PyInstaller
    # build whose SQLite lacks FTS5/trigram.
    monkeypatch.setattr(
        session_dao, "probe_fts_capabilities", lambda conn=None: (False, False)
    )

    sessions, total = session_dao.list_sessions(db, filter_text="fallbacktoken")
    assert total == 1
    assert sessions[0]["id"] == "s-fb"


def test_fts_unavailable_short_query_also_likes(db, monkeypatch):
    """Short queries already use LIKE; with FTS off they still work."""
    _insert_session(db, "s-short", file_name="short.jsonl")
    _insert_event(db, "e-short", "s-short", "user_input", "重试")

    monkeypatch.setattr(
        session_dao, "probe_fts_capabilities", lambda conn=None: (False, False)
    )

    sessions, total = session_dao.list_sessions(db, filter_text="重试")
    assert total == 1
    assert sessions[0]["id"] == "s-short"


# --------------------------------------------------------------------------
# Backfill migration
# --------------------------------------------------------------------------


def test_backfill_makes_pre_existing_events_searchable(tmp_path):
    """Events inserted before FTS exists become searchable after migration."""
    from probe.storage import connection as connection_mod
    from probe.storage import schema

    # Phase 1: FTS unavailable -> schema skips events_fts + triggers entirely.
    connection_mod.reset_capability_cache()
    connection_mod._fts5_available = False
    connection_mod._trigram_available = False
    try:
        conn = open_connection(tmp_path / "backfill.sqlite")
        initialize_schema(conn)  # events_fts not created
        _insert_session(conn, "s-bf", file_name="bf.jsonl")
        _insert_event(conn, "e-bf", "s-bf", "user_input", "migrationtoken")

        # Sanity: events_fts was not created.
        with pytest.raises(Exception):
            conn.execute("SELECT COUNT(*) FROM events_fts").fetchone()

        # Phase 2: FTS now available -> run the FTS init (create + triggers +
        # backfill pre-existing events without re-importing).
        connection_mod._fts5_available = True
        connection_mod._trigram_available = True
        schema._initialize_fts(conn)
        conn.commit()

        sessions, total = session_dao.list_sessions(conn, filter_text="migrationtoken")
        assert total == 1
        assert sessions[0]["id"] == "s-bf"
    finally:
        connection_mod.reset_capability_cache()


# --------------------------------------------------------------------------
# Query-length routing: ≥3 chars FTS, 1-2 chars LIKE
# --------------------------------------------------------------------------


def test_three_char_query_hits_body_content(db):
    _insert_session(db, "s-three", file_name="three.jsonl")
    _insert_event(db, "e-three", "s-three", "assistant_output", "alphatokenbody")

    sessions, total = session_dao.list_sessions(db, filter_text="alphatokenbody")
    assert total == 1
    assert sessions[0]["id"] == "s-three"


def test_one_two_char_cjk_query_hits_body_content(db):
    """trigram is a 3-gram tokenizer; 1-2 CJK chars must fall back to LIKE."""
    _insert_session(db, "s-cjk", file_name="cjk.jsonl")
    _insert_event(db, "e-cjk", "s-cjk", "user_input", "这里写着重试的逻辑")

    sessions, total = session_dao.list_sessions(db, filter_text="重试")
    assert total == 1
    assert sessions[0]["id"] == "s-cjk"


# --------------------------------------------------------------------------
# Metadata search non-regression
# --------------------------------------------------------------------------


def test_metadata_search_still_matches(db):
    _insert_session(
        db,
        "s-meta",
        file_name="quarterly-report.jsonl",
        source_path="/codex/sessions/quarterly.jsonl",
        agent_nickname="researcher",
    )
    _insert_event(db, "e-meta", "s-meta", "user_input", "no body match here at all")

    for term in ("quarterly", "codex", "researcher"):
        sessions, total = session_dao.list_sessions(db, filter_text=term)
        assert total == 1, f"metadata term {term!r} should match"
        assert sessions[0]["id"] == "s-meta"


def test_body_match_and_metadata_match_or_together(db):
    """A session matching only metadata AND a session matching only body are
    both returned by a single search."""
    _insert_session(db, "s-body", file_name="body.jsonl")
    _insert_event(db, "e-body", "s-body", "user_input", "keyword-in-body")

    _insert_session(db, "s-keyword-file", file_name="keyword.jsonl")
    _insert_event(db, "e-irrel", "s-keyword-file", "user_input", "nothing relevant")

    sessions, total = session_dao.list_sessions(db, filter_text="keyword")
    assert total == 2
    matched = {s["id"] for s in sessions}
    assert matched == {"s-body", "s-keyword-file"}


# --------------------------------------------------------------------------
# Special-char / malicious query sanitization (failure-path: must not raise)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        '"',            # bare phrase delimiter
        '"*"',          # phrase with wildcard
        "*",            # prefix wildcard operator
        "(",            # unbalanced grouping
        ")",            # unbalanced grouping
        ":",            # column qualifier operator
        "OR",           # FTS5 boolean keyword (2 chars -> LIKE anyway)
        "AND AND",      # repeated keyword, ≥3 non-space -> FTS phrase
        'a"b"c',        # embedded quotes
        '"""',          # many quotes (sanitizes to empty)
        "* \" OR (",    # operator soup
        "重试*\"",       # CJK + operators
        "   ",          # whitespace-only
    ],
)
def test_special_chars_do_not_raise(db, query):
    _insert_session(db, "s-safe", file_name="safe.jsonl")
    _insert_event(db, "e-safe", "s-safe", "user_input", "some normal content here")

    # Must not raise fts5: syntax error (or anything else).
    sessions, total = session_dao.list_sessions(db, filter_text=query)
    assert isinstance(sessions, list)
    assert isinstance(total, int)


# --------------------------------------------------------------------------
# Empty-filter behavior unchanged
# --------------------------------------------------------------------------


def test_none_filter_returns_all_sessions(db):
    _insert_session(db, "s-1", file_name="a.jsonl")
    _insert_session(db, "s-2", file_name="b.jsonl")

    sessions, total = session_dao.list_sessions(db, filter_text=None)
    assert total == 2
    assert len(sessions) == 2


def test_empty_string_filter_returns_all_sessions(db):
    _insert_session(db, "s-1", file_name="a.jsonl")
    _insert_session(db, "s-2", file_name="b.jsonl")

    sessions, total = session_dao.list_sessions(db, filter_text="")
    assert total == 2
    assert len(sessions) == 2


# --------------------------------------------------------------------------
# Count query + sort whitelist non-regression
# --------------------------------------------------------------------------


def test_count_reflects_body_match_only(db):
    _insert_session(db, "s-match", file_name="m.jsonl")
    _insert_event(db, "e-m", "s-match", "user_input", "counttoken body")

    _insert_session(db, "s-nomatch", file_name="n.jsonl")
    _insert_event(db, "e-n", "s-nomatch", "user_input", "different content")

    _, total = session_dao.list_sessions(db, filter_text="counttoken")
    assert total == 1


def test_sort_whitelist_falls_back_on_unknown_sort(db):
    _insert_session(db, "s-1", file_name="a.jsonl")
    _insert_event(db, "e-1", "s-1", "user_input", "whatever body")

    # 'id' is not whitelisted -> must fall back to imported_at, not raise.
    sessions, total = session_dao.list_sessions(
        db, filter_text="whatever", sort_by="id; DROP TABLE sessions;--"
    )
    assert total == 1
    assert sessions[0]["id"] == "s-1"
    # Table still intact (no SQL injection via sort_by).
    rows = db.execute("SELECT COUNT(*) FROM sessions").fetchone()
    assert rows[0] == 1


# --------------------------------------------------------------------------
# Performance baseline (~100k events)
# --------------------------------------------------------------------------


def test_perf_100k_events_under_thresholds(tmp_path):
    """~100 sessions × 1000 events. Measures FTS (≥3-char rare hit) and LIKE
    (1-2-char absent, worst-case full scan) query latency against the PRD
    acceptance baseline (FTS ≤ 50ms, LIKE ≤ 300ms). A generous margin is used
    for the assertion to avoid CI flake; actuals are printed for the record."""
    from probe.storage import connection as connection_mod

    connection_mod.reset_capability_cache()
    try:
        conn = open_connection(tmp_path / "perf.sqlite")
        initialize_schema(conn)

        sessions_n = 100
        events_per = 1000
        rows = []
        rare_sessions = set()
        for s in range(sessions_n):
            sid = f"perf-{s}"
            conn.execute(
                "INSERT OR IGNORE INTO sessions (id, file_name) VALUES (?, ?)",
                (sid, f"perf-{s}.jsonl"),
            )
            for i in range(events_per):
                # Every event carries "perfmatch" (FTS all-match target, ≥3 chars).
                content = f"ab event body {s}-{i} perfmatch"
                # 5 events across 5 sessions carry a rare FTS target token.
                if s < 5 and i == 0:
                    content += " raretok"
                    rare_sessions.add(sid)
                rows.append(
                    (
                        f"e-{s}-{i}",
                        sid,
                        "user_input",
                        "2024-01-01T00:00:00Z",
                        content,
                        None,
                        i,
                    )
                )
        conn.executemany(
            """INSERT OR IGNORE INTO events
                   (id, session_id, kind, timestamp, content, metadata, source_line_no)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 100_000

        # Warm up the page cache so timed runs are realistic.
        session_dao.list_sessions(conn, filter_text="raretok")
        session_dao.list_sessions(conn, filter_text="zz")

        # FTS rare hit (≥3 chars, ~5 matches) — the acceptance baseline case.
        t0 = time.perf_counter()
        sessions_fts, total_fts = session_dao.list_sessions(conn, filter_text="raretok")
        fts_rare_ms = (time.perf_counter() - t0) * 1000

        # LIKE absent 1-2 char (no match anywhere -> full 100k scan, worst case).
        t0 = time.perf_counter()
        sessions_like, total_like = session_dao.list_sessions(conn, filter_text="zz")
        like_absent_ms = (time.perf_counter() - t0) * 1000

        # FTS all-match (100k hits) — informational worst case for the IN path.
        t0 = time.perf_counter()
        _, total_all = session_dao.list_sessions(conn, filter_text="perfmatch")
        fts_all_ms = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        _, total_none = session_dao.list_sessions(conn)
        none_ms = (time.perf_counter() - t0) * 1000

        print(
            f"\n[perf] 100k events: FTS-rare={fts_rare_ms:.1f}ms "
            f"(total={total_fts}), LIKE-absent={like_absent_ms:.1f}ms "
            f"(total={total_like}), FTS-all={fts_all_ms:.1f}ms (total={total_all}), "
            f"no-filter={none_ms:.1f}ms (total={total_none})"
        )

        assert total_fts == len(rare_sessions) == 5
        assert total_like == 0
        assert total_all == sessions_n
        assert total_none == sessions_n
        # Acceptance baseline with a 2x grace margin for CI variance.
        assert fts_rare_ms < 100, f"FTS rare query too slow: {fts_rare_ms:.1f}ms"
        assert like_absent_ms < 600, f"LIKE absent query too slow: {like_absent_ms:.1f}ms"
    finally:
        connection_mod.reset_capability_cache()
