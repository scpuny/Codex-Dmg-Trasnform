#!/usr/bin/env bash
set -euo pipefail

# pack-linux-arm64.sh — Build Linux ARM64 package
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

APP_PATH=""
OUTPUT_DIR=""
CHECK_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --app) APP_PATH="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --check) CHECK_ONLY=true; shift ;;
        *) [ -z "$APP_PATH" ] && APP_PATH="$1" || OUTPUT_DIR="$1"; shift ;;
    esac
done

APP_PATH="${APP_PATH:-$PROJECT_DIR/build/extracted/Codex.app}"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/packages/linux-arm64}"

# ============================================================
# 前置检查
# ============================================================
ERRORS=0
PASS() { log "  ✅ $1"; }
FAIL() { log "  ❌ $1"; ERRORS=$((ERRORS+1)); }

check_preflight() {
    log "=== Linux ARM64 前置检查 ==="
    log ""
    log "1) 原始应用 (Codex.app):"
    if [ -d "$APP_PATH" ] && [ -f "$APP_PATH/Contents/Info.plist" ]; then
        PASS "Codex.app → $APP_PATH"
        VERSION=$(get_app_version "$APP_PATH")
        log "     版本: $VERSION"
    else
        FAIL "Codex.app 未找到: $APP_PATH"
    fi

    log ""
    log "2) app.asar:"
    [ -f "$APP_PATH/Contents/Resources/app.asar" ] && PASS "app.asar ($(du -h "$APP_PATH/Contents/Resources/app.asar" | cut -f1))" || FAIL "app.asar 未找到"

    log ""
    log "3) Electron 运行时:"
    ELEC_ZIP=""
    for f in "$PROJECT_DIR/packages/linux-arm64"/electron-*-linux-arm64.zip; do
        [ -f "$f" ] && ELEC_ZIP="$f" && break
    done
    if [ -n "$ELEC_ZIP" ] && unzip -t "$ELEC_ZIP" >/dev/null 2>&1; then
        PASS "Electron zip: $(basename "$ELEC_ZIP") ($(du -h "$ELEC_ZIP" | cut -f1))"
    else
        FAIL "Electron zip 未找到或损坏"
    fi

    log ""
    log "4) Node.js 运行时:"
    NODE_ARCHIVE="$PROJECT_DIR/packages/linux-arm64/node-v24.14.0-linux-arm64.tar.xz"
    [ -f "$NODE_ARCHIVE" ] && PASS "Node.js 24.14.0 ($(du -h "$NODE_ARCHIVE" | cut -f1))" || FAIL "Node.js 归档未找到"

    log ""
    log "5) 后端二进制 (可选):"
    for bin in codex codex_chronicle; do
        src="$PROJECT_DIR/packages/linux-arm64/${bin}-linux-arm64"
        [ -f "$src" ] && PASS "$bin ($(du -h "$src" | cut -f1))" || log "    ⚠️  $bin 未提供"
    done

    echo ""
    if [ "$ERRORS" -gt 0 ]; then
        log "❌ 发现 $ERRORS 个错误，请修复后重试"
        [ "$CHECK_ONLY" = true ] && exit 1
        log "⚠️  继续打包（产物将不完整）"
    else
        log "✅ 所有前置检查通过"
    fi
    echo ""
}

check_preflight
[ "$CHECK_ONLY" = true ] && exit 0

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
if [ -d "$APP_PATH/Contents/Resources/app.asar.unpacked" ]; then
    cp -a "$APP_PATH/Contents/Resources/app.asar.unpacked" "$LINUX_DIR/resources/"
    # 移除 macOS-only .node 文件及模块
    find "$LINUX_DIR/resources/app.asar.unpacked" -name '*.node' -type f -delete 2>/dev/null || true
    rm -rf "$LINUX_DIR/resources/app.asar.unpacked/node_modules/node-mac-permissions" 2>/dev/null || true
    rm -rf "$LINUX_DIR/resources/app.asar.unpacked/node_modules/objc-js" 2>/dev/null || true
fi
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

# --- 重新编译原生 Node 模块（ARM64） ---
UNPACKED="$LINUX_DIR/resources/app.asar.unpacked/node_modules"
if [ -d "$UNPACKED" ]; then
    NODE_BIN="$CUA_DIR/bin/node"
    if [ -f "$NODE_BIN" ]; then
        log "Rebuilding native Node modules for ARM64..."
        "$NODE_BIN" -e "require('node-gyp')" 2>/dev/null || "$NODE_BIN" "$(command -v npm)" install -g node-gyp 2>/dev/null || true
        for mod_dir in "$UNPACKED"/*/; do
            mod="$(basename "$mod_dir")"
            pkg="$mod_dir/package.json"
            [ ! -f "$pkg" ] && continue
            has_native=false
            grep -q '"gypfile"' "$pkg" 2>/dev/null && has_native=true
            [ -f "$mod_dir/binding.gyp" ] && has_native=true
            grep -q '"binary"' "$pkg" 2>/dev/null && has_native=true
            if $has_native; then
                log "  Rebuilding: $mod"
                (
                    cd "$mod_dir"
                    rm -rf build/ prebuilds/ 2>/dev/null || true
                    "$NODE_BIN" "$(which node-gyp)" rebuild --arch=arm64 2>&1 | tail -3 || log "    ⚠️  $mod rebuild had warnings"
                )
            fi
        done
        log "  Native modules rebuild complete"
    fi
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
