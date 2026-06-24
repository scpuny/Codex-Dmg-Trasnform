#!/usr/bin/env node
/**
 * patch-linux-window.js — Fix transparent window background on Linux
 *
 * The official Codex.app on macOS uses a custom Codex Framework with vibrancy
 * effects and transparent window backgrounds. On Linux with standard Electron,
 * this results in a fully transparent window background (#00000000) causing
 * a black/empty window.
 *
 * Root cause:
 *   m5() checks `platform === "darwin" || platform === "win32"` for opaque
 *   window surfaces. Linux is excluded, so opaqueWindowSurfaceEnabled=false
 *   → backgroundColor=#00000000 (transparent).
 *
 * This patch adds Linux support to the m5() function so the window gets
 * proper opaque background colors (#f9f9f9 light / #000000 dark).
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

  // Parse AST to find the m5 function
  let ast;
  try {
    ast = acorn.parse(content, { ecmaVersion: 2022, sourceType: "script" });
  } catch (e) {
    console.log(`   [!] ${relPath(filePath)}: parse error, trying regex fallback`);
    // Fallback: direct string replacement
    return patchFallback(filePath, content);
  }

  // Walk AST to find: function m5({appearance, opaqueWindowsEnabled, platform}){...}
  // and add ||n===`linux` to the return condition
  let found = false;
  let targetStart = -1;
  let targetEnd = -1;
  let insertPos = -1;

  function walk(node, depth = 0) {
    if (!node || typeof node !== "object" || found) return;
    if (depth > 100) return;

    if (
      node.type === "FunctionDeclaration" &&
      node.id?.name === "m5"
    ) {
      // Found m5 function
      const body = content.slice(node.body.start, node.body.end);
      
      // Find the return statement with the platform check
      // Pattern: n===`darwin`||n===`win32`
      // We need to replace it with: n===`darwin`||n===`win32`||n===`linux`
      
      const returnMatch = body.match(/n===`darwin`\|\|n===`win32`/);
      if (returnMatch) {
        const absPos = node.body.start + returnMatch.index;
        found = true;
        targetStart = absPos;
        targetEnd = absPos + returnMatch[0].length;
      }
      return; // Found the function, stop walking
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const item of v) if (item && typeof item === "object") walk(item, depth + 1); }
      else if (v && typeof v === "object" && v.type) walk(v, depth + 1);
    }
  }

  walk(ast);

  if (!found) {
    console.log(`   [!] ${relPath(filePath)}: m5() not found via AST`);
    return patchFallback(filePath, content);
  }

  // Apply the patch
  const before = content.slice(0, targetStart);
  const after = content.slice(targetEnd);
  const newContent = before + "n===`darwin`||n===`win32`||n===`linux`" + after;

  // Check for sanity
  if (!newContent.includes("n===`darwin`||n===`win32`||n===`linux`")) {
    console.log(`   [!] ${relPath(filePath)}: sanity check failed`);
    return patchFallback(filePath, content);
  }

  const patchMarker = "\n/* patch-linux-window: opaque window bg for Linux */";
  fs.writeFileSync(filePath, newContent + patchMarker, "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: added Linux opaque window support`);
  return true;
}

function patchFallback(filePath, content) {
  // Regex fallback: find `n===`darwin`||n===`win32`` in context of m5 function
  const pattern = /(n===`darwin`\|\|n===`win32`)/;
  const match = content.match(pattern);
  
  if (!match) {
    console.log(`   [!] ${relPath(filePath)}: regex fallback also failed`);
    return false;
  }

  const newContent = content.replace(
    pattern,
    "n===`darwin`||n===`win32`||n===`linux`"
  );

  if (!newContent.includes("n===`darwin`||n===`win32`||n===`linux`")) {
    console.log(`   [!] ${relPath(filePath)}: regex fallback sanity check failed`);
    return false;
  }

  const patchMarker = "\n/* patch-linux-window: opaque window bg for Linux */";
  fs.writeFileSync(filePath, newContent + patchMarker, "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: [fallback] added Linux opaque window support`);
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
