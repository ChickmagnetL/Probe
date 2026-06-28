#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_ROOT="$ROOT_DIR/tauri/target"
SERVE_DIR="$ROOT_DIR/.test_tools/updater-server"
PORT="3000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      PORT="$2"
      shift 2
      ;;
    -a|--artifact-root)
      ARTIFACT_ROOT="$2"
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

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Updater server port $port is already in use." >&2
    echo "Stop the existing process or rerun with --port <free-port>." >&2
    echo "Example: bash scripts/dev-update-server.sh --port 3300" >&2
    exit 1
  fi
}

require_free_port "$PORT"

rm -rf "$SERVE_DIR"
mkdir -p "$SERVE_DIR"

copied_any="false"
while IFS= read -r file; do
  cp "$file" "$SERVE_DIR/$(basename "$file")"
  copied_any="true"
done < <(
  find "$ARTIFACT_ROOT" -type f \
    \( -path '*/bundle/macos/*.app.tar.gz' \
    -o -path '*/bundle/macos/*.app.tar.gz.sig' \
    -o -path '*/bundle/nsis/*.exe' \
    -o -path '*/bundle/nsis/*.exe.sig' \) \
    | sort
)

if [[ "$copied_any" != "true" ]]; then
  echo "No updater artifacts found under $ARTIFACT_ROOT." >&2
  echo "Build signed updater artifacts first, then rerun this server." >&2
  exit 1
fi

node "$ROOT_DIR/scripts/generate-updater-json.mjs" \
  --artifact-dir "$SERVE_DIR" \
  --version "99.0.0" \
  --notes "Local updater smoke-test fixture" \
  --pub-date "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --url-prefix "http://localhost:${PORT}"

cd "$SERVE_DIR"
python3 -m http.server "$PORT"
