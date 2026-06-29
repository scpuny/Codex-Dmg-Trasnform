#!/usr/bin/env node
/**
 * patch-macos-window.js — Fix window management & input focus on macOS
 *
 * Three fixes for the built DMG on macOS:
 *   1. x5() primary window: add minimizable:!0, maximizable:!0, fullscreenable:!0
 *      so the traffic‑light buttons actually minimize/maximize the window.
 *   2. Remove `type:"panel"` from the b5() helper on macOS so secondary windows
 *      don't float above everything (fixes "always‑on‑top" feel for the app).
 *   3. Inject CSS into index.html to force `-webkit-app-region: no-drag` on all
 *      input/textarea/select elements so they can receive focus.
 *
 * Usage:
 *   node scripts/patch-macos-window.js mac-x64
 *   node scripts/patch-macos-window.js          # applies to all platforms
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^main-[a-zA-Z0-9]+\.js$/;

// ─── Fix 1 & 2: Patch the main‑process bundle ────────────────────

function patchMainBundle(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");

  if (content.includes("patch-macos-window")) {
    console.log(`   [--] ${relPath(filePath)}: already patched`);
    return false;
  }

  let modified = false;

  // ── Fix 1: primary window → add minimizable/maximizable/fullscreenable ──
  // Pattern: case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:t5(r)}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:t5(r)}:n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:n5(r)}:{titleBarStyle:`default`};

  const primaryPattern =
    'case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:t5(r)}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:t5(r)}:n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:n5(r)}:{titleBarStyle:`default`}';

  const primaryReplacement =
    'case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:t5(r),minimizable:!0,maximizable:!0,fullscreenable:!0}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:t5(r),minimizable:!0,maximizable:!0,fullscreenable:!0}:n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:n5(r),minimizable:!0,maximizable:!0,fullscreenable:!0}:{titleBarStyle:`default`,minimizable:!0,maximizable:!0,fullscreenable:!0}';

  if (content.includes(primaryPattern)) {
    content = content.replace(primaryPattern, primaryReplacement);
    modified = true;
    console.log(`   [fix1] ${relPath(filePath)}: added minimizable/maximizable for primary`);
  } else {
    console.log(`   [!] ${relPath(filePath)}: primary window pattern not found`);
  }

  // ── Fix 2: Remove `type:"panel"` from b5() on macOS ──
  // Pattern: n===`darwin`?{type:`panel`}:{}
  const panelPattern = 'n===`darwin`?{type:`panel`}:{}';

  if (content.includes(panelPattern)) {
    content = content.replace(panelPattern, 'n===`darwin`?{}:{}');
    modified = true;
    console.log(`   [fix2] ${relPath(filePath)}: removed type:\"panel\" for macOS`);
  } else {
    console.log(`   [!] ${relPath(filePath)}: panel pattern not found`);
  }

  if (!modified) {
    console.log(`   [!!] ${relPath(filePath)}: nothing to patch`);
    return false;
  }

  const patchMarker = "\n/* patch-macos-window */";
  fs.writeFileSync(filePath, content + patchMarker, "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: patched`);
  return true;
}

// ─── Fix 3: Inject CSS into index.html ───────────────────────────

function patchIndexHtml(asarDir) {
  const htmlPath = path.join(asarDir, "webview", "index.html");
  if (!fs.existsSync(htmlPath)) {
    console.log("   [--] index.html not found");
    return false;
  }

  let content = fs.readFileSync(htmlPath, "utf-8");

  if (content.includes("patch-macos-window")) {
    console.log("   [--] index.html: already patched");
    return false;
  }

  const focusCss = `
<style id="macos-focus-fix">
/* patch-macos-window: force input elements to receive focus */
input, textarea, select, [contenteditable=true], [contenteditable="true"],
[role="textbox"], [role="searchbox"], [contenteditable="plaintext-only"] {
  -webkit-app-region: no-drag !important;
}
/* Ensure the root app shell isn't blocking input */
#root, .app-shell, [class*="app-shell"] {
  -webkit-app-region: no-drag;
}
</style>`;

  // Insert before </head>
  const insertPos = content.lastIndexOf("</head>");
  if (insertPos === -1) {
    console.log("   [!] index.html: no </head> tag");
    return false;
  }

  content = content.slice(0, insertPos) + focusCss + content.slice(insertPos);
  fs.writeFileSync(htmlPath, content, "utf-8");
  console.log("   [fix3] " + relPath(htmlPath) + ": injected input focus CSS");
  return true;
}

// ─── Main ────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rawPlatform = args.find((a) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(a)
  );

  // This patch is primarily for macOS, but also applies to unix/linux
  // For win, skip the panel fix (Windows doesn't have type:'panel')
  const isWindows = rawPlatform === "win";
  const targetPlatform = rawPlatform === "unix" ? "mac-x64" : rawPlatform;
  const platforms = targetPlatform ? [targetPlatform] : ["mac-arm64", "mac-x64"];

  console.log("\n== patch-macos-window ==");

  let mainPatched = 0;
  let htmlPatched = 0;

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
      const patched = patchMainBundle(path.join(buildDir, file));
      if (patched) mainPatched++;
    }

    // Fix 3: index.html
    const asarDir = path.join(SRC_DIR, plat, "_asar");
    if (patchIndexHtml(asarDir)) htmlPatched++;
  }

  console.log(`   [done] main bundle: ${mainPatched} file(s) patched, index.html: ${htmlPatched} file(s) patched`);
}

main();
