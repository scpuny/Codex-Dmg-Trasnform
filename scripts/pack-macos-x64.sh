#!/usr/bin/env bash
set -euo pipefail

# pack-macos-x64.sh — Build macOS Intel (x86_64) package
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
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/packages/macos-x64}"

# ============================================================
# 前置检查
# ============================================================
ERRORS=0
PASS() { log "  ✅ $1"; }
FAIL() { log "  ❌ $1"; ERRORS=$((ERRORS+1)); }

log "=== macOS Intel 前置检查 ==="

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
if [ -f "$APP_PATH/Contents/Resources/app.asar" ]; then
    PASS "app.asar ($(du -h "$APP_PATH/Contents/Resources/app.asar" | cut -f1))"
else
    FAIL "app.asar 未找到"
fi

log ""
log "3) Electron 运行时:"
ELEC_ZIP=""
for f in "$PROJECT_DIR/packages/macos-x64"/electron-*-darwin-x64.zip; do
    [ -f "$f" ] && ELEC_ZIP="$f" && break
done
if [ -n "$ELEC_ZIP" ]; then
    if unzip -t "$ELEC_ZIP" >/dev/null 2>&1; then
        PASS "Electron zip: $(basename "$ELEC_ZIP") ($(du -h "$ELEC_ZIP" | cut -f1))"
    else
        FAIL "Electron zip 损坏: $(basename "$ELEC_ZIP")"
    fi
else
    FAIL "Electron zip 未找到 (packages/macos-x64/electron-*-darwin-x64.zip)"
    FAIL "  运行: ./scripts/download-runtime.sh --platform darwin --arch x64"
fi

log ""
log "4) Node.js 运行时:"
NODE_ARCHIVE="$PROJECT_DIR/packages/macos-x64/node-v24.14.0-darwin-x64.tar.xz"
if [ -f "$NODE_ARCHIVE" ]; then
    PASS "Node.js 24.14.0 ($(du -h "$NODE_ARCHIVE" | cut -f1))"
else
    FAIL "Node.js 归档未找到: $(basename "$NODE_ARCHIVE")"
    FAIL "  运行: ./scripts/download-runtime.sh --platform darwin --arch x64"
fi

log ""
log "5) 后端二进制 (可选):"
for bin in codex codex_chronicle; do
    src="$PROJECT_DIR/packages/macos-x64/${bin}-x64"
    if [ -f "$src" ]; then
        PASS "$bin ($(du -h "$src" | cut -f1))"
    else
        log "    ⚠️  $bin 未提供（不影响 UI 启动）"
    fi
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

[ "$CHECK_ONLY" = true ] && exit 0

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

# 移除 ARM64 .node 文件（后续会被 x64 重建覆盖，但先清干净避免混淆）
find "$BUILD_DIR/Codex.app/Contents/Resources/app.asar.unpacked" -name '*.node' -type f -delete 2>/dev/null || true

# 移除 ElectronAsarIntegrity（标准 Electron 不认识 OpenAI 的验证 key，会报错）
PLIST="$BUILD_DIR/Codex.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
    python3 -c "
import plistlib
with open('$PLIST', 'rb') as f:
    d = plistlib.load(f)
d.pop('ElectronAsarIntegrity', None)
with open('$PLIST', 'wb') as f:
    plistlib.dump(d, f)
" 2>/dev/null || true
    log "  ElectronAsarIntegrity removed from Info.plist"
fi

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

# --- 重新编译原生 Node 模块（ARM64 → x64） ---
UNPACKED="$BUILD_DIR/Codex.app/Contents/Resources/app.asar.unpacked/node_modules"
if [ -d "$UNPACKED" ]; then
    # 找 Node.js 二进制：优先用我们下载的运行时
    CUA_NODE="$BUILD_DIR/Codex.app/Contents/Resources/cua_node/bin/node"
    NODE_BIN=""
    for candidate in "$CUA_NODE" "$(command -v node)"; do
        [ -f "$candidate" ] && { NODE_BIN="$candidate"; break; }
    done
    if [ -n "$NODE_BIN" ]; then
        log "Rebuilding native Node modules for x64 (using $("$NODE_BIN" --version))..."
        "$NODE_BIN" -e "require('node-gyp')" 2>/dev/null || npm install -g node-gyp 2>/dev/null || true
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
        log "  Native modules rebuild complete"
    fi
fi

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

# Create .dmg (use hdiutil exclusively — built into macOS, reliable)
# Avoid create-dmg as it can hang on CI runners
DMG_PATH="$OUTPUT_DIR/Codex-${VERSION}-macos-x64.dmg"
log "Creating DMG with hdiutil..."
if ! hdiutil create -volname "Codex" -srcfolder "$BUILD_DIR/Codex.app" -ov -format UDZO "$DMG_PATH" 2>&1; then
    log "Warning: DMG creation failed, falling back to tar.gz"
fi

# Also produce tar.gz as a universal fallback
tar czf "$OUTPUT_DIR/Codex-${VERSION}-macos-x64.tar.gz" -C "$BUILD_DIR" "Codex.app"

log "=== macOS Intel complete ==="
ls -lh "$OUTPUT_DIR/"
