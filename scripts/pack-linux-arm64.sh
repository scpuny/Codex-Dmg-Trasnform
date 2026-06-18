#!/usr/bin/env bash
set -euo pipefail

# pack-linux-arm64.sh — Build Linux ARM64 package
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

APP_PATH="${1:-$PROJECT_DIR/build/extracted/Codex.app}"
OUTPUT_DIR="${2:-$PROJECT_DIR/packages/linux-arm64}"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
APP_PATH="$(realpath "$APP_PATH")"
[ ! -d "$APP_PATH" ] && { log "Error: $APP_PATH not found"; exit 1; }
mkdir -p "$OUTPUT_DIR" && OUTPUT_DIR="$(realpath "$OUTPUT_DIR")"

VERSION=$(get_app_version "$APP_PATH")
log "=== Linux ARM64 Packaging (v${VERSION}) ==="

LINUX_DIR="$BUILD_DIR/Codex-linux-arm64"
mkdir -p "$LINUX_DIR/resources" "$LINUX_DIR/locales"

# --- Resources ---
cp "$APP_PATH/Contents/Resources/app.asar" "$LINUX_DIR/resources/"
[ -d "$APP_PATH/Contents/Resources/plugins" ] && cp -a "$APP_PATH/Contents/Resources/plugins" "$LINUX_DIR/resources/"
[ -d "$APP_PATH/Contents/Resources/app.asar.unpacked" ] && cp -a "$APP_PATH/Contents/Resources/app.asar.unpacked" "$LINUX_DIR/resources/"
for dir in "$APP_PATH/Contents/Resources/"*.lproj; do [ -d "$dir" ] && cp -a "$dir" "$LINUX_DIR/resources/"; done
for f in icon-codex-dark.png icon-codex-light.png codex-notification.wav; do [ -f "$APP_PATH/Contents/Resources/$f" ] && cp "$APP_PATH/Contents/Resources/$f" "$LINUX_DIR/resources/"; done

# --- Electron ---
ELEC_ZIP="$PROJECT_DIR/packages/linux-arm64/electron-${STANDARD_ELECTRON_VERSION}-linux-arm64.zip"
if [ -f "$ELEC_ZIP" ]; then
    TMP="$(mktemp -d)"; unzip -q "$ELEC_ZIP" -d "$TMP"
    [ -f "$TMP/electron" ] && cp "$TMP/electron" "$LINUX_DIR/electron" && chmod +x "$LINUX_DIR/electron"
    for f in "$TMP"/*.so*; do [ -f "$f" ] && cp "$f" "$LINUX_DIR/" 2>/dev/null || true; done
    for f in icudtl.dat snapshot_blob.bin v8_context_snapshot.bin LICENSES.chromium.html LICENSE.electron.txt; do [ -f "$TMP/$f" ] && cp "$TMP/$f" "$LINUX_DIR/" 2>/dev/null || true; done
    [ -d "$TMP/locales" ] && cp -a "$TMP/locales"/* "$LINUX_DIR/locales/"
    [ -f "$TMP/libEGL.so" ] && cp "$TMP/libEGL.so" "$LINUX_DIR/" 2>/dev/null || true
    rm -rf "$TMP"
fi

# --- Backend binaries ---
for bin in codex codex_chronicle; do
    src="$PROJECT_DIR/packages/linux-arm64/${bin}-linux-arm64"
    [ -f "$src" ] && cp "$src" "$LINUX_DIR/resources/$bin" && chmod +x "$LINUX_DIR/resources/$bin"
done

# --- Node.js ---
CUA_DIR="$LINUX_DIR/resources/cua_node"; mkdir -p "$CUA_DIR"
NODE_ARCHIVE="$PROJECT_DIR/packages/linux-arm64/node-v24.14.0-linux-arm64.tar.xz"
if [ -f "$NODE_ARCHIVE" ]; then
    tar xf "$NODE_ARCHIVE" -C "$CUA_DIR" --strip-components=1
    cat > "$CUA_DIR/manifest.json" <<JSON
{"platform":"linux","arch":"arm64","target":"linux-arm64","node_version":"24.14.0"}
JSON
fi

# --- Icon ---
if [ -f "$APP_PATH/Contents/Resources/icon.png" ]; then
    cp "$APP_PATH/Contents/Resources/icon.png" "$LINUX_DIR/Codex.png"
fi

# --- Launcher ---
cat > "$LINUX_DIR/Codex.sh" << 'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$DIR/electron"
[ ! -f "$ELECTRON" ] && { echo "Error: Electron not found at $ELECTRON" >&2; exit 1; }
[ ! -f "$DIR/resources/app.asar" ] && { echo "Error: app.asar not found" >&2; exit 1; }
export ELECTRON_IS_DEV=0
exec "$ELECTRON" "$DIR/resources/app.asar" "$@"
LAUNCHER
chmod +x "$LINUX_DIR/Codex.sh"

# --- .deb ---
if command -v dpkg-deb &>/dev/null; then
    DEB_DIR="$BUILD_DIR/deb"
    mkdir -p "$DEB_DIR/DEBIAN" "$DEB_DIR/opt/Codex" "$DEB_DIR/usr/share/applications" "$DEB_DIR/usr/share/icons/hicolor/1024x1024/apps"
    cp -a "$LINUX_DIR"/* "$DEB_DIR/opt/Codex/"
    rm -f "$DEB_DIR/opt/Codex/Codex.desktop"
    cat > "$DEB_DIR/usr/share/applications/Codex.desktop" << DESKTOP
[Desktop Entry]
Name=Codex
Comment=AI-powered coding assistant by OpenAI
Exec=/opt/Codex/Codex.sh
Icon=Codex
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=Codex
DESKTOP
    [ -f "$APP_PATH/Contents/Resources/icon.png" ] && cp "$APP_PATH/Contents/Resources/icon.png" "$DEB_DIR/usr/share/icons/hicolor/1024x1024/apps/Codex.png"
    cat > "$DEB_DIR/DEBIAN/control" << CONTROL
Package: Codex
Version: ${VERSION}-1
Section: development
Priority: optional
Architecture: arm64
Maintainer: OpenAI <support@openai.com>
Description: Codex - AI-powered coding assistant
Depends: libc6 (>= 2.31), libstdc++6 (>= 10)
CONTROL
    dpkg-deb --build "$DEB_DIR" "$OUTPUT_DIR/Codex_${VERSION}_arm64.deb" 2>/dev/null
fi

# --- Archive ---
tar czf "$OUTPUT_DIR/Codex-${VERSION}-linux-arm64.tar.gz" -C "$BUILD_DIR" "$(basename "$LINUX_DIR")"
log "=== Linux ARM64 complete ==="
ls -lh "$OUTPUT_DIR/"
