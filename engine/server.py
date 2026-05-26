#!/usr/bin/env python3
"""Probe sidecar server — stdin/stdout JSON IPC bridge."""

import json
import signal
import sys
from pathlib import Path

# Ignore SIGPIPE so writing to a closed stdout raises BrokenPipeError
# instead of terminating the process with a signal.
signal.signal(signal.SIGPIPE, signal.SIG_DFL)

sys.path.insert(0, str(Path(__file__).parent))

from probe.handlers import import_handler, session_handler
from probe.storage import get_connection, initialize_schema, close_connection

HANDLERS = {
    "import_files": import_handler.handle,
    "list_sessions": session_handler.handle_list,
    "get_session_detail": session_handler.handle_detail,
    "delete_sessions": session_handler.handle_delete,
}


def main() -> None:
    conn = get_connection()
    initialize_schema(conn)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_error(None, "PARSE_ERROR", str(exc))
            continue

        req_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})

        if method not in HANDLERS:
            _write_error(req_id, "METHOD_NOT_FOUND", f"unknown method: {method}")
            continue

        try:
            result = HANDLERS[method](params)
            _write_result(req_id, result)
        except Exception as exc:
            _write_error(req_id, "INTERNAL_ERROR", str(exc))

    close_connection()


def _write_result(req_id: str | None, result: object) -> None:
    response = {"id": req_id, "result": result}
    _write_line(response)


def _write_error(req_id: str | None, code: str, message: str) -> None:
    response = {"id": req_id, "error": {"code": code, "message": message}}
    _write_line(response)


def _write_line(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        # Parent process closed stdout — exit cleanly.
        sys.exit(0)


if __name__ == "__main__":
    main()
