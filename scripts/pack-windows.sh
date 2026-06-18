#!/usr/bin/env bash
set -euo pipefail

# pack-windows.sh — Build Windows x64 package
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

APP_PATH="${1:-$PROJECT_DIR/build/extracted/Codex.app}"
OUTPUT_DIR="${2:-$PROJECT_DIR/packages/windows}"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
APP_PATH="$(realpath "$APP_PATH")"
[ ! -d "$APP_PATH" ] && { log "Error: $APP_PATH not found"; exit 1; }
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(realpath "$OUTPUT_DIR")"
VERSION=$(get_app_version "$APP_PATH")
log "=== Windows x64 Packaging (v${VERSION}) ==="

WIN_DIR="$BUILD_DIR/Codex-win32-x64"
mkdir -p "$WIN_DIR/resources" "$WIN_DIR/locales"

# Platform-agnostic resources
cp "$APP_PATH/Contents/Resources/app.asar" "$WIN_DIR/resources/"
[ -d "$APP_PATH/Contents/Resources/plugins" ] && cp -a "$APP_PATH/Contents/Resources/plugins" "$WIN_DIR/resources/"
[ -d "$APP_PATH/Contents/Resources/app.asar.unpacked" ] && cp -a "$APP_PATH/Contents/Resources/app.asar.unpacked" "$WIN_DIR/resources/"
for dir in "$APP_PATH/Contents/Resources/"*.lproj; do [ -d "$dir" ] && cp -a "$dir" "$WIN_DIR/resources/"; done
for f in icon-codex-dark.png icon-codex-light.png codex-notification.wav; do [ -f "$APP_PATH/Contents/Resources/$f" ] && cp "$APP_PATH/Contents/Resources/$f" "$WIN_DIR/resources/"; done

# Electron for Windows
ELEC_ZIP="$PROJECT_DIR/packages/windows/electron-${STANDARD_ELECTRON_VERSION}-win32-x64.zip"
if [ -f "$ELEC_ZIP" ]; then
    TMP="$(mktemp -d)"; unzip -q "$ELEC_ZIP" -d "$TMP"
    cp -a "$TMP"/* "$WIN_DIR/" 2>/dev/null || true
    [ -f "$WIN_DIR/electron.exe" ] && mv "$WIN_DIR/electron.exe" "$WIN_DIR/Codex.exe"
    rm -rf "$TMP"
fi

# Platform binaries
for bin in codex codex_chronicle; do
    for ext in "" .exe; do
        src="$PROJECT_DIR/packages/windows/${bin}-win32-x64${ext}"
        [ -f "$src" ] && cp "$src" "$WIN_DIR/resources/${bin}.exe" && chmod +x "$WIN_DIR/resources/${bin}.exe" && break
    done
done

# Node.js
CUA_DIR="$WIN_DIR/resources/cua_node"; mkdir -p "$CUA_DIR"
NODE_ZIP="$PROJECT_DIR/packages/windows/node-v24.14.0-win-x64.zip"
if [ -f "$NODE_ZIP" ]; then
    TMP="$(mktemp -d)"; unzip -q "$NODE_ZIP" -d "$TMP"
    mv "$TMP"/*/* "$CUA_DIR/" 2>/dev/null || mv "$TMP"/* "$CUA_DIR/" 2>/dev/null || true
    rm -rf "$TMP"
    cat > "$CUA_DIR/manifest.json" <<JSON
{"platform":"win32","arch":"x64","target":"win32-x64","node_version":"24.14.0"}
JSON
fi

# Launcher
cat > "$WIN_DIR/Codex.bat" << 'BAT'
@echo off
set ELECTRON_IS_DEV=0
start "" "%~dp0Codex.exe" "%~dp0resources\app.asar" %*
BAT

# Portable ZIP — prefer 7z, fall back to zip or PowerShell Compress-Archive
# On Windows (Git Bash), ensure 7z is in PATH
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    export PATH="$PATH:/c/Program Files/7-Zip:/c/Program Files/7-Zip/:/c/Program Files (x86)/7-Zip:/c/Program Files (x86)/7-Zip/"
    ;;
esac

if command -v 7z &>/dev/null; then
    (cd "$BUILD_DIR" && 7z a "$OUTPUT_DIR/Codex-${VERSION}-win32-x64-portable.zip" "$(basename "$WIN_DIR")" > /dev/null 2>&1)
elif command -v zip &>/dev/null; then
    (cd "$BUILD_DIR" && zip -qr "$OUTPUT_DIR/Codex-${VERSION}-win32-x64-portable.zip" "$(basename "$WIN_DIR")")
elif command -v pwsh &>/dev/null; then
    pwsh -NoProfile -Command "Compress-Archive -Path '$BUILD_DIR/$(basename "$WIN_DIR")' -DestinationPath '$OUTPUT_DIR/Codex-${VERSION}-win32-x64-portable.zip' -Force"
elif command -v powershell &>/dev/null; then
    powershell -NoProfile -Command "Compress-Archive -Path '$BUILD_DIR/$(basename "$WIN_DIR")' -DestinationPath '$OUTPUT_DIR/Codex-${VERSION}-win32-x64-portable.zip' -Force"
else
    log "Error: no archiving tool found (7z, zip, or powershell)"
    exit 1
fi
log "=== Windows complete ==="
ls -lh "$OUTPUT_DIR/"
