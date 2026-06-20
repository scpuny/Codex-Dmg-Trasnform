#!/usr/bin/env bash
# patch-util.sh — 补丁脚本共享工具函数
set -euo pipefail

# 路径配置
ASAR_DIR="${ASAR_DIR:-}"
SRC_DIR=""

# 设置 ASAR 内容目录（已解压的 _asar/）
set_asar_dir() {
	SRC_DIR="$1"
	if [ -z "$SRC_DIR" ] || [ ! -d "$SRC_DIR" ]; then
		echo "Error: ASAR directory not found: $SRC_DIR" >&2
		return 1
	fi
	echo "patch-util: ASAR dir = $SRC_DIR"
}

# 在 .vite/build/ 中查找匹配模式的文件
find_build_bundle() {
	local pattern="$1"
	local platform="${2:-}"
	local dir="$SRC_DIR/.vite/build"
	[ ! -d "$dir" ] && return 1
	find "$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | head -1
}

# 在 webview/assets/ 中查找匹配模式的文件
find_assets_bundle() {
	local pattern="$1"
	local platform="${2:-}"
	local dir="$SRC_DIR/webview/assets"
	[ ! -d "$dir" ] && return 1
	find "$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | head -1
}

# 搜索包含特定字符串的文件
find_files_containing() {
	local dir="$1"
	local pattern="$2"
	shift 2
	[ ! -d "$dir" ] && return 0
	grep -rl "$pattern" "$dir" --include="*.js" 2>/dev/null || true
}
