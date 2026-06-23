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
 *    the binding call but left a sparse mock ({isOwlFeatureEnabled:()=>!1})
 *    by expanding it with the full UI parameter set.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^workspace-root-drop-handler-.*\.js$/;

// Complete mock object literal that provides all UI/styling parameters.
// Ge.parse() uses passthrough (.pc()), so extra fields are preserved.
const RICH_MOCK = `({isOwlFeatureEnabled:()=>!1` +
  `,getFeatureFlags:()=>({enableTransparentWindow:false,enableLayerBlur:false,windowRoundedCorners:8,useNativeTitlebar:false,animationLevel:1,enableSidebarShadow:true,sidebarFixedWidth:240,sidebarItemPadding:12,sidebarSeparatorVisible:true})` +
  `,initRenderer:()=>{}` +
  `,getWindowFlags:()=>({transparent:false,vibrancy:"none",shadow:true})` +
  `,getUIScaleFactor:()=>1.0` +
  `,getSystemAppearance:()=>"dark"` +
  `,getSidebarConfig:()=>({width:240,shadowOpacity:0.12,itemBorderRadius:6,hoverBgOpacity:0.08,separatorOpacity:0.1})` +
`})`;

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
      content = content.replace(PATTERN_CALL, RICH_MOCK);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: replaced binding call with rich mock`);
  }

  // Pattern: process._linkedBinding("electron_common_owl_features")
  if (content.includes(PATTERN_DIRECT)) {
    while (content.includes(PATTERN_DIRECT)) {
      content = content.replace(PATTERN_DIRECT, RICH_MOCK);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: replaced direct _linkedBinding call`);
  }

  if (content.includes(PATTERN_DIRECT_SQ)) {
    while (content.includes(PATTERN_DIRECT_SQ)) {
      content = content.replace(PATTERN_DIRECT_SQ, RICH_MOCK);
      modified = true;
    }
    console.log(`   [apply] ${relPath(filePath)}: replaced direct _linkedBinding call (sq)`);
  }

  // Method 2: Expand already-minimally-patched sparse mock to rich mock
  // Pattern: Ge.parse({isOwlFeatureEnabled:()=>!1}) 
  //          → Ge.parse(RICH_MOCK)
  if (content.includes(PATTERN_SPARSE)) {
    while (content.includes(PATTERN_SPARSE)) {
      content = content.replace(PATTERN_SPARSE, `Ge.parse(${RICH_MOCK})`);
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
