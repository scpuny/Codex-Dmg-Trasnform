#!/usr/bin/env bash
set -euo pipefail

# rebuild-native-modules.sh — Rebuild native Node modules for a target arch
# Usage: ./scripts/rebuild-native-modules.sh --app path/Codex.app --arch [x64|arm64]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

APP_PATH=""
TARGET_ARCH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --app) APP_PATH="$2"; shift 2 ;;
        --arch) TARGET_ARCH="$2"; shift 2 ;;
        *) log "Unknown: $1"; exit 1 ;;
    esac
done

[ -z "$APP_PATH" ] || [ -z "$TARGET_ARCH" ] && {
    echo "Usage: $0 --app path/Codex.app --arch [x64|arm64]"
    exit 1
}

APP_PATH="$(realpath "$APP_PATH")"
UNPACKED="$APP_PATH/Contents/Resources/app.asar.unpacked/node_modules"
[ ! -d "$UNPACKED" ] && { log "No unpacked node_modules at $UNPACKED"; exit 0; }

log "=== Rebuilding native modules for $TARGET_ARCH ==="

# Find Node binary
NODE_BIN=""
for candidate in "$APP_PATH/Contents/Resources/cua_node/bin/node" "$(command -v node)"; do
    [ -f "$candidate" ] && { NODE_BIN="$candidate"; break; }
done
[ -z "$NODE_BIN" ] && { log "Error: No Node.js found"; exit 1; }

log "Using Node.js: $("$NODE_BIN" --version)"

# Ensure node-gyp
"$NODE_BIN" -e "require('node-gyp')" 2>/dev/null || npm install -g node-gyp 2>/dev/null || true

pushd "$UNPACKED" >/dev/null
for mod_dir in */; do
    mod="${mod_dir%/}"
    pkg="$mod_dir/package.json"
    [ ! -f "$pkg" ] && continue

    # Check if native
    has_native=false
    grep -q '"gypfile"' "$pkg" 2>/dev/null && has_native=true
    [ -f "$mod_dir/binding.gyp" ] && has_native=true
    grep -q '"binary"' "$pkg" 2>/dev/null && has_native=true

    if $has_native; then
        log "  Rebuilding: $mod"
        (
            cd "$mod_dir"
            rm -rf build/ prebuilds/ 2>/dev/null || true
            "$NODE_BIN" "$(which node-gyp)" rebuild --arch="$TARGET_ARCH" 2>&1 | tail -2 || log "  Warning: $mod rebuild failed"
        )
    fi
done
popd >/dev/null
log "=== Rebuild complete ==="
