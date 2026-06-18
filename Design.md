# Codex Dmg Transform — Design Document

## 1. Project Goal

Disassemble the official **Codex.dmg** (OpenAI Codex desktop app for macOS ARM64) and create a cross-platform packaging pipeline that produces installable packages for:

| Platform | Arch | Package Format | CI Runner |
|---|---|---|---|
| macOS (Intel) | x86_64 | `.dmg` | `macos-13` |
| macOS (Apple Silicon) | arm64 | `.dmg` | `macos-14` (large) |
| Linux | x86_64 | `.deb` + `.AppImage` | `ubuntu-22.04` |
| Linux | arm64 | `.deb` + `.AppImage` | `ubuntu-22.04-arm` |
| Windows | x86_64 | `.exe` + `.msi` | `windows-2022` |

---

## 2. Original Application Architecture

```
Codex.app/
├── Contents/
│   ├── MacOS/Codex              # Electron launcher binary (ARM64, ~70 KB)
│   ├── Info.plist               # Bundle metadata (CFBundleVersion: 4028)
│   ├── Frameworks/
│   │   ├── Codex Framework.framework/   # Electron framework (Chromium 149)
│   │   │   └── Versions/149.0.7827.115/
│   │   │       ├── Codex Framework      # Electron binary (ARM64)
│   │   │       └── Libraries/
│   │   │           ├── libEGL.dylib
│   │   │           ├── libGLESv2.dylib
│   │   │           └── libvk_swiftshader.dylib
│   │   └── Sparkle.framework/           # Auto-update framework (macOS only)
│   ├── PlugIns/
│   │   └── CodexDockTilePlugin.plugin/  # Dock tile plugin (ARM64)
│   ├── Resources/
│   │   ├── app.asar              # Electron frontend bundle (153 MB, platform-agnostic)
│   │   ├── app.asar.unpacked/   # Native Node modules (per-platform binaries)
│   │   │   └── node_modules/
│   │   │       ├── node-pty/           # PTY support
│   │   │       ├── better-sqlite3/     # SQLite
│   │   │       ├── node-mac-permissions/ # macOS permissions (macOS only)
│   │   │       └── @worklouder/        # Device kit
│   │   ├── codex                # AI backend binary (236 MB, ARM64, Mach-O)
│   │   ├── codex_chronicle      # Chronicle service binary (4.5 MB, ARM64)
│   │   ├── cua_node/            # Custom Node.js runtime
│   │   │   ├── bin/node         # Node.js 24.14.0 (119 MB, ARM64)
│   │   │   ├── bin/node_repl    # Node REPL (15 MB, ARM64)
│   │   │   └── manifest.json    # Platform: darwin-arm64
│   │   ├── plugins/             # Bundled Codex plugins
│   │   └── *.lproj/             # Localizations
│   └── _CodeSignature/          # Code signing
```

### 2.1 Component Dependency Graph

```
┌─────────────────────────────────────────────────┐
│                  Codex.app                      │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │  Electron     │  │  app.asar               │  │
│  │  Framework    │  │  ┌───────────────────┐  │  │
│  │  (Chromium)   │  │  │  Electron UI (Vite)│  │  │
│  └──────┬───────┘  │  │  + Skills/Webview   │  │  │
│         │          │  └───────────────────┘  │  │
│         │          │  ┌───────────────────┐  │  │
│         │          │  │  Native Modules    │  │  │
│         │          │  │  (node-pty, sqlite,│  │  │
│         │          │  │   objc, perms, hid)│  │  │
│         ▼          │  └───────────────────┘  │  │
│  ┌──────────────┐  │  ┌───────────────────┐  │  │
│  │  codex       │  │  │  codex_chronicle   │  │  │
│  │  (AI backend)│──┼──│  (logging svc)    │  │  │
│  └──────┬───────┘  │  └───────────────────┘  │  │
│         │          │  ┌───────────────────┐  │  │
│         ▼          │  │  cua_node          │  │  │
│  ┌──────────────┐  │  │  (Node.js 24 +    │  │  │
│  │  Sparkle     │  │  │   node_repl)      │  │  │
│  │  (updater)   │  │  └───────────────────┘  │  │
│  └──────────────┘  │                          │  │
└─────────────────────────────────────────────────┘
```

---

## 3. Cross-Platform Strategy

### 3.1 Platform-Agnostic Components

These components work on all platforms without modification:

| Component | Reason |
|---|---|
| `app.asar` | Electron ASAR archive contains JS/HTML/CSS — no native code |
| `Resources/plugins/` | Plugin definitions are metadata/SKILL files |
| `*.lproj/` | Localization strings |
| `Resources/*.png`, `.icns`, `.wav` | Static assets |

### 3.2 Platform-Specific Components

These must be replaced or rebuilt for each target platform:

| Component | macOS ARM64 (Original) | macOS Intel (x64) | Linux amd64 | Linux arm64 | Windows x64 |
|---|---|---|---|---|---|
| **Electron Framework** | `Codex Framework.framework` (arm64) | Electron x64 build | Electron x64 build | Electron arm64 build | Electron x64 build |
| **Electron binary** | `MacOS/Codex` (arm64) | x64 binary | x64 binary | arm64 binary | x64 binary |
| **codex binary** | Mach-O arm64 | Mach-O x86_64 | ELF x86_64 | ELF AArch64 | PE x86_64 |
| **codex_chronicle** | Mach-O arm64 | Mach-O x86_64 | ELF x86_64 | ELF AArch64 | PE x86_64 |
| **cua_node/node** | Node.js darwin-arm64 | Node.js darwin-x64 | Node.js linux-x64 | Node.js linux-arm64 | Node.js win-x64 |
| **cua_node/node_repl** | darwin-arm64 binary | darwin-x64 binary | linux-x64 binary | linux-arm64 binary | win-x64 binary |
| **Native Node modules** | arm64 `.node` files | x64 `.node` files | x64 `.node` files | arm64 `.node` files | x64 `.node` files |
| **Auto-update** | Sparkle.framework | Sparkle (x64) | electron-updater | electron-updater | Squirrel.Windows |
| **Dock tile plugin** | CodexDockTilePlugin | Intel variant | N/A | N/A | N/A |
| **macOS permissions** | `node-mac-permissions` | x64 build | Not needed | Not needed | Not needed |

### 3.3 Binary Procurement Strategy

For the `codex` and `codex_chronicle` backend binaries:

```
Priority 1: Download official prebuilt binaries per platform
  - Source: OpenAI's release channels / CDN
  - Checksum-verified

Priority 2: Cross-compile from source
  - Requires: Go / Rust toolchain per target
  - GOOS/GOARCH or rustup target triples

Priority 3: Use QEMU/binfmt for ARM builds on x86 CI
  - Docker multi-arch builds via buildx
```

For `cua_node` runtime:

```
- Node.js 24.14.0 is standard — download official Node.js builds
- node_repl binary: download platform-specific build
- Both verified via SHA256SUMS
```

For Electron framework:

```
- Use `@electron/get` or `electron-download` to fetch per-platform Electron
- Version: 149.0.7827.115 (Chromium 149)
- Verified via electronjs.org SHASUMS256.txt
```

---

## 4. Packaging Pipeline

### 4.1 Extract Phase

```
Codex.dmg
    │
    ├─ [Linux/macOS] dmg2img → Codex.img → mount → copy Codex.app
    │
    └─ Extract app.asar & unpacked native modules
```

### 4.2 Build Phase (per platform)

```
Extracted Codex.app
    │
    ├─ 1. Replace Electron framework (per-platform binary)
    ├─ 2. Replace codex binary (per-platform)
    ├─ 3. Replace codex_chronicle binary (per-platform)
    ├─ 4. Replace cua_node runtime (per-platform)
    ├─ 5. Rebuild native Node modules (per-platform)
    ├─ 6. Replace/remove platform-specific plugins
    │     - macOS: keep DockTilePlugin, node-mac-permissions
    │     - Linux: remove DockTilePlugin, Sparkle, mac-permissions
    │     - Windows: remove DockTilePlugin, Sparkle, mac-permissions
    ├─ 7. Update Info.plist (per-platform metadata)
    └─ 8. Sign & notarize (macOS) or code sign (Windows)
```

### 4.3 Package Phase (per platform)

| Platform | Installer | Tool |
|---|---|---|
| macOS | `.dmg` | `create-dmg` or `electron-notarize` |
| macOS | `.pkg` | `pkgbuild` + `productbuild` |
| Linux x64 | `.deb` | `electron-installer-debian` |
| Linux x64 | `.AppImage` | `@electron-forge/maker-appimage` |
| Linux arm64 | `.deb` | `electron-installer-debian` (arm64) |
| Windows | `.exe` (NSIS) | `@electron-forge/maker-squirrel` |
| Windows | `.msi` | `@electron-forge/maker-msi` |

---

## 5. GitHub Actions Workflow Design

### 5.1 Workflow Matrix

```yaml
jobs:
  package:
    strategy:
      matrix:
        include:
          - target: macos-x64
            runner: macos-13
            arch: x64
            output: .dmg
          - target: macos-arm64
            runner: [macos-14, large]
            arch: arm64
            output: .dmg
          - target: linux-amd64
            runner: ubuntu-22.04
            arch: x64
            output: .deb
          - target: linux-arm64
            runner: ubuntu-22.04-arm
            arch: arm64
            output: .deb
          - target: windows-x64
            runner: windows-2022
            arch: x64
            output: .exe
```

### 5.2 Workflow Steps (shared)

1. **Checkout** — repository with Codex.dmg (via Git LFS)
2. **Setup** — install dmg2img, Node.js, Go/Rust (as needed)
3. **Extract** — decompress Codex.dmg → mount → extract app bundle
4. **Download platform binaries** — Electron, codex, codex_chronicle, cua_node
5. **Rebuild native modules** — `npm rebuild` for target platform
6. **Package** — create platform-specific installer
7. **Upload artifact** — publish built package

### 5.3 Release Workflow

```mermaid
graph LR
    A[Codex.dmg] --> B[Extract]
    B --> C1[macOS x64 Build]
    B --> C2[macOS ARM64 Build]
    B --> C3[Linux x64 Build]
    B --> C4[Linux ARM64 Build]
    B --> C5[Windows Build]
    C1 --> D[Release]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    D --> E[GitHub Release]
    D --> F[Docker Hub (optional)]
```

---

## 6. Dependency Map

```
Build-time Dependencies:
├── dmg2img / 7z              # Extract Codex.dmg
├── Node.js >= 22             # Run packaging scripts
├── pnpm                      # Package manager (matching source)
├── @electron/asar            # Extract/repack app.asar
├── electron-download         # Fetch per-platform Electron
├── create-dmg                # macOS .dmg creation
├── nsis / msi               # Windows installer tools
├── dpkg-dev / fpm            # Linux .deb creation
└── Go / Rust toolchain       # Cross-compile codex backend

Runtime Components (included in package):
├── Electron + Chromium 149   # App shell
├── app.asar                  # Frontend (platform-agnostic)
├── codex binary              # AI backend (platform-specific)
├── codex_chronicle           # Service (platform-specific)
├── cua_node (Node 24.14)     # Node runtime (platform-specific)
├── Node native modules       # Rebuilt per platform
└── Platform updater          # Sparkle / Squirrel / electron-updater
```

---

## 7. Security & Integrity

- **Checksum verification**: All downloaded binaries verified via SHA256
- **Code signing**: macOS packages notarized; Windows packages Authenticode-signed
- **Original integrity**: `Codex.dmg` is read-only; extraction is deterministic
- **Reproducible builds**: Lock dependency versions in packaging scripts

---

## 8. Future Considerations

1. **Docker packaging**: Package as Docker image for server-side/headless usage
2. **Automated updates**: Wire platform-specific update channels
3. **Source rebuild**: If `codex` binary source becomes available, compile from source
4. **Testing matrix**: Add smoke tests (app launches, backend responds) per platform
5. **Nightly builds**: Automated nightly rebuilds to track latest Codex releases
