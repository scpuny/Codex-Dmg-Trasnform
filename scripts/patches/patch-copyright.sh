#!/usr/bin/env bash
# patch-copyright.sh — 更新版权信息
# 将 copyright: "(c) OpenAI" 替换为自定义文本
set -euo pipefail

ASAR_DIR="${ASAR_CONTENT_DIR:-}"
[ -z "$ASAR_DIR" ] && { echo "patch-copyright: ASAR_CONTENT_DIR not set"; exit 1; }

echo "--- patch-copyright: Update copyright text ---"

TARGET_DIR="$ASAR_DIR/.vite/build"
[ ! -d "$TARGET_DIR" ] && { echo "  [skip] $TARGET_DIR not found"; exit 0; }

NEW_COPYRIGHT="(c) OpenAI · Cometix Space"
PATCHED=0

for f in "$TARGET_DIR"/main-*.js; do
	[ -f "$f" ] || continue
	if grep -q 'copyright.*(c) OpenAI' "$f" 2>/dev/null; then
		# 替换 copyright: "(c) OpenAI" → copyright: "(c) OpenAI · Cometix Space"
		sed -i '' \
			-e 's/copyright:"(c) OpenAI"/copyright:"'"$NEW_COPYRIGHT"'"/g' \
			-e "s/copyright:'(c) OpenAI'/copyright:'$NEW_COPYRIGHT'/g" \
			-e 's/copyright:`(c) OpenAI`/copyright:`'"$NEW_COPYRIGHT"'`/g' \
			"$f"
		echo "  patched: $(basename "$f")"
		PATCHED=$((PATCHED+1))
	fi
done

echo "  [ok] $PATCHED files patched"
