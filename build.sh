#!/usr/bin/env bash
set -euo pipefail

# Build script for Probe desktop app (macOS DMG).
# Usage:
#   ./build.sh                   — full build for host architecture
#   ./build.sh --target <triple> — full build for a specific target
#   ./build.sh sidecar           — build Python sidecar only
#   ./build.sh frontend          — build frontend only
#   ./build.sh tauri             — build Tauri app only (assumes sidecar + frontend done)
#
# Examples:
#   ./build.sh                                # host arch (e.g. aarch64-apple-darwin)
#   ./build.sh --target x86_64-apple-darwin   # Intel build (via Rosetta on Apple Silicon)
#   ./build.sh --target aarch64-apple-darwin  # Apple Silicon build (explicit)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/engine"
TAURI_DIR="$SCRIPT_DIR/tauri"

# Parse --target flag
CARGO_TARGET=""
PYINSTALLER_ARCH=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            CARGO_TARGET="$2"
            shift 2
            ;;
        sidecar|frontend|tauri|all)
            BUILD_STEP="$1"
            shift
            ;;
        *)
            echo "Usage: $0 [--target <triple>] [sidecar|frontend|tauri|all]"
            exit 1
            ;;
    esac
done
BUILD_STEP="${BUILD_STEP:-all}"

# Resolve target triple and sidecar name
if [[ -n "$CARGO_TARGET" ]]; then
    TARGET_TRIPLE="$CARGO_TARGET"
else
    TARGET_TRIPLE="$(rustc -vV 2>/dev/null | grep '^host:' | awk '{print $2}')"
fi
SIDECAR_NAME="probe-engine-${TARGET_TRIPLE}"

# Determine PyInstaller invocation prefix (Rosetta for x86_64 on Apple Silicon)
if [[ "$TARGET_TRIPLE" == "x86_64-apple-darwin" && "$(uname -m)" == "arm64" ]]; then
    PYINSTALLER_PREFIX=(arch -x86_64)
    log_prefix="[build] Intel target on Apple Silicon — using Rosetta 2"
else
    PYINSTALLER_PREFIX=()
    log_prefix=""
fi

log() {
    echo "[build] $*"
}

build_sidecar() {
    log "Building Python sidecar ($SIDECAR_NAME) ..."
    [[ -n "$log_prefix" ]] && log "$log_prefix"

    if ! command -v pyinstaller &>/dev/null; then
        log "ERROR: pyinstaller not found. Install with: pip install pyinstaller"
        exit 1
    fi

    (
        cd "$ENGINE_DIR"
        "${PYINSTALLER_PREFIX[@]}" pyinstaller probe.spec --noconfirm --clean --distpath dist 2>&1
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
    log "Building Tauri app (target: $TARGET_TRIPLE) ..."
    local cargo_args=(build)
    if [[ -n "$CARGO_TARGET" ]]; then
        cargo_args+=(--target "$CARGO_TARGET")
    fi
    cd "$TAURI_DIR" && cargo tauri "${cargo_args[@]}" 2>&1
    log "Tauri build complete."
}

report() {
    local bundle_dir="$TAURI_DIR/target/release/bundle/dmg"
    if [[ -n "$CARGO_TARGET" ]]; then
        bundle_dir="$TAURI_DIR/target/$CARGO_TARGET/release/bundle/dmg"
    fi
    local glob="$bundle_dir/*.dmg"
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
    log "Target: $TARGET_TRIPLE | Step: $BUILD_STEP"
    case "$BUILD_STEP" in
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
            echo "Usage: $0 [--target <triple>] [sidecar|frontend|tauri|all]"
            exit 1
            ;;
    esac
}

main
