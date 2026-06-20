#!/usr/bin/env bash
# update-integrity.sh — 更新 Info.plist 中的 ElectronAsarIntegrity 哈希
# 在替换 app.asar 后运行，防止 Electron 拒绝加载被修改的 ASAR
# 用法: ./scripts/update-integrity.sh path/Codex.app

set -euo pipefail

APP_PATH="${1:-}"
[ -z "$APP_PATH" ] && { echo "Usage: $0 path/Codex.app"; exit 1; }
[ ! -d "$APP_PATH" ] && { echo "Error: $APP_PATH not found"; exit 1; }

ASAR_PATH="$APP_PATH/Contents/Resources/app.asar"
PLIST_PATH="$APP_PATH/Contents/Info.plist"

[ ! -f "$ASAR_PATH" ] && { echo "Error: app.asar not found"; exit 1; }
[ ! -f "$PLIST_PATH" ] && { echo "Error: Info.plist not found"; exit 1; }

python3 - "$ASAR_PATH" "$PLIST_PATH" << 'PYEOF'
import plistlib, hashlib, sys

asar_path = sys.argv[1]
plist_path = sys.argv[2]

with open(asar_path, 'rb') as f:
    header_bytes = f.read(8)
    if len(header_bytes) >= 8:
        header_size = int.from_bytes(header_bytes[4:8], 'little')
        if header_size > 0:
            header_data = f.read(header_size)
            new_hash = hashlib.sha256(header_data).hexdigest()
        else:
            new_hash = ""
    else:
        new_hash = ""

with open(plist_path, 'rb') as f:
    plist = plistlib.load(f)

integrity = plist.get('ElectronAsarIntegrity', {})
if 'Resources/app.asar' in integrity:
    integrity['Resources/app.asar']['hash'] = new_hash
    integrity['Resources/app.asar']['algorithm'] = 'SHA256'
    plist['ElectronAsarIntegrity'] = integrity

with open(plist_path, 'wb') as f:
    plistlib.dump(plist, f)

if new_hash:
    print(f"✅ ElectronAsarIntegrity updated: {new_hash[:16]}...")
else:
    print("⚠️  Could not read ASAR header hash")
PYEOF
