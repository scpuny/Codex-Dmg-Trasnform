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
 *   1. x5() primary → split the win32||linux branch
 *   2. Inject CSS into index.html for input focus
 *   3. Remove `type:"panel"` from the b5() helper on macOS
 *   4. setWindowZoom — don't call setTitleBarOverlay on Linux (titleBarStyle:default)
 *   5. installApplicationMenuTitleBarOverlaySync — don't set up overlay on Linux
 *
 * Fixes 1,2,4,5 only apply on Linux builds; fix 3 always applies.
 *
 * Usage:
 *   node scripts/patch-linux-controls.js       # applies on all platforms
 *   node scripts/patch-linux-controls.js unix   # explicit Linux build
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^main-[a-zA-Z0-9_-]+\.js$/;

// ─── Fix 1 & 3: Patch the main‑process bundle ────────────────────

function patchMainBundle(filePath, isLinuxBuild) {
  let content = fs.readFileSync(filePath, "utf-8");

  if (content.includes("patch-linux-controls")) {
    console.log(`   [--] ${relPath(filePath)}: already patched`);
    return false;
  }

  let modified = false;

  // ── Fix 1: Split win32||linux → Linux gets native title bar ──
  // Only applies to Linux builds; macOS builds keep the original joint branch.
  if (isLinuxBuild) {
    // Match: n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:XXX(r)…}
    // where XXX is any single-char-or-digit function name (minified varies per build)
    const linuxBranchRegex =
      /n===\x60win32\x60\|\|n===\x60linux\x60\?\{titleBarStyle:\x60hidden\x60,titleBarOverlay:(\w+)\(r\)([^}]*)\}/;

    const linuxBranchMatch = content.match(linuxBranchRegex);
    if (linuxBranchMatch) {
      const funcName = linuxBranchMatch[1];  // e.g. n5 or m9
      const captured = linuxBranchMatch[2]; // anything after titleBarOverlay:XXX(r) before closing }
      const oldStr = linuxBranchMatch[0];
      const newStr =
        'n===\x60win32\x60?{titleBarStyle:\x60hidden\x60,titleBarOverlay:' + funcName + '(r)' +
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
  }

  // ── Fix 4: setWindowZoom — don't call setTitleBarOverlay on Linux ──
  if (isLinuxBuild) {
    // Remove linux from the conditional so setTitleBarOverlay is only called on win32
    const zoomRegex =
      /process\.platform===\x60win32\x60\|\|process\.platform===\x60linux\x60\)&&\(this\.windowZooms\.set\(n\.id,t\),n\.setTitleBarOverlay\((\w+)\(t\)\)\)/;
    const zoomMatch = content.match(zoomRegex);
    if (zoomMatch) {
      const funcName = zoomMatch[1];
      const oldStr = zoomMatch[0];
      const newStr =
        'process.platform===\x60win32\x60)&&(this.windowZooms.set(n.id,t),n.setTitleBarOverlay(' + funcName + '(t)))';
      content = content.replace(oldStr, newStr);
      modified = true;
      console.log(`   [fix4] ${relPath(filePath)}: removed linux from setWindowZoom overlay call`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: setWindowZoom overlay call not found`);
    }
  }

  // ── Fix 5: installApplicationMenuTitleBarOverlaySync — skip on Linux ──
  if (isLinuxBuild) {
    // Remove linux from the guard so overlay is only installed on win32
    const overlaySyncPattern =
      'process.platform!==\x60win32\x60&&process.platform!==\x60linux\x60||t!==\x60primary\x60';
    if (content.includes(overlaySyncPattern)) {
      content = content.replace(
        overlaySyncPattern,
        'process.platform!==\x60win32\x60||t!==\x60primary\x60'
      );
      modified = true;
      console.log(`   [fix5] ${relPath(filePath)}: removed linux from installApplicationMenuTitleBarOverlaySync guard`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: installApplicationMenuTitleBarOverlaySync guard not found`);
    }
  }

  // ── Fix 3: Remove `type:"panel"` from b5() on macOS ──
  // Relevant on both macOS and Linux builds (the pattern is in the shared bundle).
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

    const isLinuxBuild = rawPlatform === "unix";

    for (const file of files) {
      if (patchMainBundle(path.join(buildDir, file), isLinuxBuild)) mainPatched++;
    }

    const asarDir = path.join(SRC_DIR, plat, "_asar");
    // Fix 2 (CSS input focus) only needed on Linux
    if (isLinuxBuild && patchIndexHtml(asarDir)) htmlPatched++;
  }

  console.log(`   [done] main bundle: ${mainPatched}x, index.html: ${htmlPatched}x`);
}

main();
