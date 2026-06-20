#!/usr/bin/env bash
# patch-i18n.sh — 强制启用 i18n（绕过 Statsig 云控）
#
# 将 .get("enable_i18n", ...) 或 .get('enable_i18n', ...) 或 .get(`enable_i18n`, ...)
# 全部替换为 !0
#
# 注意：参考项目中 enable_i18n 键可能为反引号模板字符串
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
		python3 - "$f" << 'PYEOF'
import re
import sys

filepath = sys.argv[1]
with open(filepath, "r") as fp:
    code = fp.read()

# 匹配任意形式的 .get("enable_i18n", ...) .get('enable_i18n', ...) .get(`enable_i18n`, ...)
# 包括前面有 x.get、x?.get、ie("id")?.get 等
# 注意：enable_i18n 可能用单引号、双引号或反引号包裹
new_code = re.sub(
    r'\.[a-zA-Z_]\w*\([\u0022\u0027\u0060]enable_i18n[\u0022\u0027\u0060][^)]*\)',
    '.get("enable_i18n",!0)',  # 先标准化调用（保留不变也行，反正后续还会被替换）
    code
)

# 第二步：将 .get("enable_i18n", ...) 替换为 !0（包括可能的前置链式调用）
# 模式: identifier(...)?.get("enable_i18n",...) 或 identifier.get("enable_i18n",...)
new_code = re.sub(
    r'[a-zA-Z_]\w*(?:\([^)]*\))?(?:\?\.|\.)get\([\u0022\u0027\u0060]enable_i18n[\u0022\u0027\u0060][^)]*\)',
    '!0',
    new_code
)

with open(filepath, "w") as fp:
    fp.write(new_code)

print("  patched: " + filepath.split("/")[-1])
PYEOF
		PATCHED=$((PATCHED+1))
	fi
done

echo "  [ok] $PATCHED files patched"
