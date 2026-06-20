# Codex Dmg Transform

> 从官方 OpenAI CDN 自动下载 Codex macOS Intel 版，修补 ASAR 后重新分发。
> 无需从 ARM64 DMG 重建，直接使用官方 x86_64 构建。

[![Download & Patch](https://github.com/scpuny/Codex-Dmg-Trasnform/actions/workflows/download-and-patch.yml/badge.svg)](https://github.com/scpuny/Codex-Dmg-Trasnform/actions/workflows/download-and-patch.yml)

## 解决的问题

OpenAI Codex 桌面版目前只发布 macOS ARM64 (Apple Silicon) 的 DMG。Intel Mac 用户虽然有 x86_64 版本通过 Sparkle 更新分发，但没有独立的下载入口。

本项目：
1. 自动检测官方 x86_64 版本更新（每 6 小时）
2. 下载官方 `.zip` → 修补 ASAR（启用中文 i18n、DevTools、禁用更新）
3. Ad-hoc 签名 → 生成可用的 `.dmg`
4. 发布到 GitHub Releases

## 使用方式

### 📥 下载最新版

去 [Releases 页面](https://github.com/scpuny/Codex-Dmg-Trasnform/releases) 下载最新的 `.dmg`。

### 🤖 自动构建（定时）

工作流每 **6 小时**自动检查 OpenAI 官方 `appcast-x64.xml`：
- 版本无变化 → **跳过**（0 下载流量）
- 检测到新版本 → 自动下载 → 补丁 → 构建 → 创建 Release

### 🖐️ 手动触发构建

在 [Actions 页面](https://github.com/scpuny/Codex-Dmg-Trasnform/actions/workflows/download-and-patch.yml) 点击 **Run workflow**：

| 参数 | 说明 | 示例 |
|------|------|------|
| `force` (boolean) | 勾选 = 跳过版本缓存强制重下 | `true` |
| `version` (string) | 指定版本构建，空=最新版 | `26.616.32156` |

```bash
# 场景1：强制重新构建最新版（即使缓存相同）
# → 勾选 force，留空 version

# 场景2：构建指定历史版本
# → 不勾选 force，version 填 "26.616.31447"

# 场景3：默认检测（同 cron）
# → 不勾选 force，留空 version
```

## 补丁说明

| 补丁 | 作用 |
|------|------|
| **i18n** | 修复设置界面中文选项不可用的问题 |
| **DevTools** | 启用 Inspect Element 和开发者工具 |
| **Auto-updater** | 禁用 Sparkle 自动更新（避免弹窗） |
| **Sunset** | 禁用强制更新门（不会弹出 "Update Required" 全屏） |

## 架构

### macOS x64

```
appcast-x64.xml → Codex-darwin-x64-*.zip → 解压 → 补丁 ASAR → 签名 → DMG
```

保留原始 `Codex Framework.framework`（含 `electron_common_owl_features` 原生绑定），
仅修改 `app.asar`（前端 JS 包）。

### Linux

Linux 构建流程：
1. **macOS 构建完成后**，上传 patched `app.asar` + `app.asar.unpacked` 作为共享产物
2. Linux 构建下载这些共享产物 + 标准 Electron 运行时
3. 重建原生 Node 模块（`rebuild-native-modules.sh`）
4. 打包为 `.tar.gz`

> ⚠️ Linux 版缺少 `codex` 后端二进制，UI 可启动但 AI 后端功能不可用。

## 本地构建

```bash
# macOS x64
./scripts/pack-macos-x64.sh

# Linux amd64（需要先下载运行时）
./scripts/download-runtime.sh --platform linux --arch x64
./scripts/pack-linux-amd64.sh
```

## 项目结构

```
├── scripts/
│   ├── pack-macos-x64.sh           # macOS 构建脚本
│   ├── pack-linux-amd64.sh         # Linux amd64 构建
│   ├── pack-linux-arm64.sh         # Linux arm64 构建
│   ├── patches/                    # ASAR 补丁
│   │   ├── patch-i18n.sh
│   │   ├── patch-copyright.sh
│   │   ├── patch-devtools.sh
│   │   ├── patch-updater.sh
│   │   └── patch-sunset.sh
│   ├── rebuild-native-modules.sh   # 原生模块处理
│   ├── extract.sh                  # DMG 提取（Linux）
│   └── download-runtime.sh         # 运行时下载
├── .github/workflows/
│   └── download-and-patch.yml      # CI/CD 工作流
└── packages/                       # 构建输出
```

## 致谢

- [CodexDesktop-Rebuild](https://github.com/Haleclipse/CodexDesktop-Rebuild) — 参考了其补丁思路和 ASAR 修补方案
