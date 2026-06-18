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
        echo "==> Linux — converting DMG to IMG..."
        IMG_FILE="$(mktemp).img"
        dmg2img "$DMG_PATH" "$IMG_FILE" 2>/dev/null
        echo "==> Extracting files from disk image..."
        TMP_EXTRACT="$(mktemp -d)"
        7z x "$IMG_FILE" -o"$TMP_EXTRACT" -y > /dev/null 2>&1
        cp -a "$TMP_EXTRACT"/* "$OUTPUT_DIR/" 2>/dev/null || true
        rm -f "$IMG_FILE"
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
