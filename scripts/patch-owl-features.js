#!/usr/bin/env node
/**
 * Post-build patch: Handle missing electron_common_owl_features binding
 *
 * The official Codex.app on macOS has a custom Codex Framework.framework
 * that provides the `electron_common_owl_features` linked binding.
 * On Linux with standard Electron, this binding doesn't exist.
 *
 * This patch modifies the Qe() function in workspace-root-drop-handler-*.js
 * to catch the error gracefully and return a default (all features disabled)
 * instead of crashing with "No such binding was linked".
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^workspace-root-drop-handler-.*\.js$/;
const SEARCH = 'throw Error(`Owl feature binding is unavailable`)';
const REPLACE = 'return Ge.parse({isOwlFeatureEnabled:()=>!1})';

let patchedCount = 0;

function patchFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");
  if (!original.includes("electron_common_owl_features")) return;

  const updated = original.replace(SEARCH, REPLACE);
  if (updated === original) {
    console.log(`   [!] ${relPath(filePath)}: pattern not found`);
    return;
  }

  fs.writeFileSync(filePath, updated, "utf-8");
  patchedCount++;
  console.log(`   [ok] ${relPath(filePath)}: owl_features binding fallback`);
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
      console.log(`   [--] ${plat}: no workspace-root-drop-handler file`);
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
