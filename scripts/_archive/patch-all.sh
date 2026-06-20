#!/usr/bin/env bash
# patch-all.sh — 按顺序运行所有补丁
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHES_DIR="$SCRIPT_DIR/patches"

CHECK_ONLY=false
ASAR_CONTENT_DIR=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--asar-dir) ASAR_CONTENT_DIR="$2"; shift 2 ;;
		--check) CHECK_ONLY=true; shift ;;
		*) echo "Unknown: $1"; exit 1 ;;
	esac
done

if [ -z "$ASAR_CONTENT_DIR" ] || [ ! -d "$ASAR_CONTENT_DIR" ]; then
	echo "Usage: $0 --asar-dir path/_asar [--check]"
	exit 1
fi

export ASAR_CONTENT_DIR
export CHECK_ONLY

echo "== patch-all =="
echo "  ASAR dir: $ASAR_CONTENT_DIR"
echo "  Check:    $CHECK_ONLY"
echo ""

# 按顺序运行
PATCHES=(
	"patch-i18n.sh"
	"patch-copyright.sh"
	"patch-devtools.sh"
	"patch-updater.sh"
	"patch-sunset.sh"
)

FAILED=0
for patch in "${PATCHES[@]}"; do
	script="$PATCHES_DIR/$patch"
	if [ ! -f "$script" ]; then
		echo "  [skip] $patch not found"
		continue
	fi
	echo ""
	echo "== $patch =="
	if bash "$script" 2>&1 | sed 's/^/  /'; then
		echo "  [ok] $patch succeeded"
	else
		echo "  [x] $patch FAILED"
		FAILED=$((FAILED+1))
	fi
done

echo ""
echo "== Summary: patches $([ $FAILED -eq 0 ] && echo 'succeeded' || echo "FAILED: $FAILED") =="
[ $FAILED -gt 0 ] && exit 1 || exit 0
