#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_ROOT="$ROOT_DIR/tauri/target"
PORT="3000"
VITE_PORT="1420"
SERVER_PID=""
DEV_CONFIG_PATH="$ROOT_DIR/tauri/.tmp.dev-updater.conf.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--artifact-root)
      ARTIFACT_ROOT="$2"
      shift 2
      ;;
    -p|--port)
      PORT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

require_free_port() {
  local port="$1"
  local label="$2"

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$label port $port is already in use." >&2
    echo "Stop the existing process first, then rerun scripts/dev-updater-smoke.sh." >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$DEV_CONFIG_PATH"
}

trap cleanup EXIT INT TERM

require_free_port "$PORT" "Local updater server"
require_free_port "$VITE_PORT" "Vite dev server"

# Keep updater smoke tests on the localhost override so dev runs never hit production metadata.
"$ROOT_DIR/scripts/dev-update-server.sh" \
  --port "$PORT" \
  --artifact-root "$ARTIFACT_ROOT" &
SERVER_PID="$!"

sleep 1
if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  wait "$SERVER_PID"
fi

python3 - <<PY
import json
from pathlib import Path

root = Path(r"$ROOT_DIR")
base = json.loads((root / "tauri/tauri.dev-updater.conf.json").read_text())
base["plugins"]["updater"]["endpoints"] = [f"http://localhost:{int($PORT)}/latest.json"]
(root / "tauri/.tmp.dev-updater.conf.json").write_text(json.dumps(base, indent=2) + "\n")
PY

cd "$ROOT_DIR/tauri"
cargo tauri dev --config .tmp.dev-updater.conf.json
