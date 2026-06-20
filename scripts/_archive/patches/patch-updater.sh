#!/usr/bin/env bash
# patch-updater.sh — 禁用 Sparkle (macOS) 和 Windows 自动更新
set -euo pipefail

ASAR_DIR="${ASAR_CONTENT_DIR:-}"
[ -z "$ASAR_DIR" ] && { echo "patch-updater: ASAR_CONTENT_DIR not set"; exit 1; }

echo "--- patch-updater: Disable auto-updater ---"

TARGET_DIR="$ASAR_DIR/.vite/build"
[ ! -d "$TARGET_DIR" ] && { echo "  [skip] $TARGET_DIR not found"; exit 0; }

PATCHED=0
for f in "$TARGET_DIR"/*.js; do
	[ -f "$f" ] || continue
	if grep -q 'shouldIncludeSparkle\|shouldIncludeUpdater' "$f" 2>/dev/null; then
		# 替换 shouldIncludeSparkle() 等方法 → 返回 !1 (false)
		# Method 定义: shouldIncludeSparkle(e,t,n){return ...} → shouldIncludeSparkle(e,t,n){return!1}
		sed -i '' -E \
			-e 's/(shouldIncludeSparkle|shouldIncludeWindowsUpdater|shouldIncludeWindowsMsixUpdater|shouldIncludeUpdater)\([^)]*\)\{[^}]*return[^}]*\}/\1(e,t,n){return!1}/g' \
			"$f"
		echo "  patched: $(basename "$f")"
		PATCHED=$((PATCHED+1))
	fi
done

echo "  [ok] $PATCHED files patched"
