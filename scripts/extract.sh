#!/usr/bin/env bash
set -euo pipefail

# extract.sh — Download & extract Codex.app from official source or local DMG
# Usage: ./scripts/extract.sh [--dmg path/Codex.dmg] [--output-dir dir]
#        ./scripts/extract.sh --download           # Download from OpenAI
#        ./scripts/extract.sh --dmg Codex.dmg      # Extract from local file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

DMG_PATH=""
OUTPUT_DIR=""
DOWNLOAD_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dmg) DMG_PATH="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --download) DOWNLOAD_ONLY=true; shift ;;
        --help|-h)
            echo "Usage:"
            echo "  $0                              # Extract from project's Codex.dmg"
            echo "  $0 --dmg path/Codex.dmg        # Extract from specific file"
            echo "  $0 --download                   # Download + extract from OpenAI"
            echo "  $0 --download --output-dir out  # Download to custom dir"
            echo ""
            echo "Env: DMG_PATH, OUTPUT_DIR"
            exit 0
            ;;
        *)
            [ -z "$DMG_PATH" ] && DMG_PATH="$1" || OUTPUT_DIR="$1"
            shift
            ;;
    esac
done

OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_DIR/build/extracted}"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(realpath "$OUTPUT_DIR")"

# Download mode
if [ "$DOWNLOAD_ONLY" = true ] || [ -z "$DMG_PATH" ] && [ ! -f "$PROJECT_DIR/Codex.dmg" ]; then
    echo "==> Downloading Codex.dmg from OpenAI CDN..."
    download_codex_dmg "$PROJECT_DIR/Codex.dmg" || {
        echo "Error: Download failed" >&2
        exit 1
    }
    DMG_PATH="$PROJECT_DIR/Codex.dmg"
elif [ -z "$DMG_PATH" ]; then
    DMG_PATH="$PROJECT_DIR/Codex.dmg"
fi

DMG_PATH="$(realpath "$DMG_PATH")"

[ ! -f "$DMG_PATH" ] && { echo "Error: DMG not found: $DMG_PATH" >&2; exit 1; }

echo "==> Extracting from: $DMG_PATH"
echo "==> Output dir:      $OUTPUT_DIR"

OS="$(uname -s)"

case "$OS" in
    Darwin)
        echo "==> macOS — attaching DMG..."
        MNT=$(mktemp -d)
        hdiutil attach "$DMG_PATH" -mountpoint "$MNT" -nobrowse
        rsync -a "$MNT/" "$OUTPUT_DIR/"
        hdiutil detach "$MNT" -quiet
        rmdir "$MNT"
        ;;
    Linux)
        echo "==> Linux — extracting DMG directly with 7z..."
        TMP_EXTRACT="$(mktemp -d)"
        if 7z x "$DMG_PATH" -o"$TMP_EXTRACT" -y > /dev/null 2>&1; then
            # 7z 直接提取成功
            # 有时文件会在一个子目录下（如 "Codex Installer/Codex.app"）
            find "$TMP_EXTRACT" -maxdepth 1 -type d ! -path "$TMP_EXTRACT" | while read -r dir; do
                cp -a "$dir"/* "$OUTPUT_DIR/" 2>/dev/null || true
            done
            # 如果上面没取到，直接复制所有
            if [ -z "$(ls -A "$OUTPUT_DIR")" ]; then
                cp -a "$TMP_EXTRACT"/* "$OUTPUT_DIR/" 2>/dev/null || true
            fi
        else
            echo "==> 7z direct extraction failed, trying alternative methods..."
            # 方法1: 尝试使用 dmg2img 转换后挂载
            if command -v dmg2img &>/dev/null; then
                echo "==> Trying dmg2img + mount..."
                IMG_FILE="$(mktemp).img"
                dmg2img "$DMG_PATH" "$IMG_FILE" 2>/dev/null || true
                MNT_DIR="$(mktemp -d)"
                # 尝试多种挂载方式
                MOUNT_OK=false
                # 尝试 HFS+ (传统 macOS DMG)
                if command -v mount.hfsplus &>/dev/null; then
                    # 检测 HFS+ 分区偏移量
                    OFFSET=$(fdisk -l "$IMG_FILE" 2>/dev/null | grep "Apple_HFS" | awk '{print $2 * 512}' || echo "")
                    if [ -z "$OFFSET" ]; then
                        OFFSET=$(partx -o START -n1 -g "$IMG_FILE" 2>/dev/null | awk '{print $1 * 512}' || echo "0")
                    fi
                    if [ "$OFFSET" != "0" ]; then
                        if sudo mount -o loop,ro,offset=$OFFSET -t hfsplus "$IMG_FILE" "$MNT_DIR" 2>/dev/null; then
                            MOUNT_OK=true
                        fi
                    fi
                fi
                # 尝试 APFS (新式 macOS DMG)
                if [ "$MOUNT_OK" = false ] && command -v apfs-fuse &>/dev/null; then
                    if apfs-fuse "$IMG_FILE" "$MNT_DIR" 2>/dev/null; then
                        MOUNT_OK=true
                    fi
                fi
                if [ "$MOUNT_OK" = true ]; then
                    rsync -a "$MNT_DIR/" "$OUTPUT_DIR/"
                    sudo umount "$MNT_DIR" 2>/dev/null || true
                fi
                rm -f "$IMG_FILE"
                rm -rf "$MNT_DIR"
            fi
            # 方法2: 尝试使用 Python 的 dmg 库提取
            if [ -z "$(ls -A "$OUTPUT_DIR" 2>/dev/null)" ] && python3 -c "import dmg" 2>/dev/null; then
                echo "==> Trying Python dmg module..."
                python3 -c "
import dmg, sys, os
dmg.extract_dmg('$DMG_PATH', '$OUTPUT_DIR')
" 2>/dev/null || true
            fi
            # 方法3: 尝试使用 libguestfs
            if [ -z "$(ls -A "$OUTPUT_DIR" 2>/dev/null)" ] && command -v guestmount &>/dev/null; then
                echo "==> Trying libguestfs (guestmount)..."
                MNT_DIR="$(mktemp -d)"
                if guestmount -a "$DMG_PATH" -m /dev/sda --ro "$MNT_DIR" 2>/dev/null; then
                    rsync -a "$MNT_DIR/" "$OUTPUT_DIR/"
                    guestunmount "$MNT_DIR" 2>/dev/null || true
                fi
                rm -rf "$MNT_DIR"
            fi
            # 最终检查
            if [ -z "$(ls -A "$OUTPUT_DIR" 2>/dev/null)" ]; then
                echo "Error: Cannot extract DMG on Linux." >&2
                echo "Install required packages for DMG support:" >&2
                echo "  sudo apt-get install -y p7zip-full hfsprogs dmg2img" >&2
                echo "  # For APFS DMGs (macOS Big Sur+), also install:" >&2
                echo "  sudo apt-get install -y fuse libfuse-dev" >&2
                echo "  git clone https://github.com/eafer/apfs-fuse.git && cd apfs-fuse && mkdir build && cd build && cmake .. && make && sudo make install" >&2
                echo "  # Or via snap:" >&2
                echo "  sudo snap install apfs-fuse" >&2
                exit 1
            fi
        fi
        rm -rf "$TMP_EXTRACT"
        ;;
esac

# Create convenience symlink
if [ -d "$OUTPUT_DIR/Codex Installer/Codex.app" ] && [ ! -e "$OUTPUT_DIR/Codex.app" ]; then
    ln -sf "Codex Installer/Codex.app" "$OUTPUT_DIR/Codex.app"
    echo "==> Symlink created: Codex.app -> Codex Installer/Codex.app"
fi

echo "==> Contents:"
ls -la "$OUTPUT_DIR/" 2>/dev/null
echo "==> Extraction complete"
