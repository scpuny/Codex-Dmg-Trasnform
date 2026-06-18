#!/usr/bin/env bash
set -euo pipefail

# info.sh — Print version and platform info from extracted Codex.app
# Usage: ./scripts/info.sh [--app path/to/Codex.app]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

APP_PATH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --app) APP_PATH="$2"; shift 2 ;;
        *) APP_PATH="$1"; shift ;;
    esac
done

APP_PATH="${APP_PATH:-$PROJECT_DIR/build/extracted/Codex.app}"

if [ ! -d "$APP_PATH" ]; then
    echo "Error: Codex.app not found at $APP_PATH" >&2
    echo "Extract first: ./scripts/extract.sh" >&2
    exit 1
fi

echo "=========================================="
echo "  Codex.app Information"
echo "=========================================="

PLIST="$APP_PATH/Contents/Info.plist"

if [ -f "$PLIST" ]; then
    echo ""
    echo "--- Info.plist ---"
    python3 -c "
import plistlib, json
with open('$PLIST', 'rb') as f:
    d = plistlib.load(f)
interesting_keys = [
    'CFBundleShortVersionString', 'CFBundleVersion',
    'CFBundleIdentifier', 'CFBundleName', 'CFBundleDisplayName',
    'LSMinimumSystemVersion', 'CFBundleExecutable',
    'ElectronAsarIntegrity', 'CrProductDirName',
]
for k in interesting_keys:
    if k in d:
        v = d[k]
        if isinstance(v, dict):
            v = json.dumps(v)
        print(f'  {k}: {v}')
"
else
    echo "  Info.plist not found"
fi

echo ""
echo "--- Key Binaries ---"
MAIN_BIN="$APP_PATH/Contents/MacOS/Codex"
[ -f "$MAIN_BIN" ] && echo "  MacOS/Codex: $(file "$MAIN_BIN" | cut -d: -f2-)"

for bin in codex codex_chronicle; do
    b="$APP_PATH/Contents/Resources/$bin"
    if [ -f "$b" ]; then
        size=$(du -h "$b" | cut -f1)
        info=$(file "$b" | cut -d: -f2-)
        echo "  Resources/$bin: $info ($size)"
    fi
done

NODE_BIN="$APP_PATH/Contents/Resources/cua_node/bin/node"
if [ -f "$NODE_BIN" ]; then
    size=$(du -h "$NODE_BIN" | cut -f1)
    echo "  cua_node/bin/node: $(file "$NODE_BIN" | cut -d: -f2-) ($size)"
fi

echo ""
echo "--- App Sizes ---"
echo "  Total: $(du -sh "$APP_PATH" | cut -f1)"
echo "  app.asar: $(du -h "$APP_PATH/Contents/Resources/app.asar" 2>/dev/null | cut -f1)"

echo ""
echo "--- Native Modules ---"
UNPACKED="$APP_PATH/Contents/Resources/app.asar.unpacked/node_modules"
if [ -d "$UNPACKED" ]; then
    for mod in "$UNPACKED"/*/; do
        echo "  $(basename "$mod")"
    done
fi

echo ""
echo "=========================================="
