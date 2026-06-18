#!/usr/bin/env bash
set -euo pipefail

# pack-windows.sh — Build Windows x64 package
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
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/packages/windows}"

# ============================================================
# 前置检查
# ============================================================
ERRORS=0
PASS() { log "  ✅ $1"; }
FAIL() { log "  ❌ $1"; ERRORS=$((ERRORS+1)); }

check_preflight() {
    log "=== Windows x64 前置检查 ==="
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
    for f in "$PROJECT_DIR/packages/windows"/electron-*-win32-x64.zip; do
        [ -f "$f" ] && ELEC_ZIP="$f" && break
    done
    if [ -n "$ELEC_ZIP" ] && unzip -t "$ELEC_ZIP" >/dev/null 2>&1; then
        PASS "Electron zip: $(basename "$ELEC_ZIP") ($(du -h "$ELEC_ZIP" | cut -f1))"
    else
        FAIL "Electron zip 未找到或损坏"
    fi

    log ""
    log "4) Node.js 运行时:"
    NODE_ZIP="$PROJECT_DIR/packages/windows/node-v24.14.0-win-x64.zip"
    [ -f "$NODE_ZIP" ] && PASS "Node.js 24.14.0 ($(du -h "$NODE_ZIP" | cut -f1))" || FAIL "Node.js zip 未找到"

    log ""
    log "5) 后端二进制 (可选):"
    for bin in codex codex_chronicle; do
        src="$PROJECT_DIR/packages/windows/${bin}-win32-x64.exe"
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
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(realpath "$OUTPUT_DIR")"
VERSION=$(get_app_version "$APP_PATH")
log "=== Windows x64 Packaging (v${VERSION}) ==="

WIN_DIR="$BUILD_DIR/Codex-win32-x64"
mkdir -p "$WIN_DIR/resources" "$WIN_DIR/locales"

# Platform-agnostic resources
cp "$APP_PATH/Contents/Resources/app.asar" "$WIN_DIR/resources/"
[ -d "$APP_PATH/Contents/Resources/plugins" ] && cp -a "$APP_PATH/Contents/Resources/plugins" "$WIN_DIR/resources/"
if [ -d "$APP_PATH/Contents/Resources/app.asar.unpacked" ]; then
    cp -a "$APP_PATH/Contents/Resources/app.asar.unpacked" "$WIN_DIR/resources/"
    # 移除 macOS-only .node 文件及模块
    find "$WIN_DIR/resources/app.asar.unpacked" -name '*.node' -type f -delete 2>/dev/null || true
    rm -rf "$WIN_DIR/resources/app.asar.unpacked/node_modules/node-mac-permissions" 2>/dev/null || true
    rm -rf "$WIN_DIR/resources/app.asar.unpacked/node_modules/objc-js" 2>/dev/null || true
fi
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
    # Node.js Windows zip 结构: node-v24.14.0-win-x64/  →  里面的文件
    NODE_ROOT="$(find "$TMP" -maxdepth 2 -name "node.exe" -type f 2>/dev/null | head -1)"
    if [ -n "$NODE_ROOT" ]; then
        # 找到 node.exe 所在的目录，复制所有内容
        NODE_SRC="$(dirname "$NODE_ROOT")"
        cp -a "$NODE_SRC"/* "$CUA_DIR/"
    else
        # 回退：尝试常见结构
        INNER_DIR="$(find "$TMP" -maxdepth 1 -type d ! -path "$TMP" | head -1)"
        if [ -n "$INNER_DIR" ]; then
            cp -a "$INNER_DIR"/* "$CUA_DIR/"
        else
            cp -a "$TMP"/* "$CUA_DIR/" 2>/dev/null || true
        fi
    fi
    rm -rf "$TMP"
    cat > "$CUA_DIR/manifest.json" <<JSON
{"platform":"win32","arch":"x64","target":"win32-x64","node_version":"24.14.0"}
JSON
fi

# --- Rebuild native Node modules for Windows x64 ---
UNPACKED="$WIN_DIR/resources/app.asar.unpacked/node_modules"
if [ -d "$UNPACKED" ]; then
    NODE_BIN="$CUA_DIR/bin/node.exe"
    [ ! -f "$NODE_BIN" ] && NODE_BIN="$CUA_DIR/node.exe"
    if [ -f "$NODE_BIN" ]; then
        log "Rebuilding native Node modules for Windows x64..."
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
                    "$NODE_BIN" "$(which node-gyp)" rebuild --arch=x64 2>&1 | tail -3 || log "    ⚠️  $mod rebuild had warnings"
                )
            fi
        done
    fi
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
