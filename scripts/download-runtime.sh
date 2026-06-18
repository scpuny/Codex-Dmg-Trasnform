#!/usr/bin/env bash
set -euo pipefail

# download-runtime.sh — Download platform-specific runtime binaries
# Usage: ./scripts/download-runtime.sh --platform [darwin|linux|win32] --arch [x64|arm64]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PLATFORM=""
ARCH=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform) PLATFORM="$2"; shift 2 ;;
        --arch) ARCH="$2"; shift 2 ;;
        --output) OUTPUT_DIR="$2"; shift 2 ;;
        *) log "Unknown: $1"; exit 1 ;;
    esac
done

[ -z "$PLATFORM" ] || [ -z "$ARCH" ] && {
    echo "Usage: $0 --platform [darwin|linux|win32] --arch [x64|arm64] [--output dir]"
    exit 1
}

OUTPUT_DIR="${OUTPUT_DIR:-$(realpath "$SCRIPT_DIR/../packages/${PLATFORM}-${ARCH}")}"
mkdir -p "$OUTPUT_DIR"

log "=== Downloading runtimes for ${PLATFORM}-${ARCH} ==="
log "Output: $OUTPUT_DIR"

# Map platform/arch to Electron & Node.js conventions
case "${PLATFORM}-${ARCH}" in
    darwin-x64)  ELEC_PLAT="darwin-x64";  NODE_PLAT="darwin-x64"  ;;
    darwin-arm64) ELEC_PLAT="darwin-arm64"; NODE_PLAT="darwin-arm64" ;;
    linux-x64)   ELEC_PLAT="linux-x64";   NODE_PLAT="linux-x64"   ;;
    linux-arm64) ELEC_PLAT="linux-arm64"; NODE_PLAT="linux-arm64" ;;
    win32-x64)   ELEC_PLAT="win32-x64";   NODE_PLAT="win-x64"     ;;
    *) log "Unknown target: ${PLATFORM}-${ARCH}"; exit 1 ;;
esac

# Download Electron (standard build, not the custom OpenAI one)
ELEC_FILE="$OUTPUT_DIR/electron-${STANDARD_ELECTRON_VERSION}-${ELEC_PLAT}.zip"

log "Electron ${STANDARD_ELECTRON_VERSION} for ${ELEC_PLAT}..."
if [ ! -f "$ELEC_FILE" ]; then
    ELEC_OFFICIAL_URL=$(get_electron_url "$STANDARD_ELECTRON_VERSION" "$PLATFORM" "$ARCH")
    ELEC_MIRROR_URL=$(get_electron_mirror_url "$STANDARD_ELECTRON_VERSION" "$PLATFORM" "$ARCH")
    if ! download_with_mirror_fallback "$ELEC_MIRROR_URL" "$ELEC_OFFICIAL_URL" "$ELEC_FILE" "Electron ${STANDARD_ELECTRON_VERSION}"; then
        log "  Error: Electron download failed" >&2
        exit 1
    fi
    # Verify it's a valid zip
    if ! unzip -t "$ELEC_FILE" >/dev/null 2>&1; then
        log "  Error: Downloaded file is not a valid zip" >&2
        rm -f "$ELEC_FILE"
        exit 1
    fi
    log "  ✅ Electron zip verified"
else
    log "  Already cached: $(basename "$ELEC_FILE")"
fi

# Download Node.js
NODE_VERSION="24.14.0"
case "$PLATFORM" in
    darwin) NODE_OS="darwin" ;;
    linux)  NODE_OS="linux"  ;;
    win32)  NODE_OS="win"    ;;
esac

NODE_FILE="$OUTPUT_DIR/node-v${NODE_VERSION}-${NODE_PLAT}.tar.xz"
[ "$PLATFORM" = "win32" ] && NODE_FILE="$OUTPUT_DIR/node-v${NODE_VERSION}-${NODE_PLAT}.zip"

log "Node.js ${NODE_VERSION} for ${NODE_PLAT}..."
if [ ! -f "$NODE_FILE" ]; then
    NODE_OFFICIAL_URL=$(get_nodejs_url "$NODE_VERSION" "$NODE_OS" "$ARCH")
    NODE_MIRROR_URL=$(get_nodejs_mirror_url "$NODE_VERSION" "$NODE_OS" "$ARCH")
    download_with_mirror_fallback "$NODE_MIRROR_URL" "$NODE_OFFICIAL_URL" "$NODE_FILE" "Node.js ${NODE_VERSION}" || \
        log "  ⚠️  Node.js download had issues (will use cached or skip if unavailable)"
else
    log "  Already cached: $(basename "$NODE_FILE")"
fi

log "=== Download complete ==="
ls -lh "$OUTPUT_DIR/" 2>/dev/null
