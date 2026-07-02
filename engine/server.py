#!/usr/bin/env python3
"""Probe sidecar server — stdin/stdout JSON IPC bridge."""

import json
import logging
import signal
import sys
from pathlib import Path

# Ignore SIGPIPE so writing to a closed stdout raises BrokenPipeError
# instead of terminating the process with a signal.
if hasattr(signal, "SIGPIPE"):
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)

sys.path.insert(0, str(Path(__file__).parent))

logger = logging.getLogger(__name__)

from probe.handlers import import_handler, scan_handler, session_handler, settings_handler
from probe.storage import get_connection, initialize_schema, close_connection

HANDLERS = {
    "import_files": import_handler.handle,
    "import_files_batch": import_handler.handle_batch,
    "scan_codex_sessions": scan_handler.handle_scan_codex_sessions,
    "list_sessions": session_handler.handle_list,
    "get_session_detail": session_handler.handle_detail,
    "get_event_detail": session_handler.handle_event_detail,
    "delete_sessions": session_handler.handle_delete,
    "get_settings": settings_handler.handle_get,
    "set_settings": settings_handler.handle_set,
}


def main() -> None:
    _configure_stdio()
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
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
        except ValueError as exc:
            _write_error(req_id, "BAD_REQUEST", str(exc))
        except (KeyError, FileNotFoundError) as exc:
            _write_error(req_id, "NOT_FOUND", str(exc))
        except Exception as exc:
            logger.error("handler failed: method=%s", method, exc_info=True)
            _write_error(req_id, "INTERNAL_ERROR", str(exc))

    close_connection()


def _write_result(req_id: str | None, result: object) -> None:
    response = {"id": req_id, "result": result}
    _write_line(response)


def _write_error(req_id: str | None, code: str, message: str) -> None:
    response = {"id": req_id, "error": {"code": code, "message": message}}
    _write_line(response)


def _write_line(obj: dict) -> None:
    payload = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
    try:
        if hasattr(sys.stdout, "buffer"):
            sys.stdout.buffer.write(payload)
            sys.stdout.buffer.flush()
        else:
            sys.stdout.write(payload.decode("utf-8"))
            sys.stdout.flush()
    except BrokenPipeError:
        # Parent process closed stdout — exit cleanly.
        sys.exit(0)


def _configure_stdio() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


if __name__ == "__main__":
    main()
