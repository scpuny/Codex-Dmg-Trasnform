#!/usr/bin/env node
/**
 * patch-linux-window.js — Fix transparent window background on Linux
 *
 * The official Codex.app on macOS uses a custom Codex Framework with vibrancy
 * effects and transparent window backgrounds. On Linux with standard Electron,
 * this results in a fully transparent window background (#00000000) causing
 * a black/empty window.
 *
 * Two fixes:
 *   1. opaque window surface platform check — add Linux to the darwin|win32 list
 *      (was darwin|win32 only, so Linux always got transparent bg)
 *   2. transparent bg variable — change from #00000000 to #f9f9f9
 *      (backup fix for when opaqueWindowSurfaceEnabled=false)
 *
 * Note: minified variable/function names change between upstream builds.
 *       The regex-based approach handles this automatically.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^main-[a-zA-Z0-9_-]+\.js$/;

// Upstream minified names change between builds — these refs are the
// opaque-window-surface variable and function that need Linux added.
// If the exact names don't match, the fallback logic handles it.
const TRANS_VAR_PATTERN = /^[A-Z][0-9]=`#00000000`$/;  // was B8, now Q7, will change again
const OPAQUE_FN_PATTERN = /^[A-Z][0-9]$/;               // was m5, now E9, will change again

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");

  if (content.includes("patch-linux-window")) {
    console.log(`   [--] ${relPath(filePath)}: already patched`);
    return false;
  }

  let modified = false;

  // ── Fix 1: transparent bg variable → opaque ──
  // Matches any single-letter+digit variable assigned #00000000
  const transRegex = /([A-Z][0-9])=`#00000000`/;
  const transMatch = content.match(transRegex);
  if (transMatch) {
    const varName = transMatch[1];
    content = content.replace(transMatch[0], `${varName}=\`#f9f9f9\``);
    modified = true;
    console.log(`   [trans] ${relPath(filePath)}: ${varName}=#00000000 -> #f9f9f9`);
  } else {
    console.log(`   [!] ${relPath(filePath)}: transparent bg variable not found`);
  }

  // ── Fix 2: opaque window surface platform check ──
  // Use regex fallback directly (works regardless of function name)
  const platformRegex = /(n===`darwin`\|\|n===`win32`)/;
  const platformMatch = content.match(platformRegex);
  if (platformMatch) {
    // Only patch if not already done
    if (!platformMatch[0].includes("linux")) {
      content = content.replace(platformRegex, "n===`darwin`||n===`win32`||n===`linux`");
      modified = true;
      console.log(`   [oplat] ${relPath(filePath)}: added Linux to opaque window check`);
    } else {
      console.log(`   [--] ${relPath(filePath)}: platform check already includes Linux`);
    }
  } else {
    console.log(`   [!] ${relPath(filePath)}: darwin||win32 platform check not found`);
  }

  if (!modified) {
    console.log(`   [!!] ${relPath(filePath)}: nothing to patch`);
    return false;
  }

  const patchMarker = "\n/* patch-linux-window: opaque window bg for Linux */";
  fs.writeFileSync(filePath, content + patchMarker, "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: patched`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const rawPlatform = args.find((a) => ["mac-arm64", "mac-x64", "win", "unix"].includes(a));

  // macOS 不需要此修补，跳过
  if (rawPlatform === "mac-arm64" || rawPlatform === "mac-x64") {
    console.log("  [skip] linux-window patch: not applicable to macOS");
    return;
  }

  // 'unix' 使用 mac-x64 目录中的 ASAR 内容
  const targetPlatform = rawPlatform === "unix" ? "mac-x64" : rawPlatform;
  const platforms = targetPlatform ? [targetPlatform] : ["mac-arm64", "mac-x64", "win"];

  console.log("\n== patch-linux-window ==");

  let patchedCount = 0;

  for (const plat of platforms) {
    const buildDir = path.join(SRC_DIR, plat, "_asar", ".vite", "build");
    if (!fs.existsSync(buildDir)) {
      console.log(`   [--] ${plat}: no .vite/build directory`);
      continue;
    }

    const files = fs.readdirSync(buildDir).filter((f) => TARGET_PATTERN.test(f));
    if (files.length === 0) {
      console.log(`   [--] ${plat}: no main-*.js found`);
      continue;
    }

    for (const file of files) {
      const patched = patchFile(path.join(buildDir, file));
      if (patched) patchedCount++;
    }
  }

  if (patchedCount === 0) {
    console.log("  [skip] no files patched (not an error on this platform)");
    return;
  }

  console.log(`   [ok] ${patchedCount} file(s) patched`);
}

main();
