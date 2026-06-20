#!/usr/bin/env bash
# patch-i18n.sh — 强制启用 i18n（绕过 Statsig 云控）
# 将 X?.get("enable_i18n", ...) 或 X.get("enable_i18n", ...) 替换为 !0
#
# 注意：sed 无法可靠处理含 ? 和 . 的复杂 JS 模式，所以使用 python3 正则替换
set -euo pipefail

ASAR_DIR="${ASAR_CONTENT_DIR:-}"
[ -z "$ASAR_DIR" ] && { echo "patch-i18n: ASAR_CONTENT_DIR not set"; exit 1; }

echo "--- patch-i18n: Bypass enable_i18n gate ---"

# 目标：webview/assets/ 中包含 enable_i18n 的 JS 文件
TARGET_DIR="$ASAR_DIR/webview/assets"
[ ! -d "$TARGET_DIR" ] && { echo "  [skip] $TARGET_DIR not found"; exit 0; }

PATCHED=0
for f in "$TARGET_DIR"/*.js; do
	[ -f "$f" ] || continue
	if grep -q 'enable_i18n' "$f" 2>/dev/null; then
		# 使用 python3 做正则替换（比 sed 可靠）
		python3 - "$f" << 'PYEOF'
import re
import sys

filepath = sys.argv[1]
with open(filepath, "r") as fp:
    code = fp.read()

# 匹配:
#   x.get("enable_i18n", ...)
#   x?.get("enable_i18n", ...)
#   ie("72216192")?.get("enable_i18n", ...)
#   X.Y?.get("enable_i18n", ...)
new_code = re.sub(
    r"[a-zA-Z_]\w*(?:\([^)]*\))?(?:\?\.|\.)get\([\"']enable_i18n[\"'][^)]*\)",
    "!0",
    code
)

with open(filepath, "w") as fp:
    fp.write(new_code)

print("  patched: " + filepath.split("/")[-1])
PYEOF
		PATCHED=$((PATCHED+1))
	fi
done

echo "  [ok] $PATCHED files patched"
