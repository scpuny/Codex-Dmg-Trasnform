#!/usr/bin/env node
/**
 * prepare-src.js — Pre-build: Repack patched ASAR, assemble src/ for forge build
 *
 * For macOS: repacks _asar/ → app.asar in src/{platform}/, replaces codex CLI.
 * For Linux: repacks, strips macOS-only resources, copies to flat src/ for forge.
 *
 * The forge build flow for Linux is:
 *   1. prepare-src.js → repacks _asar/ → app.asar, copies content to flat src/
 *   2. electron-rebuild → rebuilds native modules in node_modules/
 *   3. sync-native-modules.js → copies rebuilt modules to src/node_modules/
 *   4. electron-forge make → packages into .deb/.rpm/.zip
 *
 * Usage:
 *   node scripts/prepare-src.js --platform mac-x64
 *   node scripts/prepare-src.js --platform linux-x64
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SRC = path.join(__dirname, "..", "src");
const PROJECT_ROOT = path.join(__dirname, "..");

const TARGET_TRIPLE_MAP = {
  "mac-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};

// macOS-only resources to strip for Linux
const MACOS_STRIP = new Set([
  "codex_chronicle", "node", "node_repl",
  "electron.icns", "Assets.car",
  "codexTemplate.png", "codexTemplate@2x.png",
]);
const MACOS_STRIP_DIRS = new Set(["native"]);

function copyRecursive(src, dest, skipFiles, skipDirs) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipDirs?.has(e.name)) continue;
    if (skipFiles?.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) { count += copyRecursive(s, d, skipFiles, skipDirs); }
    else if (e.isSymbolicLink()) { /* skip symlinks */ }
    else { fs.copyFileSync(s, d); count++; }
  }
  return count;
}

function ensureVendorExtracted(platform) {
  const triple = TARGET_TRIPLE_MAP[platform];
  if (!triple) return null;

  // Check if already extracted locally
  const PKG_MAP = {
    "linux-x64": "codex-linux-x64", "linux-arm64": "codex-linux-arm64",
  };
  const platPkg = PKG_MAP[platform];
  if (platPkg) {
    const p = path.join(PROJECT_ROOT, "node_modules", "@cometix", platPkg, "vendor", triple);
    if (fs.existsSync(p)) return p;
  }

  // Try npm pack
  try {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "codex-vendor-"));
    const baseVer = execSync("npm view @cometix/codex version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n").pop();
    const suffix = platform === "linux-x64" ? "linux-x64" : "linux-arm64";
    const spec = `@cometix/codex@${baseVer}-${suffix}`;
    console.log(`   [vendor] fetching ${spec} via npm pack...`);
    const tgzName = execSync(`npm pack ${spec} --pack-destination "${tmpDir}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n").pop();
    const extractDir = path.join(tmpDir, "extracted");
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar xzf "${path.join(tmpDir, tgzName)}" -C "${extractDir}"`, { stdio: "pipe" });

    // The vendor path uses the triple directly under vendor/
    const vendorRoot = path.join(extractDir, "package", "vendor", triple);
    if (fs.existsSync(vendorRoot)) return vendorRoot;

    // Also try listing vendor/ subdirs to find the correct one
    const vendorDir = path.join(extractDir, "package", "vendor");
    if (fs.existsSync(vendorDir)) {
      for (const subdir of fs.readdirSync(vendorDir)) {
        const candidate = path.join(vendorDir, subdir, "codex", "codex");
        if (fs.existsSync(candidate)) {
          console.log(`   [vendor] found at vendor/${subdir}`);
          return path.join(vendorDir, subdir);
        }
      }
    }
  } catch (e) {
    console.log(`   [!] npm pack failed: ${e.message}`);
  }
  return null;
}

function resolveCodexVendor(platform) {
  const vendorRoot = ensureVendorExtracted(platform);
  if (!vendorRoot) return null;
  const binName = "codex";
  const p = path.join(vendorRoot, "codex", binName);
  return fs.existsSync(p) ? p : null;
}

function resolveRgVendor(platform) {
  const vendorRoot = ensureVendorExtracted(platform);
  if (!vendorRoot) return null;
  const binName = "rg";
  const p = path.join(vendorRoot, "path", binName);
  return fs.existsSync(p) ? p : null;
}

function main() {
  const args = process.argv.slice(2);
  const platIdx = args.indexOf("--platform");
  const platform = platIdx !== -1 ? args[platIdx + 1] : null;

  const VALID = ["mac-x64", "linux-x64", "linux-arm64"];
  if (!platform || !VALID.includes(platform)) {
    console.error(`[x] Usage: prepare-src.js --platform <${VALID.join("|")}>`);
    process.exit(1);
  }

  const isLinux = platform.startsWith("linux");
  const sourceDir = isLinux
    ? path.join(SRC, "mac-x64")
    : path.join(SRC, platform);

  if (!fs.existsSync(sourceDir)) {
    console.error(`[x] Source not found: ${path.relative(PROJECT_ROOT, sourceDir)}/`);
    process.exit(1);
  }

  const asarContentDir = path.join(sourceDir, "_asar");
  if (!fs.existsSync(asarContentDir)) {
    console.error(`[x] _asar/ not found in ${path.relative(PROJECT_ROOT, sourceDir)}/`);
    process.exit(1);
  }

  console.log(`-- prepare-src: ${platform}`);
  console.log(`   source: ${path.relative(PROJECT_ROOT, sourceDir)}/`);

  // 1. Repack _asar/ → app.asar
  const repackedAsar = path.join(sourceDir, "app.asar");
  console.log("   [repack] _asar/ -> app.asar");
  execSync(`npx asar pack "${asarContentDir}" "${repackedAsar}"`);
  const asarSize = (fs.statSync(repackedAsar).size / 1048576).toFixed(1);
  console.log(`   [ok] app.asar: ${asarSize} MB`);

  // 2. Replace codex binary with @cometix/codex (if available)
  const vendorCodex = resolveCodexVendor(platform);
  if (vendorCodex) {
    const dest = path.join(sourceDir, "codex");
    fs.copyFileSync(vendorCodex, dest);
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`   [codex] replaced with @cometix/codex`);
  } else {
    console.log(`   [!] @cometix/codex vendor not found for ${platform}, keeping upstream`);
  }

  // 2b. For Linux: replace rg with platform-native version from @cometix/codex
  if (isLinux) {
    const vendorRg = resolveRgVendor(platform);
    if (vendorRg) {
      const dest = path.join(sourceDir, "rg");
      fs.copyFileSync(vendorRg, dest);
      try { fs.chmodSync(dest, 0o755); } catch {}
      console.log(`   [rg] replaced with Linux rg from @cometix/codex`);
    } else {
      console.log(`   [!] Linux rg not found in vendor, keeping upstream`);
    }
  }

  // 3. For Linux: copy _asar/ content to flat src/ (forge packs ASAR from src/)
  //    Skip node_modules/ — upstream has macOS .node binaries.
  //    Native modules are rebuilt by electron-rebuild → sync-native-modules.js
  //    and end up in src/node_modules/. Forge's asar.unpack config unpacks
  //    .node files to app.asar.unpacked/ automatically.
  //    Do NOT copy mac-x64/app.asar.unpacked/ — it contains Mach-O .node files.
  if (isLinux) {
    // Clear flat src/ dirs
    for (const d of [".vite", "webview", "skills", "native-menu-locales", "node_modules"]) {
      const p = path.join(SRC, d);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
    }
    for (const f of fs.readdirSync(SRC)) {
      const p = path.join(SRC, f);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
    }
    // Copy everything except node_modules (macOS .node binaries)
    const skipDirs = new Set(["node_modules"]);
    const count = copyRecursive(asarContentDir, SRC, null, skipDirs);
    console.log(`   [linux] _asar/ -> src/ (${count} files, skipped node_modules/)`);
  }

  // 4. Sync version to root package.json
  const upstreamPkg = path.join(asarContentDir, "package.json");
  if (fs.existsSync(upstreamPkg)) {
    const upstream = JSON.parse(fs.readFileSync(upstreamPkg, "utf-8"));
    const rootPkgPath = path.join(PROJECT_ROOT, "package.json");
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    const oldVer = rootPkg.version;
    rootPkg.version = upstream.version || rootPkg.version;
    rootPkg.main = "src/.vite/build/bootstrap.js";
    for (const key of [
      "codexBuildNumber", "codexBuildFlavor",
      "codexSparkleFeedUrl", "codexSparklePublicKey",
    ]) {
      if (upstream[key]) rootPkg[key] = upstream[key];
    }
    fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
    console.log(`   version: ${oldVer} -> ${rootPkg.version}`);
  }

  // For macOS (upstream-asar mode): create stub for forge validation.
  // For Linux: the real bootstrap.js from _asar/ is already in src/ — keep it.
  if (!isLinux) {
    const stubDir = path.join(SRC, ".vite", "build");
    fs.mkdirSync(stubDir, { recursive: true });
    fs.writeFileSync(path.join(stubDir, "bootstrap.js"), "// stub - real code in app.asar\n");
    
    // Also copy package.json from upstream for forge validation
    const asarPkg = path.join(asarContentDir, "package.json");
    if (fs.existsSync(asarPkg)) {
      fs.copyFileSync(asarPkg, path.join(SRC, "package.json"));
    }
  }

  // Write build mode marker for forge.config.js
  const marker = path.join(SRC, ".build-mode");
  fs.writeFileSync(marker, isLinux ? "linux" : "upstream-asar");
  console.log(`   [mode] ${isLinux ? "linux (forge packs ASAR)" : "upstream-asar (pre-built)"}`);

  console.log(`   [ok] src/ ready for ${platform} build`);
}

main();
