#!/usr/bin/env bash
set -euo pipefail

# pack-macos-x64.sh — Build macOS Intel (x86_64) package
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

APP_PATH="${1:-$PROJECT_DIR/build/extracted/Codex.app}"
OUTPUT_DIR="${2:-$PROJECT_DIR/packages/macos-x64}"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
APP_PATH="$(realpath "$APP_PATH")"
[ ! -d "$APP_PATH" ] && { log "Error: $APP_PATH not found"; exit 1; }
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(realpath "$OUTPUT_DIR")"
VERSION=$(get_app_version "$APP_PATH")
log "=== macOS Intel x86_64 Packaging (v${VERSION}) ==="

# Copy the full .app bundle
rsync -a --delete --exclude='.DS_Store' "$APP_PATH/" "$BUILD_DIR/Codex.app/"

# --- Replace Electron Framework (ARM64 -> x64) ---
ELEC_ZIP="$PROJECT_DIR/packages/macos-x64/electron-${STANDARD_ELECTRON_VERSION}-darwin-x64.zip"
if [ -f "$ELEC_ZIP" ]; then
    log "Replacing Electron framework with x64 version..."
    TMP_ELEC="$(mktemp -d)"
    unzip -q "$ELEC_ZIP" -d "$TMP_ELEC"
    # Electron zip for macOS contains Electron.app which has the framework inside
    if [ -d "$TMP_ELEC/Electron.app" ]; then
        FRAMEWORKS_SRC="$TMP_ELEC/Electron.app/Contents/Frameworks"
        FRAMEWORKS_DST="$BUILD_DIR/Codex.app/Contents/Frameworks"
        if [ -d "$FRAMEWORKS_SRC" ]; then
            # Replace Electron Framework (the main one)
            rm -rf "$FRAMEWORKS_DST/Electron Framework.framework" 2>/dev/null || true
            cp -a "$FRAMEWORKS_SRC/Electron Framework.framework" "$FRAMEWORKS_DST/" 2>/dev/null || true
            log "  Electron framework replaced"
        fi
        # Also replace the MacOS/Codex binary
        MACOS_SRC="$TMP_ELEC/Electron.app/Contents/MacOS/Electron"
        MACOS_DST="$BUILD_DIR/Codex.app/Contents/MacOS/Codex"
        if [ -f "$MACOS_SRC" ]; then
            cp "$MACOS_SRC" "$MACOS_DST"
            chmod +x "$MACOS_DST"
            log "  Main executable replaced"
        fi
    fi
    rm -rf "$TMP_ELEC"
fi

# Replace platform-specific binaries
for bin in codex codex_chronicle; do
    src="$PROJECT_DIR/packages/macos-x64/${bin}-x64"
    [ -f "$src" ] && cp "$src" "$BUILD_DIR/Codex.app/Contents/Resources/$bin" && chmod +x "$BUILD_DIR/Codex.app/Contents/Resources/$bin"
done

# Replace cua_node runtime
CUA_ARCHIVE="$PROJECT_DIR/packages/macos-x64/node-v24.14.0-darwin-x64.tar.xz"
if [ -f "$CUA_ARCHIVE" ]; then
    rm -rf "$BUILD_DIR/Codex.app/Contents/Resources/cua_node"
    mkdir -p "$BUILD_DIR/Codex.app/Contents/Resources/cua_node"
    tar xf "$CUA_ARCHIVE" -C "$BUILD_DIR/Codex.app/Contents/Resources/cua_node" --strip-components=1
    python3 -c "import json; d=json.load(open('$BUILD_DIR/Codex.app/Contents/Resources/cua_node/manifest.json')); d['arch']='x64'; d['target']='darwin-x64'; json.dump(d, open('$BUILD_DIR/Codex.app/Contents/Resources/cua_node/manifest.json','w'),indent=2)" 2>/dev/null || cat > "$BUILD_DIR/Codex.app/Contents/Resources/cua_node/manifest.json" <<JSON
{"platform":"darwin","arch":"x64","target":"darwin-x64","node_version":"24.14.0"}
JSON
fi

# Create .dmg
if command -v create-dmg &>/dev/null; then
    DMG_PATH="$OUTPUT_DIR/Codex-${VERSION}-macos-x64.dmg"
    create-dmg --volname "Codex" --window-pos 200 120 --window-size 800 400 --icon-size 100 \
        --icon "Codex.app" 200 190 --app-drop-link 600 185 "$DMG_PATH" "$BUILD_DIR/Codex.app" 2>/dev/null || \
    hdiutil create -volname "Codex" -srcfolder "$BUILD_DIR/Codex.app" -ov -format UDZO "$DMG_PATH" 2>/dev/null
elif command -v hdiutil &>/dev/null; then
    hdiutil create -volname "Codex" -srcfolder "$BUILD_DIR/Codex.app" -ov -format UDZO "$OUTPUT_DIR/Codex-${VERSION}-macos-x64.dmg"
fi

# Archive fallback
tar czf "$OUTPUT_DIR/Codex-${VERSION}-macos-x64.tar.gz" -C "$BUILD_DIR" "Codex.app"

log "=== macOS Intel complete ==="
ls -lh "$OUTPUT_DIR/"
