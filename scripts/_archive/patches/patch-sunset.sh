#!/usr/bin/env bash
# patch-sunset.sh — 禁用 appSunset 强制更新门
# 找到包含 appSunset 的 JS 文件，替换 gate 调用为 !1
set -euo pipefail

ASAR_DIR="${ASAR_CONTENT_DIR:-}"
[ -z "$ASAR_DIR" ] && { echo "patch-sunset: ASAR_CONTENT_DIR not set"; exit 1; }

echo "--- patch-sunset: Disable appSunset gate ---"

TARGET_DIR="$ASAR_DIR/webview/assets"
[ ! -d "$TARGET_DIR" ] && { echo "  [skip] $TARGET_DIR not found"; exit 0; }

PATCHED=0
for f in "$TARGET_DIR"/index-*.js; do
	[ -f "$f" ] || continue
	if grep -q 'appSunset\|app\.sunset\|sunset' "$f" 2>/dev/null; then
		# 替换 gate 调用: identifier(`numericString`) → !1
		# 匹配如: `Fl("123456")`, `Lp("789012")` 等 gate 调用
		sed -i '' -E 's/([a-zA-Z_$][a-zA-Z0-9_$]*)\("([0-9]{6,})"\)|([a-zA-Z_$][a-zA-Z0-9_$]*)`([0-9]{6,})`/!1/g' "$f"
		echo "  patched: $(basename "$f")"
		PATCHED=$((PATCHED+1))
	fi
done

echo "  [ok] $PATCHED files patched"
