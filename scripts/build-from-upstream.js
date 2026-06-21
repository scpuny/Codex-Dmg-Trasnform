#!/usr/bin/env node
/**
 * build-from-upstream.js — Patch upstream Codex and repackage
 *
 * Takes the upstream app from cache, patches ASAR, re-signs,
 * creates DMG + ZIP.  All complexity removed — matching the
 * reference project's simple approach.
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

// ─── ASAR integrity ─────────────────────────────────────────────

function computeAsarHeaderHash(asarPath) {
  const crypto = require("crypto");
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  return crypto.createHash("sha256").update(buf.slice(16, 16 + headerSize)).digest("hex");
}

function updateAsarIntegrity(asarPath, infoPlistPath) {
  const hash = computeAsarHeaderHash(asarPath);
  try {
    execSync(
      `plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.hash -string "${hash}" "${infoPlistPath}"`,
      { stdio: "pipe" }
    );
    execSync(
      `plutil -replace ElectronAsarIntegrity.Resources/app\\\\.asar.algorithm -string SHA256 "${infoPlistPath}"`,
      { stdio: "pipe" }
    );
    console.log(`   [integrity] hash updated: ${hash.slice(0, 16)}...`);
  } catch (e) {
    console.log(`   [!] integrity update failed: ${e.message.trim().split("\n")[0]}`);
  }
}

// ─── macOS build ────────────────────────────────────────────────

function buildMac() {
  const platformDir = path.join(SRC_DIR, "mac-x64");
  const asarDir = path.join(platformDir, "_asar");
  if (!fs.existsSync(asarDir)) {
    console.error("[x] mac-x64/_asar/ not found. Run sync-upstream first.");
    process.exit(1);
  }

  // 1. Find .app in temp cache
  const extractDir = path.join(require("os").tmpdir(), "codex-sync", "x64-extract");
  const findApp = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "Codex.app" && e.isDirectory()) return path.join(d, e.name);
      if (e.isDirectory()) { const r = findApp(path.join(d, e.name)); if (r) return r; }
    }
    return null;
  };
  const appPath = findApp(extractDir);
  if (!appPath) {
    console.error("[x] Codex.app not found in cache. Run sync-upstream first.");
    process.exit(1);
  }
  console.log(`   [source] ${appPath}`);

  // 2. ditto copy (preserves symlinks + resource forks + _CodeSignature/PkgInfo etc.)
  const outAppDir = path.join(OUT_DIR, "mac-x64");
  clearDir(outAppDir);
  const outApp = path.join(outAppDir, "Codex.app");
  console.log("   [copy] Codex.app -> out/");
  execSync(`ditto "${appPath}" "${outApp}"`);

  const resourcesDir = path.join(outApp, "Contents", "Resources");
  const infoPlist = path.join(outApp, "Contents", "Info.plist");

  // 3. Repack patched ASAR
  console.log("   [asar pack] _asar/ -> app.asar");
  execSync(`npx asar pack "${asarDir}" "${path.join(resourcesDir, "app.asar")}"`);

  // 4. Update ASAR integrity hash
  if (fs.existsSync(infoPlist)) {
    updateAsarIntegrity(path.join(resourcesDir, "app.asar"), infoPlist);
  }

  // 5. Strip original signature + quarantine
  const doMaybe = (cmd) => { try { execSync(cmd, { stdio: "pipe" }); } catch {} };
  doMaybe(`codesign --remove-signature "${outApp}"`);
  doMaybe(`xattr -rd com.apple.quarantine "${outApp}"`);

  // 6. Ad-hoc sign (simple --deep, like reference project)
  console.log("   [codesign] ad-hoc signing");
  try {
    execSync(`codesign --sign - --force --deep "${outApp}"`, { stdio: "pipe" });
    console.log("   [codesign] OK");
  } catch (e) {
    console.log(`   [!] codesign --deep failed: ${e.message.trim().split("\n")[0]}`);
    console.log("   [codesign] trying component-level fallback...");
    // Fallback: sign helpers → frameworks → plugins → main
    // macOS 14+ sometimes chokes on --deep with nested frameworks
    try {
      execSync(`find "${outApp}" -path "*/Codex.app" -prune -o -name "*.app" -depth -print | ` +
        `while IFS= read -r h; do codesign --sign - --force "$h"; done 2>/dev/null`, { stdio: "pipe" });
    } catch {}
    for (const dir of ["Frameworks", "PlugIns"]) {
      const d = path.join(outApp, "Contents", dir);
      if (fs.existsSync(d)) {
        for (const item of fs.readdirSync(d)) {
          doMaybe(`codesign --sign - --force "${path.join(d, item)}"`);
        }
      }
    }
    doMaybe(`codesign --sign - --force "${outApp}"`);
  }

  // Verify
  try {
    const v = execSync(`codesign -dvvv "${outApp}" 2>&1`, { encoding: "utf-8" });
    const lines = v.split("\n").filter(l => /^(Authority|Signed Time|Sealed Resources|Format|Identifier)/i.test(l));
    for (const l of lines) console.log(`   ${l.trim()}`);
  } catch {}

  // 7. Create DMG
  const version = getVersion(asarDir);
  const dmgPath = path.join(OUT_DIR, `Codex-${version}-macos-x64.dmg`);
  console.log("   [dmg] creating...");
  doMaybe(`hdiutil detach -quiet "/Volumes/Codex"`);
  for (let i = 1; i <= 3; i++) {
    try {
      execSync(`hdiutil create -volname Codex -srcfolder "${outAppDir}" -ov -format UDZO "${dmgPath}"`,
        { stdio: "pipe" });
      break;
    } catch (e) {
      console.log(`   [!] dmg attempt ${i}/3 failed, retrying...`);
      if (i < 3) {
        doMaybe(`hdiutil detach -quiet "/Volumes/Codex"`);
        execSync(`sleep ${i * 2}`, { stdio: "pipe" });
      } else {
        console.error(`   [x] DMG failed: ${e.message.trim().split("\n")[0]}`);
        // Non-fatal — ZIP still available
      }
    }
  }
  if (fs.existsSync(dmgPath)) {
    console.log(`   [ok] DMG: ${(fs.statSync(dmgPath).size / 1048576).toFixed(1)} MB`);
  }

  // 8. Create ZIP
  const zipPath = path.join(OUT_DIR, `Codex-${version}-macos-x64.zip`);
  console.log("   [zip] creating...");
  execSync(`cd "${outAppDir}" && zip -r -9 --symlinks -X "${zipPath}" "Codex.app"`, { stdio: "pipe" });
  console.log(`   [ok] ZIP: ${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB`);
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
  if (platform.startsWith("mac")) buildMac();
}

main();
