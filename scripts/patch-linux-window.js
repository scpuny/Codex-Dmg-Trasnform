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
 *   1. m5() opaque window surface check — add Linux to the platform list
 *      (was darwin|win32 only, so Linux always got transparent bg)
 *   2. B8 variable — change from transparent #00000000 to opaque #f9f9f9
 *      (backup fix for when opaqueWindowSurfaceEnabled=false)
 */
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^main-[a-zA-Z0-9]+\.js$/;

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");

  // Check if already patched
  if (content.includes("patch-linux-window")) {
    console.log(`   [--] ${relPath(filePath)}: already patched`);
    return false;
  }

  let modified = false;

  // ── Fix 1: B8 transparent → opaque ──
  // B8 is the fallback background when opaqueWindowSurfaceEnabled=false.
  // On Linux this path is taken when user settings don't enable opaque windows.
  if (content.includes("B8=`#00000000`")) {
    content = content.replace("B8=`#00000000`", "B8=`#f9f9f9`");
    modified = true;
    console.log(`   [B8] ${relPath(filePath)}: #00000000 -> #f9f9f9`);
  }

  // ── Fix 2: m5() platform check ──
  // Parse AST to find the m5 function
  let ast;
  try {
    ast = acorn.parse(content, { ecmaVersion: 2022, sourceType: "script" });
  } catch (e) {
    console.log(`   [!] ${relPath(filePath)}: parse error`);
    // Fallback: regex replacement
    return patchFallback(filePath, content, modified);
  }

  // Walk AST to find: function m5({...}) and add ||n===`linux`
  let found = false;
  let targetStart = -1;
  let targetEnd = -1;

  function walk(node, depth = 0) {
    if (!node || typeof node !== "object" || found) return;
    if (depth > 100) return;

    if (
      node.type === "FunctionDeclaration" &&
      node.id?.name === "m5"
    ) {
      const body = content.slice(node.body.start, node.body.end);
      const returnMatch = body.match(/n===`darwin`\|\|n===`win32`/);
      if (returnMatch) {
        const absPos = node.body.start + returnMatch.index;
        found = true;
        targetStart = absPos;
        targetEnd = absPos + returnMatch[0].length;
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const item of v) if (item && typeof item === "object") walk(item, depth + 1); }
      else if (v && typeof v === "object" && v.type) walk(v, depth + 1);
    }
  }

  walk(ast);

  if (found) {
    const before = content.slice(0, targetStart);
    const after = content.slice(targetEnd);
    content = before + "n===`darwin`||n===`win32`||n===`linux`" + after;
    modified = true;
    console.log(`   [m5] ${relPath(filePath)}: added Linux to opaque window check`);
  } else {
    console.log(`   [!] ${relPath(filePath)}: m5() not found via AST`);
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

function patchFallback(filePath, content, alreadyModified) {
  let result = content;
  let modified = alreadyModified || false;

  // Fix 1: B8 transparent → opaque
  if (result.includes("B8=`#00000000`")) {
    result = result.replace("B8=`#00000000`", "B8=`#f9f9f9`");
    modified = true;
    console.log(`   [B8] ${relPath(filePath)}: #00000000 -> #f9f9f9 [fallback]`);
  }

  // Fix 2: m5 platform check
  const pattern = /(n===`darwin`\|\|n===`win32`)/;
  const match = result.match(pattern);
  if (match) {
    result = result.replace(pattern, "n===`darwin`||n===`win32`||n===`linux`");
    modified = true;
    console.log(`   [m5] ${relPath(filePath)}: added Linux [fallback]`);
  }

  if (!modified) {
    console.log(`   [!!] ${relPath(filePath)}: fallback also failed`);
    return false;
  }

  const patchMarker = "\n/* patch-linux-window: opaque window bg for Linux */";
  fs.writeFileSync(filePath, result + patchMarker, "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: patched [fallback]`);
  return true;
}

function main() {
  const platform = process.argv[2];
  const validPlatforms = ["mac-arm64", "mac-x64", "win"];

  if (platform && !validPlatforms.includes(platform)) {
    console.error(`[x] Unknown platform: ${platform}`);
    process.exit(1);
  }

  const platforms = platform ? [platform] : validPlatforms;

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
    console.log("   [!!] No files patched");
    process.exit(1);
  }

  console.log(`   [ok] ${patchedCount} file(s) patched`);
}

main();
