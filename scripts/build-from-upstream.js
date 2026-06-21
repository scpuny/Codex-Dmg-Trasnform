#!/usr/bin/env node
/**
 * build-from-upstream.js — Patch upstream Codex and repackage
 *
 * For macOS: takes the upstream app from src/mac-x64/, patches _asar/,
 * repacks app.asar, updates integrity hash, re-signs, creates DMG + ZIP.
 *
 * This does NOT replace the Electron framework. It keeps the original
 * Codex Framework.framework from the downloaded x64 ZIP.
 *
 * Usage:
 *   node scripts/build-from-upstream.js --platform mac-x64
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const OUT_DIR = path.join(PROJECT_ROOT, "out");

// ─── Helpers ────────────────────────────────────────────────────

function clearDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
}

function getVersion(asarDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(asarDir, "package.json"), "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

/** 返回 framework 的所有版本子目录 (Versions/* 中不是 symlink 的目录) */
function getFrameworkVersions(fwPath) {
  const vDir = path.join(fwPath, "Versions");
  if (!fs.existsSync(vDir)) return [];
  return fs.readdirSync(vDir)
    .filter((v) => {
      const vp = path.join(vDir, v);
      try { return fs.statSync(vp).isDirectory() && !fs.lstatSync(vp).isSymbolicLink(); }
      catch { return false; }
    })
    .sort();
}

// ─── ASAR integrity ─────────────────────────────────────────────

function computeAsarHeaderHash(asarPath) {
  const crypto = require("crypto");
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  const header = buf.slice(16, 16 + headerSize);
  return crypto.createHash("sha256").update(header).digest("hex");
}

function updateAsarIntegrity(asarPath, infoPlistPath) {
  const newHash = computeAsarHeaderHash(asarPath);
  try {
    execSync(
      `plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.hash -string "${newHash}" "${infoPlistPath}"`,
      { stdio: "pipe" }
    );
    execSync(
      `plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.algorithm -string "SHA256" "${infoPlistPath}"`,
      { stdio: "pipe" }
    );
  } catch {
    execSync(
      `python3 -c "
import plistlib
with open('${infoPlistPath}', 'rb') as f:
    d = plistlib.load(f)
ei = d.get('ElectronAsarIntegrity', {})
ei['Resources/app.asar'] = {'hash': '${newHash}', 'algorithm': 'SHA256'}
d['ElectronAsarIntegrity'] = ei
with open('${infoPlistPath}', 'wb') as f:
    plistlib.dump(d, f)
"`,
      { stdio: "pipe" }
    );
  }

  let verify = "";
  try {
    verify = execSync(
      `plutil -extract ElectronAsarIntegrity.Resources/app\\\\.asar.hash raw "${infoPlistPath}"`,
      { encoding: "utf-8" }
    ).trim();
  } catch {
    verify = newHash;
  }
  if (verify === newHash) {
    console.log(`   [integrity] hash updated: ${newHash.slice(0, 16)}...`);
  } else {
    console.log(`   [!] integrity verify failed`);
  }
}

// ─── Size optimization ──────────────────────────────────────────

function extractX86_64(appPath) {
  const candidates = [path.join(appPath, "Contents", "MacOS", "Codex")];

  const cff = path.join(appPath, "Contents", "Frameworks", "Codex Framework.framework");
  if (fs.existsSync(cff)) {
    for (const ver of getFrameworkVersions(cff)) {
      const fp = path.join(cff, "Versions", ver, "Codex Framework");
      if (fs.existsSync(fp)) candidates.push(fp);
    }
  }

  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    try {
      const archs = execSync(`lipo -archs "${bin}"`, { encoding: "utf-8" }).trim();
      if (archs.includes("arm64")) {
        console.log(`   [lipo] ${path.relative(appPath, bin)}: ${archs} -> x86_64 only`);
        execSync(`lipo "${bin}" -extract x86_64 -output "${bin}.thin"`, { stdio: "pipe" });
        fs.renameSync(`${bin}.thin`, bin);
        fs.chmodSync(bin, 0o755);
      }
    } catch {}
  }
}

function stripDebug(appPath) {
  const candidates = [path.join(appPath, "Contents", "MacOS", "Codex")];
  const cff = path.join(appPath, "Contents", "Frameworks", "Codex Framework.framework");
  if (fs.existsSync(cff)) {
    for (const ver of getFrameworkVersions(cff)) {
      const fp = path.join(cff, "Versions", ver, "Codex Framework");
      if (fs.existsSync(fp)) candidates.push(fp);
    }
  }
  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    try { execSync(`strip -x "${bin}"`, { stdio: "pipe" }); } catch {}
  }
  console.log("   [strip] debug symbols removed");
}

function cleanupRedundant(appPath) {
  const cmds = [
    `find "${appPath}" -name ".DS_Store" -delete 2>/dev/null`,
    `find "${appPath}" -name "*.map" -delete 2>/dev/null`,
    `find "${appPath}" -iname "readme*" -delete 2>/dev/null`,
    `find "${appPath}" -iname "license*" -delete 2>/dev/null`,
  ];
  for (const cmd of cmds) try { execSync(cmd, { stdio: "pipe" }); } catch {}
  console.log("   [cleanup] redundant files removed");
}

function uniformTimestamps(appPath) {
  try {
    execSync(`find "${appPath}" -exec touch -t 202601010000 {} \\; 2>/dev/null`, { stdio: "pipe" });
    console.log("   [timestamp] uniform mtime set to 2026-01-01");
  } catch {}
}

// ─── Code signing — 组件级自底向上签名 ──────────────────────────

function signComponents(appPath) {
  const fwDir = path.join(appPath, "Contents", "Frameworks");
  const pluginDir = path.join(appPath, "Contents", "PlugIns");
  const signed = [];
  const errors = [];

  function doSign(target, label) {
    try {
      execSync(`codesign --sign - --force --no-strict "${target}" 2>&1`, { stdio: "pipe" });
      signed.push(label);
      return true;
    } catch (e) {
      const msg = e.message.replace(/\n/g, "; ").slice(0, 120);
      errors.push(`${label}: ${msg}`);
      return false;
    }
  }

  // ── Step 0: 物理清除旧签名缓存 ──
  // 避免 --remove-signature 碰到 framework 时报 "bundle format is ambiguous"
  try {
    execSync(
      `find "${appPath}" -depth -type d -name '_CodeSignature' -exec rm -rf {} + 2>/dev/null`,
      { stdio: "pipe" }
    );
    execSync(
      `find "${appPath}" -type f -name 'CodeResources' -delete 2>/dev/null`,
      { stdio: "pipe" }
    );
    execSync(
      `find "${appPath}" -type f -name '.codesign*' -delete 2>/dev/null`,
      { stdio: "pipe" }
    );
  } catch {}
  console.log("   [clean] old _CodeSignature cache purged");

  // ── Helper: 签名指定 framework 的所有版本子组件 ──
  function signFrameworkInner(fwPath, fwName) {
    for (const ver of getFrameworkVersions(fwPath)) {
      const verDir = path.join(fwPath, "Versions", ver);

      // dylib
      const libsDir = path.join(verDir, "Libraries");
      if (fs.existsSync(libsDir)) {
        for (const lib of fs.readdirSync(libsDir)) {
          if (lib.endsWith(".dylib")) {
            doSign(path.join(libsDir, lib), `lib:${fwName}/${ver}/${lib}`);
          }
        }
      }

      // XPCServices
      const xpcDir = path.join(verDir, "XPCServices");
      if (fs.existsSync(xpcDir)) {
        for (const xpc of fs.readdirSync(xpcDir)) {
          if (xpc.endsWith(".xpc")) {
            doSign(path.join(xpcDir, xpc), `xpc:${fwName}/${ver}/${xpc}`);
          }
        }
      }

      // 主可执行文件
      const fwExec = path.join(verDir, fwName);
      if (fs.existsSync(fwExec)) {
        doSign(fwExec, `fw-exe:${fwName}/${ver}`);
      }
    }
  }

  // ── Step 1: 框架内子组件 (dylib → xpc → 可执行文件) ──
  if (fs.existsSync(fwDir)) {
    for (const fw of fs.readdirSync(fwDir)) {
      if (!fw.endsWith(".framework")) continue;
      signFrameworkInner(path.join(fwDir, fw), fw.replace(/\.framework$/, ""));
    }
  }

  // ── Step 2: 框架包本身 (+ --no-strict 解决 ambiguous bundle) ──
  if (fs.existsSync(fwDir)) {
    for (const fw of fs.readdirSync(fwDir)) {
      if (!fw.endsWith(".framework")) continue;
      doSign(path.join(fwDir, fw), `fw:${fw}`);
    }
  }

  // ── Step 3: Helper .app (Electron 标准布局 — 在 Frameworks/ 下) ──
  if (fs.existsSync(fwDir)) {
    for (const entry of fs.readdirSync(fwDir)) {
      if (entry.endsWith(".app")) {
        doSign(path.join(fwDir, entry), `helper:${entry}`);
      }
    }
  }

  // ── Step 4: PlugIns ──
  if (fs.existsSync(pluginDir)) {
    for (const p of fs.readdirSync(pluginDir)) {
      const pp = path.join(pluginDir, p);
      if (fs.statSync(pp).isDirectory()) {
        doSign(pp, `plugin:${p}`);
      }
    }
  }

  // ── Step 5: 主包 ──
  doSign(appPath, `app:${path.basename(appPath)}`);

  // ── 报告 ──
  console.log(`   [codesign] ${signed.length} items signed`);
  if (errors.length > 0) {
    console.log(`   [!] ${errors.length} signing errors (non-fatal):`);
    for (const e of errors.slice(0, 5)) {
      console.log(`       ${e}`);
    }
    if (errors.length > 5) console.log(`       ... and ${errors.length - 5} more`);
  }

  // ── 最终校验 ──
  try {
    const v = execSync(`codesign -dvvv "${appPath}" 2>&1`, { encoding: "utf-8" });
    const info = v
      .split("\n")
      .filter((l) => /^(Authority|Signed Time|Sealed Resources|Format|Identifier)/i.test(l))
      .map((l) => l.trim());
    if (info.length > 0) {
      for (const line of info) console.log(`   ${line}`);
    } else {
      const fmt = (v.match(/^Format=(.+)/m) || [])[1] || "ad-hoc";
      console.log(`   [verify] signed (${fmt})`);
    }
  } catch (e) {
    console.log(`   [!] verify: ${e.message.trim().split("\n")[0]}`);
  }
}

// ─── macOS build ────────────────────────────────────────────────

function buildMac(platform) {
  const platformDir = path.join(SRC_DIR, platform);
  const asarDir = path.join(platformDir, "_asar");

  if (!fs.existsSync(asarDir)) {
    console.error(`[x] ${platform}/_asar/ not found. Run sync-upstream first.`);
    process.exit(1);
  }

  // 1. Find the .app in the ZIP extract cache
  const tempDir = path.join(require("os").tmpdir(), "codex-sync");
  const extractDir = path.join(tempDir, "x64-extract");

  let appPath = null;
  if (fs.existsSync(extractDir)) {
    const findApp = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "Codex.app" && e.isDirectory()) return path.join(dir, e.name);
        if (e.isDirectory()) {
          const r = findApp(path.join(dir, e.name));
          if (r) return r;
        }
      }
      return null;
    };
    appPath = findApp(extractDir);
  }

  if (!appPath) {
    console.error(`[x] Codex.app not found in cache. Run sync-upstream first.`);
    process.exit(1);
  }

  console.log(`   [source] ${appPath}`);

  // 2. Copy .app to output (ditto preserves symlinks + resource forks)
  const outAppDir = path.join(OUT_DIR, platform);
  clearDir(outAppDir);
  const outApp = path.join(outAppDir, "Codex.app");
  console.log("   [copy] Codex.app -> out/");
  execSync(`ditto "${appPath}" "${outApp}"`);

  const resourcesDir = path.join(outApp, "Contents", "Resources");

  // 3. Repack patched ASAR
  const asarPath = path.join(resourcesDir, "app.asar");
  console.log("   [asar pack] _asar/ -> app.asar");
  execSync(`npx asar pack "${asarDir}" "${asarPath}"`);

  // 4. Update ASAR integrity hash in Info.plist
  const infoPlist = path.join(outApp, "Contents", "Info.plist");
  if (fs.existsSync(infoPlist)) {
    updateAsarIntegrity(asarPath, infoPlist);
  }

  // 5. Size optimization
  console.log("   [optimize] extracting x86_64 slice...");
  extractX86_64(outApp);
  stripDebug(outApp);
  cleanupRedundant(outApp);
  uniformTimestamps(outApp);

  // 6. Remove quarantine (旧签名缓存由 signComponents Step 0 物理清除)
  try { execSync(`xattr -rd com.apple.quarantine "${outApp}" 2>/dev/null`, { stdio: "pipe" }); } catch {}

  // 7. Replace codex CLI (optional)
  const vendorCodex = resolveCodexVendor(platform);
  if (vendorCodex) {
    const dest = path.join(resourcesDir, "codex");
    fs.copyFileSync(vendorCodex, dest);
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`   [codex] replaced with @cometix/codex`);
  } else {
    console.log(`   [!] @cometix/codex not found, keeping upstream codex`);
  }

  // 8. Component-level ad-hoc signing (自底向上, 无需 --deep)
  console.log("   [codesign] signing (bottom-up)...");
  signComponents(outApp);

  // 9. Create DMG (UDZO = bzip2 压缩)
  const version = getVersion(asarDir);
  const dmgName = `Codex-${version}-macos-x64.dmg`;
  const dmgPath = path.join(OUT_DIR, dmgName);
  console.log(`   [dmg] ${dmgName}`);
  execSync(
    `hdiutil create -volname Codex -srcfolder "${outAppDir}" -ov -format UDZO "${dmgPath}"`,
    { stdio: "pipe" }
  );
  const dmgSizeMB = (fs.statSync(dmgPath).size / 1048576).toFixed(1);
  console.log(`   [ok] ${dmgPath} (${dmgSizeMB} MB)`);

  // 10. Create ZIP (最大压缩, 保留符号链接)
  const zipName = `Codex-${version}-macos-x64.zip`;
  const zipPath = path.join(OUT_DIR, zipName);
  console.log(`   [zip] ${zipName}`);
  execSync(
    `cd "${outAppDir}" && zip -r -9 --symlinks -X "${zipPath}" "Codex.app"`,
    { stdio: "pipe" }
  );
  const zipSizeMB = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  console.log(`   [ok] ${zipPath} (${zipSizeMB} MB)`);
}

// ─── Codex CLI vendor resolution ────────────────────────────────

const TARGET_TRIPLE_MAP = { "mac-x64": "x86_64-apple-darwin" };

function resolveCodexVendor(platform) {
  const triple = TARGET_TRIPLE_MAP[platform];
  if (!triple) return null;
  const binName = "codex";
  const PKG_MAP = { "mac-x64": "codex-darwin-x64" };
  const platPkg = PKG_MAP[platform];
  if (platPkg) {
    const p = path.join(
      PROJECT_ROOT, "node_modules", "@cometix", platPkg, "vendor", triple, "codex", binName
    );
    if (fs.existsSync(p)) return p;
  }
  const localPath = path.join(
    PROJECT_ROOT, "node_modules", "@cometix", "codex", "vendor", triple, "codex", binName
  );
  if (fs.existsSync(localPath)) return localPath;
  return null;
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const platIdx = args.indexOf("--platform");
  const platform = platIdx !== -1 ? args[platIdx + 1] : null;

  if (!platform || !["mac-x64"].includes(platform)) {
    console.error("[x] Usage: build-from-upstream.js --platform <mac-x64>");
    process.exit(1);
  }

  console.log(`\n== Build from upstream: ${platform} ==\n`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (platform.startsWith("mac")) {
    buildMac(platform);
  }
}

main();
