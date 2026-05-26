"""Rule result CRUD operations."""

from __future__ import annotations

import json
import sqlite3
from typing import Any


def insert(conn: sqlite3.Connection, result: dict[str, Any]) -> None:
    evidence = result.get("evidence")
    if evidence is not None and not isinstance(evidence, str):
        evidence = json.dumps(evidence, ensure_ascii=False)
    conn.execute(
        """INSERT OR IGNORE INTO rule_results
               (id, session_id, event_id, rule_id, rule_type, severity, message, evidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            result["id"],
            result["session_id"],
            result.get("event_id"),
            result.get("rule_id"),
            result.get("rule_type"),
            result.get("severity"),
            result.get("message"),
            evidence,
        ),
    )


def insert_many(conn: sqlite3.Connection, results: list[dict[str, Any]]) -> None:
    for result in results:
        insert(conn, result)


def get_by_session_id(
    conn: sqlite3.Connection,
    session_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM rule_results WHERE session_id = ? ORDER BY created_at",
        (session_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def delete_by_session_id(conn: sqlite3.Connection, session_id: str) -> None:
    conn.execute("DELETE FROM rule_results WHERE session_id = ?", (session_id,))


def list_results(
    conn: sqlite3.Connection,
    *,
    session_id: str | None = None,
    rule_type: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    where_clauses: list[str] = []
    params: list[Any] = []
    if session_id:
        where_clauses.append("session_id = ?")
        params.append(session_id)
    if rule_type:
        where_clauses.append("rule_type = ?")
        params.append(rule_type)
    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    rows = conn.execute(
        f"SELECT * FROM rule_results{where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    return [dict(r) for r in rows]
