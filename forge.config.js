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
        return fs.readFileSync(path.join(__dirname, "src", ".build-mode"), "utf-8").trim() === "upstream-asar"
          ? false
          : { unpack: "{**/*.node,**/node-pty/build/Release/spawn-helper,**/node-pty/prebuilds/*/spawn-helper}" };
      } catch { return false; }
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
      config: { options: { name: "codex", productName: "Codex", genericName: "AI Coding Assistant", categories: ["Development", "Utility"], bin: "Codex", maintainer: "OpenAI", homepage: "https://github.com/scpuny/Codex-Dmg-Trasnform", icon: "./resources/electron.png" } },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: { options: { name: "codex", productName: "Codex", genericName: "AI Coding Assistant", categories: ["Development", "Utility"], bin: "Codex", license: "Apache-2.0", homepage: "https://github.com/scpuny/Codex-Dmg-Trasnform", icon: "./resources/electron.png" } },
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

      // For macOS: use mac-x64 platform dir
      // For Linux: use the source dir corresponding to the arch
      let platformKey;
      if (platform === "darwin") {
        platformKey = "mac-x64";
      } else if (platform === "linux") {
        platformKey = arch === "arm64" ? "mac-arm64" : "mac-x64";
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

      const copyDir = (s, d) => {
        fs.mkdirSync(d, { recursive: true });
        for (const e of fs.readdirSync(s, { withFileTypes: true })) {
          const sp = path.join(s, e.name), dp = path.join(d, e.name);
          if (e.isDirectory()) copyDir(sp, dp);
          else if (!e.isSymbolicLink()) { fs.copyFileSync(sp, dp); copied++; }
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
          fs.copyFileSync(srcPath, destPath);
          try { fs.chmodSync(destPath, 0o755); } catch {}
          copied++;
        }
      }

      console.log(`   [ok] ${copied} files (app.asar + unpacked + resources)`);
    },
  },
};
