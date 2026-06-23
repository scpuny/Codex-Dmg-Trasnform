const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");
const fs = require("fs");

module.exports = {
  packagerConfig: {
    name: "Codex",
    executableName: "Codex",
    appBundleId: "com.openai.codex",
    icon: "./resources/electron",
    // Build mode is set by prepare-src.js via src/.build-mode marker file.
    // "upstream-asar": mac — we provide pre-built app.asar, forge skips ASAR packing.
    // "linux": forge packs ASAR from src/ content (needs electron-rebuild).
    asar: (() => {
      try {
        const mode = fs.readFileSync(path.join(__dirname, "src", ".build-mode"), "utf-8").trim();
        if (mode === "upstream-asar") {
          // macOS 预打包asar，完全关闭forge打包
          return false;
        } else {
          // Linux：禁止自动解压所有.node，只保留少量非图形辅助二进制
          return {
            unpack: "{**/node-pty/build/Release/spawn-helper,**/node-pty/prebuilds/*/spawn-helper}"
          };
        }
      } catch {
        return false;
      }
    })(),
    ignore: (() => {
      let mode = "upstream-asar";
      try { mode = fs.readFileSync(path.join(__dirname, "src", ".build-mode"), "utf-8").trim(); } catch {}
      return mode === "upstream-asar"
        ? (filePath) => {
            if (filePath === "") return false;
            if (filePath === "/package.json") return false;
            if (filePath === "/src" || filePath.startsWith("/src/.vite")) return false;
            return true;
          }
        : (filePath) => {
            // Linux mode: paths are absolute from project root
            // filePath format: /src/.vite/build/bootstrap.js, /package.json, etc.
            if (filePath === "") return false;
            if (filePath === "/package.json") return false;
            const allowed = ["/src/.vite/build", "/src/webview", "/src/skills", "/src/native-menu-locales", "/src/node_modules"];
            for (const p of allowed) {
              if (p.startsWith(filePath) || filePath.startsWith(p)) return false;
            }
            return true;
          };
    })(),
    osxSign: process.env.SKIP_SIGN ? undefined : {
      identity: process.env.APPLE_IDENTITY || "-",
      identityValidation: false,
    },
    osxNotarize: process.env.SKIP_NOTARIZE ? undefined : {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    },
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-dmg", config: { format: "ULFO", icon: "./resources/electron.icns" } },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "codex",
          productName: "Codex",
          genericName: "AI Coding Assistant",
          categories: ["Development", "Utility"],
          bin: "Codex",
          maintainer: "OpenAI",
          homepage: "https://github.com/scpuny/Codex-Dmg-Trasnform",
          icon: "./resources/electron.png",
          desktopTemplate: path.join(__dirname, "resources", "codex.desktop"),
          scripts: { postinst: path.join(__dirname, "resources", "deb-scripts", "postinst") }
        }
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          name: "codex",
          productName: "Codex",
          genericName: "AI Coding Assistant",
          categories: ["Development", "Utility"],
          bin: "Codex",
          license: "Apache-2.0",
          homepage: "https://github.com/scpuny/Codex-Dmg-Trasnform",
          icon: "./resources/electron.png"
        }
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["linux"] },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-fuses",
      config: {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: true,
        [FuseV1Options.EnableCookieEncryption]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: false,
      },
    },
  ],
  hooks: {
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      console.log(`\n-- packageAfterCopy: ${platform}-${arch}`);

      const resourcesPath = path.dirname(buildPath);
      const isLinux = platform === "linux";

      // For Linux: ASAR is platform-agnostic, always use mac-x64 as source
      let platformKey;
      if (platform === "darwin") {
        platformKey = "mac-x64";
      } else if (platform === "linux") {
        platformKey = "mac-x64";
      } else {
        console.log(`   [!] Unsupported platform: ${platform}`);
        return;
      }

      const platformDir = path.join(__dirname, "src", platformKey);
      if (!fs.existsSync(platformDir)) {
        console.log(`   [!] src/${platformKey}/ not found`);
        return;
      }

      const skip = new Set(["_asar"]);
      const MACOS_ONLY_FILES = new Set([
        "node", "node_repl",
        "electron.icns", "Assets.car",
        "codexTemplate.png", "codexTemplate@2x.png",
        "app.asar", "codex-notification.wav",
      ]);
      const MACOS_ONLY_DIRS = new Set(["native", "app.asar.unpacked"]);
      if (isLinux) {
        for (const f of MACOS_ONLY_FILES) skip.add(f);
        for (const d of MACOS_ONLY_DIRS) skip.add(d);
      }
      let copied = 0;

      /**
       * 递归复制目录，Linux环境自动删除所有 .node 原生模块
       */
      const copyDir = (s, d) => {
        fs.mkdirSync(d, { recursive: true });
        for (const e of fs.readdirSync(s, { withFileTypes: true })) {
          const sp = path.join(s, e.name), dp = path.join(d, e.name);
          // Linux 直接跳过所有 .node 文件，杜绝owl绑定
          if (isLinux && e.isFile() && path.extname(e.name) === ".node") {
            console.log(`   [linux-clean] skip mac native binding: ${e.name}`);
            continue;
          }
          if (e.isDirectory()) copyDir(sp, dp);
          else if (!e.isSymbolicLink()) {
            fs.copyFileSync(sp, dp);
            copied++;
          }
        }
      };

      for (const entry of fs.readdirSync(platformDir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        if (entry.name.endsWith(".lproj")) continue;

        const srcPath = path.join(platformDir, entry.name);
        const destPath = path.join(resourcesPath, entry.name);

        if (entry.isDirectory()) {
          copyDir(srcPath, destPath);
        } else if (!entry.isSymbolicLink()) {
          // 再次拦截顶层.node文件
          if (isLinux && path.extname(entry.name) === ".node") {
            console.log(`   [linux-clean] skip top-level mac native binding: ${entry.name}`);
            continue;
          }
          fs.copyFileSync(srcPath, destPath);
          try { fs.chmodSync(destPath, 0o755); } catch {}
          copied++;
        }
      }

      // Filter architecture-specific binaries in cua_node for Linux
      if (isLinux) {
        const cuaNodeSkyBin = path.join(resourcesPath, "cua_node", "lib", "node_modules", "@oai", "sky", "bin", "linux");
        if (fs.existsSync(cuaNodeSkyBin)) {
          const keepSuffix = arch === "arm64" ? "arm64" : "x64";
          for (const f of fs.readdirSync(cuaNodeSkyBin)) {
            if (f.endsWith(`_${keepSuffix}`)) continue;
            if (f.endsWith("_arm64") || f.endsWith("_x64")) {
              fs.unlinkSync(path.join(cuaNodeSkyBin, f));
              console.log(`   [linux] removed mismatched arch binary: ${f}`);
            }
          }
        }
        // Clean up .bin/ symlinks
        const cuaNodeBin = path.join(resourcesPath, "cua_node", "lib", "node_modules", ".bin");
        if (fs.existsSync(cuaNodeBin)) {
          for (const f of fs.readdirSync(cuaNodeBin)) {
            if (f.startsWith("sky_linux_")) {
              const full = path.join(cuaNodeBin, f);
              try {
                if (fs.lstatSync(full).isSymbolicLink()) {
                  fs.unlinkSync(full);
                  console.log(`   [linux] removed sky symlink: ${f}`);
                }
              } catch {}
            }
          }
        }
        // Create wrapper script (fixes sandbox issues in desktop launchers)
        // Write one level above resources/ so it ends up at /usr/lib/codex/codex-wrapper
        const wrapperPath = path.join(resourcesPath, "..", "codex-wrapper");
        if (!fs.existsSync(wrapperPath)) {
          fs.writeFileSync(wrapperPath, `#!/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd)"
exec "$HERE/Codex"   --no-sandbox --enable-font-antialiasing   --font-render-hinting=full   "$@"
`);
          fs.chmodSync(wrapperPath, 0o755);
          console.log(`   [wrapper] codex-wrapper created`);
        }
      }

      console.log(`   [ok] ${copied} files (已过滤macOS .node原生绑定模块)`);
    },
  },
};