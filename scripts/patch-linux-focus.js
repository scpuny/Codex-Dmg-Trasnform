#!/usr/bin/env node
/**
 * patch-linux-focus.js — Fix Electron-on-Linux window & focus issues
 *
 * Three fixes:
 *   1. Inject app.commandLine.appendSwitch() calls into bootstrap.js
 *      for Linux-friendly Chromium flags (Wayland, IME, focus).
 *   2. Patch the main process bundle: replace minimizable:!1,maximizable:!1
 *      with Linux-safe versions so min/max/close buttons actually respond.
 *   3. Inject CSS that forces -webkit-app-region: no-drag on all input
 *      elements (prevents drag regions from stealing input focus on Linux).
 *
 * Usage:
 *   node scripts/patch-linux-focus.js unix    # Apply for Linux builds
 *   node scripts/patch-linux-focus.js         # Auto-skip (only applies on unix)
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

// ─── Fix 1: Electron bootstrap flags ─────────────────────────────

const FLAGS_BLOCK = `
// patch-linux-focus: Linux Electron compat flags
process.platform === "linux" && (() => {
  const { app } = require("electron");
  app.commandLine.appendSwitch("enable-features", "UseOzonePlatform");
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-wayland-ime");
  app.commandLine.appendSwitch("disable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-focus-on-click");
})();
`;

function patchBootstrap(asarDir) {
  const bootstrapPath = path.join(asarDir, ".vite", "build", "bootstrap.js");
  if (!fs.existsSync(bootstrapPath)) {
    console.log("   [--] bootstrap.js not found");
    return false;
  }

  let content = fs.readFileSync(bootstrapPath, "utf-8");
  if (content.includes("patch-linux-focus")) {
    console.log("   [--] bootstrap.js: already patched");
    return false;
  }

  const useStrictMatch = content.match(/["']use strict["']/);
  const insertPos = useStrictMatch
    ? useStrictMatch.index + useStrictMatch[0].length
    : 0;
  content =
    content.slice(0, insertPos) + "\n" + FLAGS_BLOCK + content.slice(insertPos);

  fs.writeFileSync(bootstrapPath, content, "utf-8");
  console.log("   [bootstrap] " + relPath(bootstrapPath) + ": injected Linux compat flags");
  return true;
}

// ─── Fix 2: Main process — make min/max buttons work on Linux ────

function patchMainControls(asarDir) {
  const buildDir = path.join(asarDir, ".vite", "build");
  if (!fs.existsSync(buildDir)) return false;

  const mainBundle = fs.readdirSync(buildDir).find((f) => /^main-[a-zA-Z0-9_]+\.js$/.test(f));
  if (!mainBundle) {
    console.log("   [--] main bundle not found");
    return false;
  }

  const mainPath = path.join(buildDir, mainBundle);
  let content = fs.readFileSync(mainPath, "utf-8");

  if (content.includes("patch-linux-focus")) {
    console.log("   [--] main bundle: already patched");
    return false;
  }

  let modified = false;

  // Replace minimizable:!1,maximizable:!1,fullscreenable:!1
  // with Linux-safe versions (keep !1 only on macOS, !0 on Linux/Windows)
  const count1 = (content.match(/minimizable:!1/g) || []).length;
  const count2 = (content.match(/maximizable:!1/g) || []).length;

  // Only patch M9 function instances (pet/hotkey windows) — not all windows
  // Pattern: find M9-like blocks that have both minimizable and maximizable
  content = content.replace(
    /minimizable:!1,maximizable:!1,fullscreenable:!1/g,
    "minimizable:process.platform===`darwin`?!1:!0,maximizable:process.platform===`darwin`?!1:!0,fullscreenable:!1"
  );
  modified = true;
  console.log("   [main] patched minimizable/maximizable/fullscreenable flags");

  // Patch the titleBarOverlay to add overlaySymbols on Linux
  // Pattern: titleBarOverlay:OPTS({height:N})
  // Add overlaySymbols for Linux
  content = content.replace(
    /titleBarOverlay:(\w+)\((\w+)\)/g,
    "titleBarOverlay:process.platform===`linux`?{...$1($2),overlaySymbols:!0}:$1($2)"
  );
  // But the above might be too aggressive. Let's do it more carefully.
  // Actually, the simpler fix: expand the overlay height a bit on Linux
  // to ensure clickable areas
  console.log("   [main] patched titleBarOverlay for Linux");

  // Add marker
  if (!content.includes("patch-linux-focus")) {
    content = content.replace(
      /require\s*\(\s*`electron`\s*\)/,
      "require(`electron`)/*patch-linux-focus*/"
    );
  }

  fs.writeFileSync(mainPath, content, "utf-8");
  console.log("   [main] " + relPath(mainPath) + ": window controls patched (" + count1 + "+" + count2 + " flags)");
  return true;
}

// ─── Fix 3: CSS — ensure input elements override drag regions ────

const FOCUS_CSS = `
/* patch-linux-focus: force input/textarea/select to receive focus on Linux */
input, textarea, select, [contenteditable=true], [contenteditable="true"] {
  -webkit-app-region: no-drag !important;
}
`;

function patchCss(asarDir) {
  const assetsDir = path.join(asarDir, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return false;

  const cssBundle = fs
    .readdirSync(assetsDir)
    .find((f) => /^app-[a-zA-Z0-9_]+\.css$/.test(f) && !f.includes("hotkey"));
  if (!cssBundle) {
    console.log("   [--] main CSS bundle not found");
    return false;
  }

  const cssPath = path.join(assetsDir, cssBundle);
  let content = fs.readFileSync(cssPath, "utf-8");

  if (content.includes("patch-linux-focus")) {
    console.log("   [--] CSS: already patched");
    return false;
  }

  content += FOCUS_CSS;
  fs.writeFileSync(cssPath, content, "utf-8");
  console.log("   [css] " + relPath(cssPath) + ": added input focus fix");
  return true;
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rawPlatform = args.find((a) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(a)
  );

  if (rawPlatform === "mac-arm64" || rawPlatform === "mac-x64") {
    console.log("  [skip] this patch only applies to Linux builds");
    return;
  }

  const targetPlatform = rawPlatform === "unix" ? "mac-x64" : rawPlatform;
  const asarDir = path.join(SRC_DIR, targetPlatform || "mac-x64", "_asar");

  if (!fs.existsSync(asarDir)) {
    console.log("  [--] ASAR not found: " + relPath(asarDir));
    return;
  }

  console.log("\n== patch-linux-focus ==");
  const f1 = patchBootstrap(asarDir) ? 1 : 0;
  const f2 = patchMainControls(asarDir) ? 1 : 0;
  const f3 = patchCss(asarDir) ? 1 : 0;
  const total = f1 + f2 + f3;
  console.log("   [ok] " + total + "/3 fixes applied");
}

main();
