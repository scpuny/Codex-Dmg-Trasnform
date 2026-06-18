#!/usr/bin/env bash
# common.sh — Shared functions for packaging scripts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Standard Electron version to use (closest match to Codex's custom Electron 149)
# Codex bundles a custom Electron based on Chromium 149 (roughly Electron 33-35 range)
STANDARD_ELECTRON_VERSION="35.1.0"

# Log with timestamp
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Detect current OS and arch
detect_os_arch() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"
    case "$os" in
        Darwin) os="darwin" ;;
        Linux)  os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="win32" ;;
    esac
    case "$arch" in
        x86_64|amd64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
    esac
    echo "${os}-${arch}"
}

# Download file with optional SHA256 verification
download_file() {
    local url="$1"
    local out_path="$2"
    local expected_hash="${3:-}"

    mkdir -p "$(dirname "$out_path")"
    log "  Downloading: $(basename "$out_path")"

    # Use -k for SSL cert verification bypass (WSL/CI environments)
    local curl_args=(-fsSLk)
    # Add timeout to prevent CI hangs
    curl_args+=(--connect-timeout 30 --max-time 600)
    # Also add --retry for reliability on large downloads
    curl_args+=(--retry 3)
    if ! curl "${curl_args[@]}" "$url" -o "$out_path"; then
        log "  Error: Download failed: $url" >&2
        return 1
    fi

    if [ -n "$expected_hash" ]; then
        local actual_hash
        actual_hash=$(sha256sum "$out_path" | cut -d' ' -f1)
        if [ "$actual_hash" != "$expected_hash" ]; then
            log "  Error: SHA256 mismatch!" >&2
            log "  Expected: $expected_hash" >&2
            log "  Actual:   $actual_hash" >&2
            rm -f "$out_path"
            return 1
        fi
        log "  SHA256 verified: $actual_hash"
    fi
    log "  Done: $(du -h "$out_path" | cut -f1)"
}

# Get app version from Info.plist
get_app_version() {
    local app_path="$1"
    local plist="$app_path/Contents/Info.plist"
    if [ -f "$plist" ]; then
        python3 -c "
import plistlib
with open('$plist', 'rb') as f:
    d = plistlib.load(f)
print(d.get('CFBundleShortVersionString', 'unknown'))
" 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

# Check required CLI tools
require_tools() {
    local missing=()
    for tool in "$@"; do
        if ! command -v "$tool" &>/dev/null 2>&1; then
            missing+=("$tool")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        log "Error: Required tools not found: ${missing[*]}" >&2
        return 1
    fi
}

# ============================================================
# 国内镜像源（npmmirror.com，国内下载速度快，自动 fallback 到官方源）
# 设置 CODEX_USE_MIRROR=false 可完全禁用镜像
# ============================================================
CODEX_MIRROR_BASE="${CODEX_MIRROR_BASE:-https://npmmirror.com/mirrors}"

# 是否启用镜像源（默认启用）
if [ "${CODEX_USE_MIRROR:-true}" = "true" ]; then
    CODEX_USE_MIRROR=true
else
    CODEX_USE_MIRROR=false
fi

# Get Electron download URL for target platform
get_electron_url() {
    local version="$1"
    local platform="$2"  # darwin, linux, win32
    local arch="$3"      # x64, arm64
    echo "https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${platform}-${arch}.zip"
}

# Get Electron mirror download URL
get_electron_mirror_url() {
    local version="$1"
    local platform="$2"
    local arch="$3"
    echo "${CODEX_MIRROR_BASE}/electron/v${version}/electron-v${version}-${platform}-${arch}.zip"
}

# Get Node.js download URL for target platform
get_nodejs_url() {
    local version="$1"
    local platform="$2"  # darwin, linux, win
    local arch="$3"      # x64, arm64
    local ext="tar.xz"
    [ "$platform" = "win" ] && ext="zip"
    echo "https://nodejs.org/dist/v${version}/node-v${version}-${platform}-${arch}.${ext}"
}

# Get Node.js mirror download URL
get_nodejs_mirror_url() {
    local version="$1"
    local platform="$2"  # darwin, linux, win
    local arch="$3"      # x64, arm64
    local ext="tar.xz"
    [ "$platform" = "win" ] && ext="zip"
    echo "${CODEX_MIRROR_BASE}/node/v${version}/node-v${version}-${platform}-${arch}.${ext}"
}

# 带镜像回退的下载函数
# 先尝试镜像源（国内快），失败后自动回退到官方源
download_with_mirror_fallback() {
    local mirror_url="$1"
    local official_url="$2"
    local out_path="$3"
    local description="${4:-$(basename "$out_path")}"

    mkdir -p "$(dirname "$out_path")"
    log "  Downloading: $description"

    local success=false

    if [ "$CODEX_USE_MIRROR" = "true" ]; then
        log "    Mirror: $mirror_url"
        if curl -fsSLk --connect-timeout 15 --max-time 600 --retry 2 "$mirror_url" -o "$out_path" 2>/dev/null; then
            log "    ✅ Mirror download successful"
            success=true
        else
            log "    ⚠️  Mirror failed, falling back to official source..."
            rm -f "$out_path" 2>/dev/null || true
        fi
    fi

    if [ "$success" != "true" ]; then
        log "    Official: $official_url"
        if curl -fsSLk --connect-timeout 30 --max-time 600 --retry 3 "$official_url" -o "$out_path"; then
            log "    ✅ Official download successful"
            success=true
        else
            log "    ❌ Both mirror and official download failed" >&2
            rm -f "$out_path" 2>/dev/null || true
            return 1
        fi
    fi

    log "    Done: $(du -h "$out_path" | cut -f1)"
    return 0
}

# Official Codex.dmg download URL (always serves latest version)
CODEX_DMG_URL="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"

# Download the official Codex.dmg
download_codex_dmg() {
    local out_path="${1:-$PROJECT_DIR/Codex.dmg}"
    log "Downloading Codex.dmg from OpenAI..."
    log "  URL: $CODEX_DMG_URL"
    log "  Output: $out_path"
    
    mkdir -p "$(dirname "$out_path")"
    
    # Use resume support for large downloads
    if command -v curl &>/dev/null; then
        curl -fSLk -C - --connect-timeout 30 --max-time 1200 --retry 3 "$CODEX_DMG_URL" -o "$out_path" || {
            log "Error: Download failed" >&2
            return 1
        }
    elif command -v wget &>/dev/null; then
        wget -c "$CODEX_DMG_URL" -O "$out_path" || {
            log "Error: Download failed" >&2
            return 1
        }
    else
        log "Error: Neither curl nor wget found" >&2
        return 1
    fi
    
    local size
    size=$(du -h "$out_path" | cut -f1)
    log "Downloaded: $size"
    ls -lh "$out_path"
}
