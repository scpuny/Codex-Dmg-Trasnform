#!/usr/bin/env bash
set -euo pipefail

# pack-linux-amd64.sh — Build Linux amd64 package from extracted Codex.app
#
# 前置条件（必须）：
#   1. packages/linux-amd64/electron-*.zip   — Electron 运行时
#   2. build/extracted/Codex.app              — 已提取的原始应用
#
# 前置条件（可选）：
#   3. packages/linux-amd64/codex-linux-x64   — AI 后端二进制
#   4. packages/linux-amd64/codex_chronicle-linux-x64 — 日志服务
#
# 用法：
#   ./scripts/pack-linux-amd64.sh [--app path] [--output-dir path]
#   ./scripts/pack-linux-amd64.sh --check     # 仅检查前置条件

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
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/packages/linux-amd64}"

# ============================================================
# 前置检查
# ============================================================
ERRORS=0
PASS() { log "  ✅ $1"; }
FAIL() { log "  ❌ $1"; ERRORS=$((ERRORS+1)); }

log "=== 前置检查 ==="

# 1. 检查原始应用是否存在
log ""
log "1) 原始应用 (Codex.app):"
if [ -d "$APP_PATH" ] && [ -f "$APP_PATH/Contents/Info.plist" ]; then
    PASS "Codex.app → $APP_PATH"
    VERSION=$(get_app_version "$APP_PATH")
    log "     版本: $VERSION"
else
    FAIL "Codex.app 未找到: $APP_PATH"
    FAIL "  运行: ./scripts/extract.sh --download"
fi

# 2. 检查 app.asar
log ""
log "2) Electron 前端 (app.asar):"
ASAR="$APP_PATH/Contents/Resources/app.asar"
if [ -f "$ASAR" ]; then
    PASS "app.asar ($(du -h "$ASAR" | cut -f1))"
else
    FAIL "app.asar 未找到"
fi

# 3. 检查 Electron 运行时
log ""
log "3) Electron 运行时 (必须):"
ELEC_ZIP=""
for f in "$PROJECT_DIR/packages/linux-amd64"/electron-*-linux-x64.zip; do
    [ -f "$f" ] && ELEC_ZIP="$f" && break
done
if [ -n "$ELEC_ZIP" ]; then
    # 验证 zip 是否有效
    if unzip -t "$ELEC_ZIP" >/dev/null 2>&1; then
        ELEC_SIZE=$(du -h "$ELEC_ZIP" | cut -f1)
        PASS "Electron zip: $(basename "$ELEC_ZIP") ($ELEC_SIZE)"
        # 检查 zip 内是否包含 electron 二进制
        if unzip -l "$ELEC_ZIP" 2>/dev/null | grep -q "electron$"; then
            PASS "  electron 二进制存在"
        else
            FAIL "  electron 二进制缺失（zip 损坏或不完整）"
            FAIL "  重新下载: ./scripts/download-runtime.sh --platform linux --arch x64"
        fi
    else
        FAIL "Electron zip 损坏: $(basename "$ELEC_ZIP")"
        FAIL "  删除后重新下载: rm -f '$ELEC_ZIP' && ./scripts/download-runtime.sh --platform linux --arch x64"
    fi
else
    FAIL "Electron zip 未找到"
    FAIL "  下载: ./scripts/download-runtime.sh --platform linux --arch x64"
    FAIL "  或手动下载放到: $PROJECT_DIR/packages/linux-amd64/"
fi

# 4. 检查 Node.js 运行时
log ""
log "4) Node.js 运行时 (必须):"
NODE_ARCHIVE="$PROJECT_DIR/packages/linux-amd64/node-v24.14.0-linux-x64.tar.xz"
if [ -f "$NODE_ARCHIVE" ]; then
    PASS "Node.js 24.14.0 ($(du -h "$NODE_ARCHIVE" | cut -f1))"
else
    FAIL "Node.js 归档未找到: $(basename "$NODE_ARCHIVE")"
    FAIL "  下载: ./scripts/download-runtime.sh --platform linux --arch x64"
fi

# 5. 检查后端二进制（可选）
log ""
log "5) AI 后端二进制 (可选，无此文件则 UI 可启动但后端不可用):"
for bin in codex codex_chronicle; do
    src="$PROJECT_DIR/packages/linux-amd64/${bin}-linux-x64"
    if [ -f "$src" ]; then
        PASS "$bin ($(du -h "$src" | cut -f1))"
    else
        log "    ⚠️  $bin 未提供（不影响 UI 启动）"
        log "      放置到: packages/linux-amd64/${bin}-linux-x64"
    fi
done

# 6. 检查图标
log ""
log "6) 应用图标:"
if [ -f "$APP_PATH/Contents/Resources/icon.png" ]; then
    PASS "icon.png ($(du -h "$APP_PATH/Contents/Resources/icon.png" | cut -f1))"
else
    FAIL "icon.png 未找到"
fi

# ============================================================
# 汇总
# ============================================================
echo ""
if [ "$ERRORS" -gt 0 ]; then
    log "❌ 发现 $ERRORS 个错误，请修复后重试"
    if [ "$CHECK_ONLY" = true ]; then
        exit 1
    fi
    log "⚠️  继续打包（产物将不完整）"
    echo ""
else
    log "✅ 所有前置检查通过"
    echo ""
fi

[ "$CHECK_ONLY" = true ] && exit 0

# ============================================================
# 打包流程
# ============================================================
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(realpath "$OUTPUT_DIR")"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

log "=== 开始打包 Linux amd64 v${VERSION} ==="

LINUX_DIR="$BUILD_DIR/Codex-linux-x64"
mkdir -p "$LINUX_DIR/resources" "$LINUX_DIR/locales"

# --- 复制 app.asar ---
log "复制 app.asar..."
cp "$ASAR" "$LINUX_DIR/resources/"
log "  done ($(du -h "$LINUX_DIR/resources/app.asar" | cut -f1))"

# --- 插件 ---
[ -d "$APP_PATH/Contents/Resources/plugins" ] && cp -a "$APP_PATH/Contents/Resources/plugins" "$LINUX_DIR/resources/"

# --- 本地化 ---
for dir in "$APP_PATH/Contents/Resources/"*.lproj; do
    [ -d "$dir" ] && cp -a "$dir" "$LINUX_DIR/resources/"
done

# --- 素材 ---
for f in icon-codex-dark.png icon-codex-light.png codex-notification.wav; do
    [ -f "$APP_PATH/Contents/Resources/$f" ] && cp "$APP_PATH/Contents/Resources/$f" "$LINUX_DIR/resources/"
done

# --- 原生模块 ---
if [ -d "$APP_PATH/Contents/Resources/app.asar.unpacked" ]; then
    cp -a "$APP_PATH/Contents/Resources/app.asar.unpacked" "$LINUX_DIR/resources/"
    log "  原生模块已复制（需按平台重新编译）"
fi

# --- Electron ---
log "安装 Electron..."
TMP_ELEC="$(mktemp -d)"
unzip -q "$ELEC_ZIP" -d "$TMP_ELEC"
cp "$TMP_ELEC/electron" "$LINUX_DIR/electron"
chmod +x "$LINUX_DIR/electron"
for f in "$TMP_ELEC"/*.so*; do [ -f "$f" ] && cp "$f" "$LINUX_DIR/" 2>/dev/null || true; done
for f in icudtl.dat snapshot_blob.bin v8_context_snapshot.bin LICENSES.chromium.html LICENSE.electron.txt; do
    [ -f "$TMP_ELEC/$f" ] && cp "$TMP_ELEC/$f" "$LINUX_DIR/" 2>/dev/null || true
done
[ -d "$TMP_ELEC/locales" ] && cp -a "$TMP_ELEC/locales"/* "$LINUX_DIR/locales/"
for f in libEGL.so libGLESv2.so libvk_swiftshader.so vk_swiftshader_icd.json; do
    [ -f "$TMP_ELEC/$f" ] && cp "$TMP_ELEC/$f" "$LINUX_DIR/" 2>/dev/null || true
done
rm -rf "$TMP_ELEC"
log "  Electron 安装完成"

# --- 后端二进制 ---
for bin in codex codex_chronicle; do
    src="$PROJECT_DIR/packages/linux-amd64/${bin}-linux-x64"
    if [ -f "$src" ]; then
        cp "$src" "$LINUX_DIR/resources/$bin"
        chmod +x "$LINUX_DIR/resources/$bin"
        log "  $bin 已安装"
    fi
done

# --- Node.js ---
CUA_DIR="$LINUX_DIR/resources/cua_node"
mkdir -p "$CUA_DIR"
tar xf "$NODE_ARCHIVE" -C "$CUA_DIR" --strip-components=1
cat > "$CUA_DIR/manifest.json" <<JSON
{
  "platform": "linux", "arch": "x64",
  "target": "linux-x64", "node_version": "24.14.0"
}
JSON
log "  Node.js 已安装"

# --- 原生模块重新编译（node-gyp rebuild） ---
UNPACKED="$LINUX_DIR/resources/app.asar.unpacked/node_modules"
if [ -d "$UNPACKED" ]; then
    NODE_BIN="$CUA_DIR/bin/node"
    log "  使用 Node.js: $($NODE_BIN --version) 重新编译原生模块..."

    # 安装 node-gyp
    "$NODE_BIN" -e "require('node-gyp')" 2>/dev/null || npm install -g node-gyp 2>/dev/null || true

    for mod_dir in "$UNPACKED"/*/; do
        mod="$(basename "$mod_dir")"
        pkg="$mod_dir/package.json"
        [ ! -f "$pkg" ] && continue

        # 检查是否是原生模块
        has_native=false
        grep -q '"gypfile"' "$pkg" 2>/dev/null && has_native=true
        [ -f "$mod_dir/binding.gyp" ] && has_native=true
        grep -q '"binary"' "$pkg" 2>/dev/null && has_native=true
        find "$mod_dir" -name '*.node' -type f 2>/dev/null | head -1 | grep -q . && has_native=true

        if $has_native; then
            log "  重新编译: $mod"
            (
                cd "$mod_dir"
                rm -rf build/ prebuilds/ 2>/dev/null || true
                "$NODE_BIN" "$(which node-gyp)" rebuild --arch=x64 2>&1 | tail -5 || log "    ⚠️  $mod 编译警告"
            )
        fi
    done
    log "  原生模块重新编译完成"
fi

# --- 图标 ---
cp "$APP_PATH/Contents/Resources/icon.png" "$LINUX_DIR/Codex.png"
log "  图标已安装"

# --- 启动脚本 ---
cat > "$LINUX_DIR/Codex.sh" << 'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$DIR/electron"
if [ ! -f "$ELECTRON" ]; then
    echo "错误: Electron 未找到: $ELECTRON" >&2
    echo "请重新安装 Codex 包" >&2
    exit 1
fi
if [ ! -f "$DIR/resources/app.asar" ]; then
    echo "错误: app.asar 未找到" >&2
    exit 1
fi
export ELECTRON_IS_DEV=0
export ELECTRON_OVERRIDE_DIST_PATH="$DIR"
exec "$ELECTRON" "$DIR/resources/app.asar" "$@"
LAUNCHER
chmod +x "$LINUX_DIR/Codex.sh"

# --- .desktop ---
cat > "$LINUX_DIR/Codex.desktop" << DESKTOP
[Desktop Entry]
Name=Codex
Comment=AI-powered coding assistant by OpenAI
Exec=${LINUX_DIR}/Codex.sh
Icon=${LINUX_DIR}/Codex.png
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=Codex
DESKTOP

# ============================================================
# 打包输出
# ============================================================

# .deb
log "构建 .deb..."
DEB_DIR="$BUILD_DIR/deb"
mkdir -p "$DEB_DIR/DEBIAN"
mkdir -p "$DEB_DIR/opt/Codex"
mkdir -p "$DEB_DIR/usr/share/applications"
mkdir -p "$DEB_DIR/usr/share/icons/hicolor/1024x1024/apps"

cp -a "$LINUX_DIR"/* "$DEB_DIR/opt/Codex/"
rm -f "$DEB_DIR/opt/Codex/Codex.desktop"

cat > "$DEB_DIR/usr/share/applications/Codex.desktop" << DESKTOP_DEB
[Desktop Entry]
Name=Codex
Comment=AI-powered coding assistant by OpenAI
Exec=/opt/Codex/Codex.sh
Icon=Codex
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=Codex
DESKTOP_DEB

cp "$APP_PATH/Contents/Resources/icon.png" "$DEB_DIR/usr/share/icons/hicolor/1024x1024/apps/Codex.png"

cat > "$DEB_DIR/DEBIAN/control" << CONTROL
Package: Codex
Version: ${VERSION}-1
Section: development
Priority: optional
Architecture: amd64
Maintainer: OpenAI <support@openai.com>
Description: Codex - AI-powered coding assistant by OpenAI
Depends: libc6 (>= 2.31), libstdc++6 (>= 10), libnss3,
 libnspr4, libatk-bridge2.0-0, libcups2, libdrm2,
 libdbus-1-3, libxkbcommon0, libxcomposite1, libxdamage1,
 libxrandr2, libgbm1, libpango-1.0-0, libcairo2, libasound2
CONTROL

cat > "$DEB_DIR/DEBIAN/postinst" << POSTINST
#!/bin/bash
set -e
if command -v update-desktop-database &>/dev/null; then
    update-desktop-database 2>/dev/null || true
fi
if command -v gtk-update-icon-cache &>/dev/null; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
exit 0
POSTINST
chmod 755 "$DEB_DIR/DEBIAN/postinst"

DEB_NAME="Codex_${VERSION}_amd64.deb"
dpkg-deb --build "$DEB_DIR" "$OUTPUT_DIR/$DEB_NAME" 2>/dev/null
log "  创建: $DEB_NAME ($(du -h "$OUTPUT_DIR/$DEB_NAME" | cut -f1))"

# tar.gz
log "构建便携版..."
ARCHIVE="Codex-${VERSION}-linux-x64.tar.gz"
tar czf "$OUTPUT_DIR/$ARCHIVE" -C "$BUILD_DIR" "$(basename "$LINUX_DIR")"
log "  创建: $ARCHIVE ($(du -h "$OUTPUT_DIR/$ARCHIVE" | cut -f1))"

log "=== 打包完成 ==="
log "输出目录: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR/" | grep -v node-v
