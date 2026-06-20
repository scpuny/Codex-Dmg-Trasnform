#!/usr/bin/env node
/**
 * sync-upstream.js — Extract full upstream Codex resources
 *
 * Downloads from appcast XML (arm64 + x64), extracts app.asar content to _asar/,
 * and copies all resources to src/{platform}/ directories.
 *
 * Output structure per platform:
 *   src/{platform}/
 *     _asar/              Extracted app.asar content (patch target)
 *     app.asar.unpacked/  Native modules (kept as-is from upstream)
 *     codex               CLI binary
 *     plugins/            Bundled plugins
 *     native/             Platform native modules
 *     ...                 All other upstream resources
 *
 * Usage:
 *   node scripts/sync-upstream.js [--force] [--skip-arm64]
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const TEMP_DIR = path.join(require("os").tmpdir(), "codex-sync");
const VERSION_FILE = path.join(PROJECT_ROOT, "scripts", ".versions.json");

const APPCAST_ARM64 = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";
const APPCAST_X64 = "https://persistent.oaistatic.com/codex-app-prod/appcast-x64.xml";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const CHECK_ONLY = args.includes("--check-only");
const SKIP_ARM64 = args.includes("--skip-arm64");

// ─── Helpers ────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return httpGet(res.headers.location).then(resolve, reject);
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

function curlDownload(url, dest, label) {
  console.log(`  [dl] ${label}`);
  execSync(`curl -L --retry 3 --retry-delay 2 -o "${dest}" "${url}"`, { stdio: "inherit" });
}

function extractArchive(archive, dest) {
  if (process.platform === "darwin" && archive.endsWith(".zip")) {
    // ditto preserves macOS symlinks + resource forks (required for .app)
    execSync(`ditto -xk "${archive}" "${dest}"`);
  } else {
    // 7zz for Linux (symlinks don't matter — only ASAR content used)
    for (const bin of ["7zz", "7z"]) {
      try {
        execSync(`${bin} x -y -o"${dest}" "${archive}"`, { stdio: "pipe" });
        return;
      } catch {
        if (fs.readdirSync(dest).length > 0) return;
      }
    }
    throw new Error(`Failed to extract ${archive}`);
  }
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) { const r = findFile(full, name); if (r) return r; }
  }
  return null;
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) { count += copyRecursive(s, d); }
    else if (e.isSymbolicLink()) { /* skip */ }
    else { fs.copyFileSync(s, d); count++; }
  }
  return count;
}

function clearDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

// ─── Version detection ──────────────────────────────────────────

async function getAppcastVersion(url) {
  const { XMLParser } = require("fast-xml-parser");
  const res = await httpGet(url);
  if (res.status !== 200) throw new Error(`Appcast fetch failed: ${res.status}`);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });
  const parsed = parser.parse(res.body.toString());
  const items = parsed.rss?.channel?.item;
  const latest = Array.isArray(items) ? items[0] : items;
  let enc = latest.enclosure;
  if (Array.isArray(enc)) enc = enc[0];
  const urlMatch = latest["@_sparkle:version"] || enc?.["@_sparkle:version"] || "";
  const buildMatch = latest["@_sparkle:shortVersionString"] || enc?.["@_sparkle:shortVersionString"] || "";
  const version = urlMatch.split("/").pop()?.replace(/^v/, "") || urlMatch;
  const build = buildMatch;
  const info = { version, build, url: enc?.["@_url"] || enc?.["@_url"] };
  return info;
}

// ─── macOS sync ──────────────────────────────────────────────

async function syncMac(variant, appcastUrl, destDir) {
  const info = await getAppcastVersion(appcastUrl);
  console.log(`  [mac-${variant}] version: ${info.version} (build ${info.build})`);

  const zipName = `Codex-darwin-${variant}-${info.version}.zip`;
  const zipPath = path.join(TEMP_DIR, zipName);
  const extractDir = path.join(TEMP_DIR, `${variant}-extract`);

  // Download ZIP if not cached
  if (!fs.existsSync(zipPath) || FORCE) {
    curlDownload(info.url, zipPath, `Codex-darwin-${variant}.zip`);
  } else {
    console.log(`   [cache] ${zipName}`);
  }

  // Extract
  console.log("   [extract]");
  clearDir(extractDir);
  extractArchive(zipPath, extractDir);

  // Find Codex.app
  let appPath = null;
  const findApp = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "Codex.app" && e.isDirectory()) return path.join(dir, e.name);
      if (e.isDirectory()) { const r = findApp(path.join(dir, e.name)); if (r) return r; }
    }
    return null;
  };
  appPath = findApp(extractDir);

  if (!appPath) throw new Error(`Codex.app not found in ${extractDir}`);

  const resourcesDir = path.join(appPath, "Contents", "Resources");
  if (!fs.existsSync(resourcesDir)) throw new Error("Resources dir not found in extracted app");

  assembleOutput(resourcesDir, destDir, `mac-${variant}`);
  return info;
}

// ─── Assemble output ────────────────────────────────────────────

function assembleOutput(resourcesDir, destDir, label) {
  const asarPath = path.join(resourcesDir, "app.asar");
  if (!fs.existsSync(asarPath)) throw new Error(`${label}: app.asar not found`);

  console.log(`   [assemble] -> ${path.relative(PROJECT_ROOT, destDir)}/`);
  clearDir(destDir);

  // 1. Extract app.asar → _asar/ (for patching)
  const asarDest = path.join(destDir, "_asar");
  console.log("   [asar extract] -> _asar/");
  execSync(`npx asar extract "${asarPath}" "${asarDest}"`);

  // 2. Copy app.asar.unpacked/ as-is (native modules)
  const unpackedSrc = path.join(resourcesDir, "app.asar.unpacked");
  if (fs.existsSync(unpackedSrc)) {
    const n = copyRecursive(unpackedSrc, path.join(destDir, "app.asar.unpacked"));
    console.log(`   [copy] app.asar.unpacked/ (${n} files)`);
  }

  // 3. Copy all other resources (binaries, plugins, native, etc.)
  let extraCount = 0;
  for (const e of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
    if (e.name === "app.asar" || e.name === "app.asar.unpacked") continue;
    if (e.name.endsWith(".lproj")) continue;
    const s = path.join(resourcesDir, e.name);
    const d = path.join(destDir, e.name);
    if (e.isDirectory()) { extraCount += copyRecursive(s, d); }
    else if (!e.isSymbolicLink()) { fs.copyFileSync(s, d); extraCount++; }
  }
  console.log(`   [copy] ${extraCount} extra resource files`);

  const total = countFiles(destDir);
  console.log(`   [ok] ${total} files total`);
}

// ─── Version state ──────────────────────────────────────────────

function loadVersions() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, "utf-8")); } catch { return {}; }
}
function saveVersions(v) {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(v, null, 2) + "\n");
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("== Codex upstream sync ==\n");
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const results = {};

  // Detect versions
  if (!SKIP_ARM64) {
    try {
      const arm64Info = await getAppcastVersion(APPCAST_ARM64);
      console.log(`\n   mac-arm64: ${arm64Info.version} (build ${arm64Info.build})`);
      results["mac-arm64"] = arm64Info;
    } catch (e) { console.error(`   [x] mac-arm64 check: ${e.message}`); }
  }

  try {
    const x64Info = await getAppcastVersion(APPCAST_X64);
    console.log(`   mac-x64:   ${x64Info.version} (build ${x64Info.build})`);
    results["mac-x64"] = x64Info;
  } catch (e) { console.error(`   [x] mac-x64 check: ${e.message}`); }

  if (CHECK_ONLY) {
    console.log("\n== Check only, skipping download ==");
    return;
  }

  // Download and extract
  if (!SKIP_ARM64 && results["mac-arm64"]) {
    try {
      results["mac-arm64"] = await syncMac("arm64", APPCAST_ARM64, path.join(SRC_DIR, "mac-arm64"));
    } catch (e) { console.error(`   [x] mac-arm64: ${e.message}`); }
  }
  if (results["mac-x64"]) {
    try {
      results["mac-x64"] = await syncMac("x64", APPCAST_X64, path.join(SRC_DIR, "mac-x64"));
    } catch (e) { console.error(`   [x] mac-x64: ${e.message}`); }
  }

  const saved = loadVersions();
  for (const [key, info] of Object.entries(results)) {
    saved[key] = { version: info.version, build: info.build || "", checkedAt: new Date().toISOString() };
  }
  saveVersions(saved);

  console.log("\n== Done ==");
  for (const [key, info] of Object.entries(results)) {
    console.log(`   ${key}: ${info.version}`);
  }
}

main().catch((e) => { console.error(`\n[x] ${e.message}`); process.exit(1); });
