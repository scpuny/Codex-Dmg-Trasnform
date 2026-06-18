#!/usr/bin/env bash
set -euo pipefail

# check-version.sh — Check Codex version from local DMG or remote source
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

CODEX_DMG_URL="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
VERSION_CACHE="$PROJECT_DIR/.codex-version"

get_remote_fingerprint() {
    local headers
    headers=$(curl -fsSLI -k "$CODEX_DMG_URL" 2>/dev/null)
    local last_modified content_length
    last_modified=$(echo "$headers" | grep -i "last-modified" | head -1 | sed 's/.*: //' | tr -d '\r')
    content_length=$(echo "$headers" | grep -i "content-length" | head -1 | sed 's/.*: //' | tr -d '\r')
    echo "${last_modified}:${content_length}"
}

get_local_version() {
    local app_path="$1"
    local plist="$app_path/Contents/Info.plist"
    if [ -f "$plist" ]; then
        python3 -c "
import plistlib
with open('$plist', 'rb') as f:
    d = plistlib.load(f)
v = d.get('CFBundleShortVersionString', 'unknown')
b = d.get('CFBundleVersion', 'unknown')
print(f'{v} (build {b})')
"
    else
        echo "unknown"
    fi
}

case "${1:-}" in
    --dmg)
        # Extract and read version from a local DMG file (slow)
        shift; dmg="${1:-$PROJECT_DIR/Codex.dmg}"
        tmpdir="$(mktemp -d)"
        img="$tmpdir/img"
        dmg2img "$dmg" "$img" >/dev/null 2>&1
        7z x "$img" -o"$tmpdir/out" -y >/dev/null 2>&1
        plist=$(find "$tmpdir/out" -name "Info.plist" -path "*/Codex.app/*" 2>/dev/null | head -1)
        if [ -n "$plist" ]; then
            get_local_version "$(dirname "$(dirname "$(dirname "$plist")")")"
        fi
        rm -rf "$tmpdir"
        ;;
    --app)
        shift
        get_local_version "${1:-$PROJECT_DIR/build/extracted/Codex.app}"
        ;;
    --remote)
        get_remote_fingerprint
        ;;
    --check)
        remote=$(get_remote_fingerprint)
        cached=""
        [ -f "$VERSION_CACHE" ] && cached=$(cat "$VERSION_CACHE")
        if [ "$remote" = "$cached" ]; then
            echo "unchanged"
            exit 0
        else
            echo "changed"
            echo "$remote" > "$VERSION_CACHE"
            exit 1
        fi
        ;;
    --url)
        echo "$CODEX_DMG_URL"
        ;;
    --help|-h|*)
        echo "Usage:"
        echo "  $0 --dmg <file>       Extract version from Codex.dmg"
        echo "  $0 --app <path>       Read version from extracted Codex.app"
        echo "  $0 --remote           Get remote fingerprint"
        echo "  $0 --check            Compare remote vs cached (exit 0=same)"
        echo "  $0 --url              Print download URL"
        ;;
esac
