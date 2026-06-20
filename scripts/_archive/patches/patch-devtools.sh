#!/usr/bin/env bash
# patch-devtools.sh — 强制启用 DevTools 和 InspectElement
set -euo pipefail

ASAR_DIR="${ASAR_CONTENT_DIR:-}"
[ -z "$ASAR_DIR" ] && { echo "patch-devtools: ASAR_CONTENT_DIR not set"; exit 1; }

echo "--- patch-devtools: Force-enable DevTools ---"

TARGET_DIR="$ASAR_DIR/.vite/build"
[ ! -d "$TARGET_DIR" ] && { echo "  [skip] $TARGET_DIR not found"; exit 0; }

PATCHED=0
for f in "$TARGET_DIR"/main-*.js; do
	[ -f "$f" ] || continue
	MODIFIED=false
	
	# allowInspectElement: <expr> → allowInspectElement:!0
	if grep -q 'allowInspectElement' "$f" 2>/dev/null; then
		sed -i '' -E 's/(allowInspectElement:)[[:space:]]*[a-zA-Z_$][a-zA-Z0-9_$.]*(,?)/\1!0\2/g' "$f"
		MODIFIED=true
	fi
	
	# devTools: <expr containing allowDevtools> → devTools:!0
	if grep -q 'devTools' "$f" 2>/dev/null; then
		sed -i '' -E 's/(devTools:)[[:space:]]*[a-zA-Z_$][a-zA-Z0-9_$.]*(\?\.)?[a-zA-Z_$][a-zA-Z0-9_$.]*/\!0/g' "$f" 2>/dev/null || true
		# Simpler: just find devTools:...allowDevtools patterns
		sed -i '' -E '/devTools:/{/allowDev[tT]ools/ s/(devTools:)[^,}]+/\1!0/}' "$f"
		MODIFIED=true
	fi
	
	if $MODIFIED; then
		echo "  patched: $(basename "$f")"
		PATCHED=$((PATCHED+1))
	fi
done

echo "  [ok] $PATCHED files patched"
