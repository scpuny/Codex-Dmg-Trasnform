#!/usr/bin/env node
/**
 * Post-build patch: Add Linux-friendly font fallbacks
 *
 * The official Codex.app specifies macOS system fonts (-apple-system,
 * BlinkMacSystemFont, SF Pro Text). These don't exist on Linux, causing
 * fallback to DejaVu Sans which has different metrics → layout shifts
 * and poor Chinese character rendering.
 *
 * This patch inserts Linux fonts with good Chinese support (Noto Sans,
 * Noto Sans SC, Liberation Sans) into the font-family strings.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

// Linux font stack to insert before the final fallback (sans-serif)
const LINUX_FONTS = '"Noto Sans", "Noto Sans SC", "Liberation Sans", "DejaVu Sans", ';

// Files and their replacement rules
const PATCHES = [
  {
    // bootstrap.js: root font-family
    pattern: /\.(js|css)$/,
    search: 'font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;',
    replace: 'font-family: ' + LINUX_FONTS + '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;',
  },
  {
    // app-shell / main: ensure Linux fonts before OS-specific
    pattern: /\.(js|css)$/,
    search: 'font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    replace: 'font-family: ' + LINUX_FONTS + 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
  },
  {
    // Another UI font stack
    pattern: /\.(js|css)$/,
    search: 'font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;',
    replace: 'font-family: ' + LINUX_FONTS + '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;',
  },
  {
    // Monospace font stack: add Noto Sans Mono / Source Han Mono
    pattern: /\.(js|css)$/,
    search: 'font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;',
    replace: 'font-family: ui-monospace, "Noto Sans Mono", "Source Han Mono SC", SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;',
  },
  {
    // docx-preview-panel's !important font
    pattern: /\.(js|css)$/,
    search: 'font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Segoe UI", sans-serif !important;',
    replace: 'font-family: ' + LINUX_FONTS + '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Segoe UI", sans-serif !important;',
  },
];

function patchContent(content) {
  let patched = false;
  for (const p of PATCHES) {
    if (!content.includes(p.search)) continue;
    content = content.replaceAll(p.search, p.replace);
    if (content.includes(p.replace)) {
      patched = true;
    }
  }
  return patched ? content : null;
}

function main() {
  const args2 = process.argv.slice(2);
  const plat2 = args2.find((a) => ["mac-arm64", "mac-x64", "win", "unix"].includes(a));
  if (plat2 === "mac-arm64" || plat2 === "mac-x64") {
    console.log("  [skip] this patch only applies to Linux builds");
    return;
  }
  const platform = process.argv[2];
  const validPlatforms = ["mac-arm64", "mac-x64", "win", "unix"];

  if (platform && !validPlatforms.includes(platform)) {
    console.error(`[x] Unknown platform: ${platform}`);
    process.exit(1);
  }

  const platforms = platform ? [platform] : validPlatforms;

  console.log("\n== patch-fonts ==");

  let totalPatched = 0;

  for (const plat of platforms) {
    // Scan in _asar/.vite/build/
    const buildDir = path.join(SRC_DIR, plat, "_asar", ".vite", "build");
    if (fs.existsSync(buildDir)) {
      for (const file of fs.readdirSync(buildDir)) {
        const fp = path.join(buildDir, file);
        const content = fs.readFileSync(fp, "utf-8");
        const result = patchContent(content);
        if (result) {
          fs.writeFileSync(fp, result, "utf-8");
          totalPatched++;
          console.log(`   [ok] ${relPath(fp)}`);
        }
      }
    }

    // Scan in _asar/webview/assets/
    const assetsDir = path.join(SRC_DIR, plat, "_asar", "webview", "assets");
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const fp = path.join(assetsDir, file);
        const content = fs.readFileSync(fp, "utf-8");
        const result = patchContent(content);
        if (result) {
          fs.writeFileSync(fp, result, "utf-8");
          totalPatched++;
          console.log(`   [ok] ${relPath(fp)}`);
        }
      }
    }
  }

  if (totalPatched === 0) {
    console.log("   [!!] No font patterns found. Check the source files.");
    process.exit(1);
  }

  console.log(`   [ok] ${totalPatched} file(s) patched with Linux fonts`);
}

main();
