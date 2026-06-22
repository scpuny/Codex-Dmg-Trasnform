#!/usr/bin/env node
/**
 * build-from-upstream.js — Patch upstream Codex and repackage
 *
 * Takes the upstream app from cache, patches ASAR, strips arm64,
 * signs, creates DMG (ULFO) + ZIP.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const OUT_DIR = path.join(PROJECT_ROOT, "out");

function clearDir(d) { if (fs.existsSync(d)) fs.rmSync(d, { recursive: true }); fs.mkdirSync(d, { recursive: true }); }

function getVersion(asarDir) {
  try { return JSON.parse(fs.readFileSync(path.join(asarDir, "package.json"), "utf-8")).version || "unknown"; }
  catch { return "unknown"; }
}

function updateAsarIntegrity(asarPath, infoPlistPath) {
  const crypto = require("crypto");
  const buf = fs.readFileSync(asarPath);
  const hash = crypto.createHash("sha256").update(buf.slice(16, 16 + buf.readUInt32LE(12))).digest("hex");
  try {
    execSync(`plutil -replace ElectronAsarIntegrity.Resources/app\\.asar.hash -string "${hash}" "${infoPlistPath}"`, { stdio: "pipe" });
    execSync(`plutil -replace ElectronAsarIntegrity.Resources/app\\.asar.algorithm -string SHA256 "${infoPlistPath}"`, { stdio: "pipe" });
    console.log("   [integrity] hash:", hash.slice(0, 16) + "...");
  } catch {}
}

function buildMac() {
  const asarDir = path.join(SRC_DIR, "mac-x64", "_asar");
  if (!fs.existsSync(asarDir)) { console.error("[x] _asar/ not found"); process.exit(1); }

  // 1. Find .app in temp cache
  const ed = path.join(require("os").tmpdir(), "codex-sync", "x64-extract");
  const findApp = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === "Codex.app" && e.isDirectory()) return path.join(d, e.name); if (e.isDirectory()) { const r = findApp(path.join(d, e.name)); if (r) return r; } } return null; };
  const appPath = findApp(ed);
  if (!appPath) { console.error("[x] Codex.app not found"); process.exit(1); }
  console.log("   [source]", appPath);

  const outAppDir = path.join(OUT_DIR, "mac-x64");
  clearDir(outAppDir);
  const outApp = path.join(outAppDir, "Codex.app");
  console.log("   [ditto] copying .app");
  execSync(`ditto "${appPath}" "${outApp}"`);

  // 2. Repack ASAR
  console.log("   [asar] pack");
  execSync(`npx asar pack "${asarDir}" "${path.join(outApp, "Contents", "Resources", "app.asar")}"`);

  // 3. Update integrity
  const plist = path.join(outApp, "Contents", "Info.plist");
  if (fs.existsSync(plist)) updateAsarIntegrity(path.join(outApp, "Contents", "Resources", "app.asar"), plist);

  // 4. Strip arm64 slice + debug symbols
  const bin = path.join(outApp, "Contents", "MacOS", "Codex");
  try {
    const archs = execSync(`lipo -archs "${bin}"`, { encoding: "utf-8" }).trim();
    if (archs.includes("arm64")) {
      console.log("   [lipo] remove arm64 (was:", archs + ")");
      execSync(`lipo "${bin}" -remove arm64 -output "${bin}.thin"`, { stdio: "pipe" });
      fs.renameSync(bin + ".thin", bin);
      fs.chmodSync(bin, 0o755);
    }
    try { execSync(`strip -x "${bin}" 2>/dev/null`, { stdio: "pipe" }); } catch {}
  } catch {}

  // 5. Remove signature + quarantine
  const run = (c) => { try { execSync(c, { stdio: "pipe" }); } catch {} };
  run(`codesign --remove-signature "${outApp}"`);
  run(`xattr -rd com.apple.quarantine "${outApp}"`);

  // 6. Ad-hoc sign
  console.log("   [codesign] signing");
  try {
    execSync(`codesign --sign - --force --deep "${outApp}"`, { stdio: "pipe" });
    console.log("   [codesign] OK");
  } catch (e) {
    console.log("   [!] sign failed:", e.message.trim().split("\n")[0]);
  }
  try {
    const v = execSync(`codesign -dvvv "${outApp}" 2>&1`, { encoding: "utf-8" });
    for (const l of v.split("\n").filter(x => /^(Authority|Signed Time|Sealed Resources|Format|Identifier)/i.test(x)))
      console.log("   " + l.trim());
  } catch {}
// 7. DMG (ULFO, 3 次重试防 Resource busy)
  const ver = getVersion(asarDir);
  const dmgPath = path.join(OUT_DIR, `Codex_macos-x64_${ver}.dmg`);
  console.log("   [dmg] creating ULFO...");
  run(`hdiutil detach -quiet "/Volumes/Codex"`);
  for (let i = 1; i <= 3; i++) {
    try {
      execSync(`hdiutil create -volname Codex -srcfolder "${outAppDir}" -ov -format ULFO "${dmgPath}"`, { stdio: "pipe" });
      break;
    } catch (e) {
      console.log(`   [!] dmg attempt ${i}/3: ${e.message.trim().split("\n")[0]}`);
      if (i < 3) { run(`hdiutil detach -quiet "/Volumes/Codex"`); execSync(`sleep ${i * 2}`, { stdio: "pipe" }); }
    }
  }
  if (fs.existsSync(dmgPath)) console.log("   [ok] DMG:", (fs.statSync(dmgPath).size / 1048576).toFixed(1), "MB");

  // 8. ZIP (redirect stdout to avoid ENOBUFS)
  const zipPath = path.join(OUT_DIR, `Codex_macos-x64_${ver}.zip`);
  console.log("   [zip] creating...");
  execSync(`cd "${outAppDir}" && zip -r -9 --symlinks -X "${zipPath}" "Codex.app" >/dev/null 2>&1`, { stdio: "pipe" });
  console.log("   [ok] ZIP:", (fs.statSync(zipPath).size / 1048576).toFixed(1), "MB");
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--platform");
  const p = i !== -1 ? args[i + 1] : null;
  if (!p || p !== "mac-x64") { console.error("Usage: build-from-upstream.js --platform mac-x64"); process.exit(1); }
  console.log("\n== Build from upstream:", p, "==\n");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  buildMac();
}
main();
