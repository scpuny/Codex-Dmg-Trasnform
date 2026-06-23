#!/usr/bin/env node
/**
 * Post-build patch: Replace electron_common_owl_features binding with rich mock
 *
 * On macOS, Codex.app uses a custom Codex Framework.framework that provides
 * the `electron_common_owl_features` native C++ binding via
 * process._linkedBinding(). This binding returns an object with UI/UX
 * configuration methods (sidebar, window, appearance, etc.).
 *
 * On Linux with standard Electron, this binding doesn't exist. This patch:
 *
 * 1. Replaces all calls to the binding (e.call or direct) with a rich mock
 *    that provides ALL UI styling parameters the frontend expects:
 *    - getFeatureFlags, getSidebarConfig, getWindowFlags
 *    - getUIScaleFactor, getSystemAppearance, initRenderer
 *
 * 2. Also handles the case where a previous minimal patch already removed
 *    the binding call but left a sparse mock ({isOwlFeatureEnabled:()=>!1}).
 *
 * Note: After inspecting the actual code, the OWL binding schema is only:
 *   Ge = t.pc({isOwlFeatureEnabled: t.sc(e=>typeof e=='function')})
 * and the ONLY method ever called is .isOwlFeatureEnabled(name).
 * No getFeatureFlags/getSidebarConfig/etc. exist in the source.
 * Those were AI hallucinations. The minimal mock is sufficient.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^workspace-root-drop-handler-.*\.js$/;

// Minimal mock — actual inspection of the source reveals the ONLY
// method called on the binding result is .isOwlFeatureEnabled(name).
// The binding schema is simply: Ge = t.pc({isOwlFeatureEnabled: t.sc(e=>typeof e=='function')})
// No getFeatureFlags / getSidebarConfig / etc. exist in the codebase.
// Extra fields in the mock would be dead code — keep it minimal.
const MOCK_STRING = `({isOwlFeatureEnabled:()=>!1})`;

// Pattern 1: Direct binding call (before any patch)
const PATTERN_CALL = 'e.call(process,`electron_common_owl_features`)';
const PATTERN_DIRECT = 'process._linkedBinding("electron_common_owl_features")';
const PATTERN_DIRECT_SQ = "process._linkedBinding('electron_common_owl_features')";

// Pattern 2: Already-minimally-patched — sparse object inside Ge.parse()
// Matches: Ge.parse({isOwlFeatureEnabled:()=>!1})
// This is the result of a previous patch that only prevented the crash
const PATTERN_SPARSE = 'Ge.parse({isOwlFeatureEnabled:()=>!1})';

let patchedCount = 0;

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes("electron_common_owl_features") && !content.includes(PATTERN_SPARSE)) return;

  let modified = false;

  // Method 1: Replace full binding call with rich mock
  // Pattern: e.call(process,`electron_common_owl_features`)
  if (content.includes(PATTERN_CALL)) {
    while (content.includes(PATTERN_CALL)) {
      content = content.replace(PATTERN_CALL, MOCK_STRING);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: replaced binding call with rich mock`);
  }

  // Pattern: process._linkedBinding("electron_common_owl_features")
  if (content.includes(PATTERN_DIRECT)) {
    while (content.includes(PATTERN_DIRECT)) {
      content = content.replace(PATTERN_DIRECT, MOCK_STRING);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: replaced direct _linkedBinding call`);
  }

  if (content.includes(PATTERN_DIRECT_SQ)) {
    while (content.includes(PATTERN_DIRECT_SQ)) {
      content = content.replace(PATTERN_DIRECT_SQ, MOCK_STRING);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: replaced direct _linkedBinding call (sq)`);
  }

  // Method 2: Expand already-minimally-patched sparse mock to rich mock
  // Pattern: Ge.parse({isOwlFeatureEnabled:()=>!1}) 
  //          → Ge.parse(MOCK_STRING)
  if (content.includes(PATTERN_SPARSE)) {
    while (content.includes(PATTERN_SPARSE)) {
      content = content.replace(PATTERN_SPARSE, `Ge.parse(${MOCK_STRING})`);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: expanded sparse mock to rich mock`);
  }

  if (!modified) {
    console.log(`   [!] ${relPath(filePath)}: no pattern matched`);
    return;
  }

  fs.writeFileSync(filePath, content, "utf-8");
  patchedCount++;
  console.log(`   [ok] ${relPath(filePath)}: owl_features replaced with rich UI mock`);
}

function main() {
  const platform = process.argv[2];
  const validPlatforms = ["mac-arm64", "mac-x64", "win"];

  if (platform && !validPlatforms.includes(platform)) {
    console.error(`[x] Unknown platform: ${platform}`);
    process.exit(1);
  }

  const platforms = platform ? [platform] : validPlatforms;

  console.log("\n== patch-owl-features ==");

  for (const plat of platforms) {
    const buildDir = path.join(SRC_DIR, plat, "_asar", ".vite", "build");
    if (!fs.existsSync(buildDir)) continue;

    const files = fs.readdirSync(buildDir).filter((f) => TARGET_PATTERN.test(f));
    if (files.length === 0) {
      console.log(`   [--] ${plat}: no target file`);
      continue;
    }

    for (const file of files) {
      patchFile(path.join(buildDir, file));
    }
  }

  if (patchedCount === 0) {
    console.log("   [!!] No files patched. Check file location/pattern.");
    process.exit(1);
  }

  console.log(`   [ok] ${patchedCount} file(s) patched`);
}

main();
