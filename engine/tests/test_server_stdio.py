from __future__ import annotations

import io
import json
import types

import server


def test_write_line_emits_utf8_json(monkeypatch) -> None:
    buffer = io.BytesIO()
    fake_stdout = types.SimpleNamespace(buffer=buffer)
    monkeypatch.setattr(server.sys, "stdout", fake_stdout)

    server._write_line({
        "id": "req-1",
        "result": {"title": "中文 ✓"},
    })

    payload = buffer.getvalue()
    assert payload.endswith(b"\n")

    decoded = json.loads(payload.decode("utf-8"))
    assert decoded["result"]["title"] == "中文 ✓"
