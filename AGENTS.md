# AGENTS.md
适用于 OpenAI Codex 的 Karpathy 编码行为规范，减少大模型编码出错概率。
优先保证代码正确性与严谨性，而非追求速度；简单琐碎任务可适当放宽部分规则。

## 一、编码前先梳理思路
绝不擅自脑补需求与上下文信息。
- 编写代码前，清晰列出你所有的前置假设。若存在任何模糊细节，立刻停止并向我确认。
- 如果任务存在多种合理解读方案，列出全部可选方案并对比各自优劣，不要随意自行选定一种。
- 若存在更简洁的实现方式，主动指出并对比两种方案的优缺点。
- 明确标出所有需要我确认的存疑内容。

## 二、极简优先原则
仅实现用户明确提出的需求，不额外增加任何未要求的逻辑。
- 禁止新增未指定功能、可配置拓展、为一次性代码设计通用抽象结构。
- 对于需求中未提及、理论上不可能出现的极端场景，无需冗余异常捕获处理。
- 代码保持精简：能用少量代码完成的逻辑，拒绝堆砌大量模板冗余代码。
- 自我校验：资深工程师看到这份代码会不会认为过度设计？如果是，立刻简化重构。

## 三、精准微创修改（Codex 文件编辑核心规则）
仅修改完成任务必不可少的代码行与文件。
- 不得重构、格式化、优化和本次修改无关的原有代码、注释、导入语句。
- 严格贴合项目现有的编码风格、变量命名、缩进格式。
- 不要删除和本次改动无关的未使用变量、导入语句；仅标记无效废弃代码，不直接删除。
- 在没有用户指令的前提下，不要改动运行正常的相邻业务逻辑。

## 四、目标导向开发 + 自我校验
开发前先定义可量化的完成标准，反复迭代直至校验通过。
1. 先写出验收标准与校验条件
2. 完成代码修改实现
3. 对照标准进行验证
4. 若校验不通过，修复问题并重新检查，确认无误才算任务完成

## Codex 专属附加强制规则（仅适用于 OpenAI Codex 智能体）
1. 通过终端/Git 修改文件时：仅提交本次产生的改动，保证工作区干净无多余变更。
2. 无明确指令时，不新建 Git 分支。
3. 文件修改完成后，执行基础校验命令（代码规范检查、单元测试（如有））。
4. 任务全部结束后，总结修改过的文件、改动目的以及执行的校验步骤。
5. 高危破坏性命令（rm -rf、数据库删表等），必须二次征得用户确认才可执行。

--- project-doc ---

# Codex Dmg Transform — Agent Guide

## Project Overview

This project downloads the official **Codex.app** (OpenAI's desktop Electron application) for Intel Mac (x86_64) from OpenAI's CDN **appcast-x64.xml**, patches the ASAR to fix i18n/DevTools/updater issues using **AST-based Node.js patches**, re-signs it while preserving the original Electron framework, and creates a distributable `.dmg`. It also builds Linux packages from the same ASAR content.

**Key difference from typical forks**: We **do not** replace the Electron framework. The official x64 ZIP already contains the correct `Codex Framework.framework` with `electron_common_owl_features` native binding. We keep the original framework and only patch the `app.asar` (frontend bundle, platform-agnostic) and re-sign.

**Original source**: `appcast-x64.xml` → official `Codex-darwin-x64-{version}.zip`

## Project Structure

```
/
├── AGENTS.md                    # This file
├── Design.md                    # Architecture & design document (legacy)
├── package.json                 # Node.js project with forge/devDeps
├── forge.config.js              # Electron Forge configuration
├── resources/
│   ├── electron.icns            # macOS app icon
│   ├── electron.ico             # Windows app icon (unused)
│   ├── electron.png             # Linux app icon
│   └── notification.wav         # Notification sound
├── scripts/
│   ├── sync-upstream.js         # Download & extract from appcast XML
│   ├── patch-all.js             # Run all patches in sequence
│   ├── patch-util.js            # Shared patch utilities
│   ├── patch-i18n.js            # Force-enable i18n (中文)
│   ├── patch-copyright.js       # Update copyright text
│   ├── patch-devtools.js        # Enable DevTools
│   ├── patch-updater.js         # Disable auto-updater (Sparkle + Windows)
│   ├── patch-sunset.js          # Disable appSunset gate
│   ├── patch-fast-mode.js       # Force-enable Fast mode (speed selector)
│   ├── patch-plugin-auth.js     # Remove plugin auth gate + force browser-use
│   ├── patch-statsig-logger.js  # Inject Statsig cloud-control value logger
│   ├── patch-gpu.js             # Force high-performance GPU (Intel Mac x64)
│   ├── patch-archive-delete.js  # Add "Delete" button to archived list
│   ├── build-from-upstream.js   # macOS: repack → sign → DMG
│   ├── prepare-src.js           # Linux: repack → forge-compatible src/
│   ├── sync-native-modules.js   # Linux: sync rebuilt native modules
│   ├── check-update.js          # Check for new upstream version
│   ├── bump-version.js          # Bump version in package.json
│   └── start-dev.js             # Development startup script
├── src/                         # Generated: extracted upstream content
├── out/                         # Generated: build output (DMG, etc.)
├── .github/workflows/
│   └── download-and-patch.yml   # CI/CD: detect → patch → release
└── packages/                    # Legacy build output (may contain downloads)
```

## Key Design Decisions

### 1. No Framework Replacement

The official Codex.app uses a **custom** `Codex Framework.framework` based on Chromium 149. Replacing it with standard Electron:
- Loses `electron_common_owl_features` native binding
- Breaks bundle code signature structure
- Causes "password prompt" Gatekeeper errors

**Instead**: Keep the original framework. Only patch the ASAR.

### 2. AST-based Patches (acorn)

All patches use [acorn](https://github.com/acornjs/acorn) for **AST matching** instead of fragile sed/regex:
- `patch-i18n.js`: Replaces `.get("enable_i18n", ...)` → `!0` (acorn CallExpression match)
- `patch-devtools.js`: Replaces `allowInspectElement: <expr>` → `!0`
- `patch-copyright.js`: Replaces `copyright: "(c) OpenAI"` → customized string
- `patch-updater.js`: Replaces `shouldIncludeSparkle()` return value → `!1`
- `patch-sunset.js`: Replaces gate calls in functions containing sunset keys
- etc.

### 3. Code Signing

We preserve `ElectronAsarIntegrity` in Info.plist (update the SHA256 hash after ASAR repack):
1. `codesign --remove-signature` — strip original
2. `xattr -rd com.apple.quarantine` — remove quarantine flag
3. `codesign --sign - --force --deep` — ad-hoc re-sign

## Build Pipeline

### macOS x64 (macOS runner)

```bash
npm ci
node scripts/sync-upstream.js --skip-arm64  # Download x64 ZIP → src/mac-x64/
node scripts/patch-all.js mac-x64           # AST patches on _asar/
node scripts/build-from-upstream.js --platform mac-x64  # Repack → sign → DMG
# Output: out/mac-x64/Codex-{version}-macos-x64.dmg
```

### Linux amd64/arm64 (Linux runner)

```bash
npm ci
# Download macOS x64 ZIP → extract to src/mac-x64/
node scripts/patch-all.js mac-x64           # AST patches (platform agnostic)
node scripts/prepare-src.js --platform linux-x64  # Prepare src/ for forge
npm run rebuild:native                      # electron-rebuild
node scripts/sync-native-modules.js --platform linux-x64
rm -rf out && npx electron-forge make --platform=linux --arch=x64
# Output: out/make/deb/, out/make/rpm/, out/make/zip/ (all formats)
```

**Note**: Linux builds now use Electron Forge's full pipeline (not manual assembly), producing `.deb`, `.rpm`, and `.tar.gz` automatically.

## CI/CD (GitHub Actions)

**Workflow**: `.github/workflows/download-and-patch.yml`

| Trigger | Description |
|---------|-------------|
| `cron: '0 */6 * * *'` | Every 6 hours: check appcast-x64.xml, compare cached version |
| `workflow_dispatch` | Manual: optional `force` (redownload) and `version` (specific build) |

Jobs:
1. **detect** (ubuntu): Parse appcast → version comparison → skip if cached
2. **build-macos-x64** (macos-13): Full pipeline → `.dmg` artifact
3. **build-linux** (ubuntu, matrix x64/arm64): Patch → forge → `.deb`/`.tar.gz`
4. **release**: Collect artifacts → GitHub Release

## Patches

All patches modify the extracted `_asar/` content before repacking `app.asar`:

| Patch | What it does | Target method |
|-------|-------------|---------------|
| `patch-i18n.js` | `.get("enable_i18n", ...)` → `!0` | Acorn CallExpression match |
| `patch-copyright.js` | `copyright: "(c) OpenAI"` → custom | Acorn Property match |
| `patch-devtools.js` | `allowInspectElement: <expr>` → `!0` | Acorn Property match |
| `patch-updater.js` | `shouldIncludeSparkle()` return `!1` | Acorn ReturnStatement match |
| `patch-sunset.js` | Gate calls in sunset functions → `!1` | AST walk + numeric string match |
| `patch-fast-mode.js` | `authMethod !== "chatgpt"` → `!1` | AST walk + function scope |
| `patch-plugin-auth.js` | Plugin auth/browser-use gates → `!0` | Multi-rule AST match |
| `patch-statsig-logger.js` | Inject logger into `_setStatus` | AST MethodDefinition match |
| `patch-gpu.js` | Append `force_high_performance_gpu` switch | AST import detection |
| `patch-archive-delete.js` | Add Delete button to archived list | AST import + JSX injection |

## Linux Notes

Linux builds use:
1. **ASAR content** from macOS x64 (platform-agnostic JS/HTML)
2. **Standard Electron** runtime (via `electron-rebuild` for native modules)
3. **Native modules**: rebuilt via `electron-rebuild` for the target Linux arch
4. **Codex binary**: not available for Linux; kept upstream macOS binary (will not function)

### Known Linux Limitations
- `codex` / `codex_chronicle` backend binaries are macOS-only; no Linux cross-compile available
- Some native modules (`objc-js`, `node-mac-permissions`) are macOS-only and skipped
- The app's backend features (AI completions, etc.) require the `codex` binary which is not available for Linux

## Coding Conventions

- **JavaScript**: Node.js 22+, ES2022+
- **Patches**: AST-based (acorn parser), not regex
- **Error handling**: Meaningful messages, `process.exit(1)` on hard failures
- **Documentation**: Keep AGENTS.md in sync with code changes
