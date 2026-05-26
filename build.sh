#!/usr/bin/env bash
set -euo pipefail

# Build script for Probe desktop app (macOS DMG).
# Usage:
#   ./build.sh          — full build (sidecar + frontend + tauri)
#   ./build.sh sidecar  — build Python sidecar only
#   ./build.sh frontend — build frontend only
#   ./build.sh tauri    — build Tauri app only (assumes sidecar + frontend done)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/engine"
TAURI_DIR="$SCRIPT_DIR/tauri"

TARGET_TRIPLE="$(rustc -vV 2>/dev/null | grep '^host:' | awk '{print $2}')"
SIDECAR_NAME="probe-engine-${TARGET_TRIPLE}"

log() {
    echo "[build] $*"
}

build_sidecar() {
    log "Building Python sidecar ($SIDECAR_NAME) ..."

    if ! command -v pyinstaller &>/dev/null; then
        log "ERROR: pyinstaller not found. Install with: pip install pyinstaller"
        exit 1
    fi

    (
        cd "$ENGINE_DIR"
        pyinstaller probe.spec --noconfirm --clean --distpath dist 2>&1
    )

    local src="$ENGINE_DIR/dist/probe-engine"
    local dst="$TAURI_DIR/$SIDECAR_NAME"

    if [[ ! -f "$src" ]]; then
        log "ERROR: PyInstaller output not found at $src"
        exit 1
    fi

    cp "$src" "$dst"
    chmod +x "$dst"
    log "Sidecar binary: $dst"
}

build_frontend() {
    log "Building frontend ..."
    npm run build --prefix "$SCRIPT_DIR/frontend"
    log "Frontend built."
}

build_tauri() {
    log "Building Tauri app ..."
    cd "$TAURI_DIR" && cargo tauri build 2>&1
    log "Tauri build complete."
}

report() {
    local glob="$TAURI_DIR/target/release/bundle/dmg/*.dmg"
    # shellcheck disable=SC2086
    local dmg
    dmg=$(ls $glob 2>/dev/null | head -1)
    if [[ -n "$dmg" ]]; then
        log "DMG output: $dmg"
    else
        log "WARNING: DMG not found at $glob"
    fi
}

main() {
    local target="${1:-all}"
    case "$target" in
        sidecar)  build_sidecar ;;
        frontend) build_frontend ;;
        tauri)    build_tauri ;;
        all)
            build_sidecar
            build_frontend
            build_tauri
            report
            ;;
        *)
            echo "Usage: $0 [sidecar|frontend|tauri|all]"
            exit 1
            ;;
    esac
}

main "$@"
