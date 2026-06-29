#!/usr/bin/env node
/**
 * patch-linux-controls.js — Fix window controls, input focus & always-on-top on Linux
 *
 * On Linux, the OEM macOS ASAR uses `titleBarStyle: "hidden"` + titleBarOverlay for
 * the primary window.  This works poorly on Linux with standard Electron:
 *   • titleBarOverlay buttons (min/max/close) often don't fire correctly,
 *   • -webkit-app-region: drag regions intercept clicks before they reach inputs,
 *   • some window managers treat "hidden"-style windows as utility/dock panels,
 *     causing the "always on top" problem.
 *
 * Three fixes:
 *   1. x5() primary → split the win32||linux branch: Windows keeps
 *      titleBarStyle:"hidden"+overlay; Linux uses titleBarStyle:"default"
 *      (native window-manager decorations with working buttons).
 *   2. Inject CSS into index.html that forces -webkit-app-region:no-drag
 *      on every focusable element so clicks reach the text fields.
 *   3. Remove `type:"panel"` from the b5() helper on macOS (harmless on Linux,
 *      but prevents panel float issues when the DMG is opened on a Mac).
 *
 * Usage:
 *   node scripts/patch-linux-controls.js       # applies on all platforms
 *   node scripts/patch-linux-controls.js unix   # explicit Linux build
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^main-[a-zA-Z0-9]+\.js$/;

// ─── Fix 1 & 3: Patch the main‑process bundle ────────────────────

function patchMainBundle(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");

  if (content.includes("patch-linux-controls")) {
    console.log(`   [--] ${relPath(filePath)}: already patched`);
    return false;
  }

  let modified = false;

  // ── Fix 1: Split win32||linux → Linux gets native title bar ──
  // Pattern (current state, may already have minimizable/maximizable):
  //   n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:n5(r)…}
  // Replacement:
  //   n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:n5(r)…}:n===`linux`?{titleBarStyle:`default`…}

  // Match the Linux/win32 branch — capture everything from the ternary start to the ':' after titleBarOverlay:n5(r)
  const linuxBranchRegex =
    /n===\x60win32\x60\|\|n===\x60linux\x60\?\{titleBarStyle:\x60hidden\x60,titleBarOverlay:n5\(r\)([^}]*)\}/;

  const linuxBranchMatch = content.match(linuxBranchRegex);
  if (linuxBranchMatch) {
    const captured = linuxBranchMatch[1]; // anything after titleBarOverlay:n5(r) before closing }
    const oldStr = linuxBranchMatch[0];
    const newStr =
      'n===\x60win32\x60?{titleBarStyle:\x60hidden\x60,titleBarOverlay:n5(r)' +
      captured +
      '}:n===\x60linux\x60?{titleBarStyle:\x60default\x60' +
      captured +
      '}';
    content = content.replace(oldStr, newStr);
    modified = true;
    console.log(`   [fix1] ${relPath(filePath)}: split win32||linux → Linux uses titleBarStyle:default`);
  } else {
    console.log(`   [!] ${relPath(filePath)}: Linux/win32 branch not found`);
  }

  // ── Fix 3: Remove `type:"panel"` from b5() on macOS ──
  const panelPattern = 'n===\x60darwin\x60?{type:\x60panel\x60}:{}';
  if (content.includes(panelPattern)) {
    content = content.replace(panelPattern, 'n===\x60darwin\x60?{}:{}');
    modified = true;
    console.log(`   [fix3] ${relPath(filePath)}: removed type:"panel" for macOS`);
  } else {
    console.log(`   [??] ${relPath(filePath)}: type:"panel" not found (may already be removed)`);
  }

  if (!modified) {
    console.log(`   [!!] ${relPath(filePath)}: nothing to patch`);
    return false;
  }

  const patchMarker = "\n/* patch-linux-controls */";
  fs.writeFileSync(filePath, content + patchMarker, "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: patched`);
  return true;
}

// ─── Fix 2: Inject CSS into index.html ───────────────────────────

function patchIndexHtml(asarDir) {
  const htmlPath = path.join(asarDir, "webview", "index.html");
  if (!fs.existsSync(htmlPath)) {
    console.log("   [--] index.html not found");
    return false;
  }

  let content = fs.readFileSync(htmlPath, "utf-8");

  if (content.includes("patch-linux-controls")) {
    console.log("   [--] index.html: already patched");
    return false;
  }

  const focusCss = `
<style id="linux-focus-region-fix">
/* patch-linux-controls: force focusable elements to not be drag regions */
input, textarea, select, [contenteditable=true], [contenteditable="true"],
[role="textbox"], [role="searchbox"], [contenteditable="plaintext-only"] {
  -webkit-app-region: no-drag !important;
}
#root, .app-shell, [class*="app-shell"] {
  -webkit-app-region: no-drag;
}
</style>`;

  const insertPos = content.lastIndexOf("</head>");
  if (insertPos === -1) {
    console.log("   [!] index.html: no </head> tag");
    return false;
  }

  content = content.slice(0, insertPos) + focusCss + content.slice(insertPos);
  fs.writeFileSync(htmlPath, content, "utf-8");
  console.log("   [fix2] " + relPath(htmlPath) + ": injected input focus CSS");
  return true;
}

// ─── Main ────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rawPlatform = args.find((a) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(a)
  );

  // Resolve: unix builds read from src/mac-x64
  const targetPlatform = rawPlatform === "unix" ? "mac-x64" : rawPlatform;
  const platforms = targetPlatform ? [targetPlatform] : ["mac-arm64", "mac-x64"];

  console.log("\n== patch-linux-controls ==");

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
      if (patchMainBundle(path.join(buildDir, file))) mainPatched++;
    }

    const asarDir = path.join(SRC_DIR, plat, "_asar");
    if (patchIndexHtml(asarDir)) htmlPatched++;
  }

  console.log(`   [done] main bundle: ${mainPatched}x, index.html: ${htmlPatched}x`);
}

main();
