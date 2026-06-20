# Codex Dmg Transform

Download, patch, re-sign, and package **Codex.app** (OpenAI desktop Electron app) for macOS Intel (x86_64) and Linux.

## Key Design

- **No framework replacement**: Keeps the original `Codex Framework.framework` from the official x64 ZIP
- **AST-based patches**: Uses acorn parser for reliable code modifications
- **Proper code signing**: Preserves `ElectronAsarIntegrity`, ad-hoc re-sign with `codesign`
- **Electron Forge**: For Linux packaging (.deb, .rpm, .zip)

## Quick Start

```bash
npm install
```

### macOS Intel (x86_64)

```bash
# 1. Download official x64 ZIP → extract → src/mac-x64/
node scripts/sync-upstream.js --skip-arm64

# 2. Run all AST patches on _asar/
node scripts/patch-all.js mac-x64

# 3. Repack → re-sign → DMG
node scripts/build-from-upstream.js --platform mac-x64

# Output: out/mac-x64/Codex-{version}-macos-x64.dmg
```

### Linux

```bash
# 1. Download macOS x64 ZIP → extract
node scripts/sync-upstream.js --skip-arm64

# 2. Run patches
node scripts/patch-all.js mac-x64

# 3. Prepare for forge → rebuild native modules → package
node scripts/prepare-src.js --platform linux-x64
npm run rebuild:native
node scripts/sync-native-modules.js --platform linux-x64
rm -rf out && npx electron-forge make --platform=linux --arch=x64
```

### Check for Updates

```bash
node scripts/check-update.js
```

## Project Structure

```
├── forge.config.js              # Electron Forge config
├── package.json                 # Node.js project
├── scripts/
│   ├── sync-upstream.js         # Download & extract from appcast
│   ├── patch-all.js             # Run all AST patches
│   ├── patch-*.js               # Individual patches (i18n, devtools, etc.)
│   ├── build-from-upstream.js   # macOS: repack → sign → DMG
│   ├── prepare-src.js           # Linux: prepare for forge build
│   └── sync-native-modules.js   # Linux: sync rebuilt native modules
├── resources/                   # App icons and assets
└── .github/workflows/           # CI/CD
```

## Patches

All patches modify the ASAR content using AST-based matching (acorn):

| Patch | Effect |
|-------|--------|
| `patch-i18n` | Force-enable Chinese i18n |
| `patch-devtools` | Enable InspectElement + DevTools |
| `patch-updater` | Disable auto-updater |
| `patch-sunset` | Disable forced update gate |
| `patch-fast-mode` | Show speed selector for API key users |
| `patch-plugin-auth` | Remove plugin auth restrictions |
| `patch-copyright` | Update copyright string |
| `patch-gpu` | Force high-performance GPU (Intel Mac) |
| `patch-archive-delete` | Add Delete button to archived conversations |

## Acknowledgments

Based on [CodexDesktop-Rebuild](https://github.com/Haleclipse/CodexDesktop-Rebuild) by Haleclipse / Cometix Space.
Original Codex by OpenAI.
