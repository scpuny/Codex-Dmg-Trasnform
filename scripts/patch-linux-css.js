#!/usr/bin/env node
/**
 * Post-build patch: Inject Linux-compatible CSS defaults into webview/index.html
 *
 * The official Codex.app on macOS uses a custom Codex Framework that provides
 * CSS environment variable support (e.g. `electron:[]` selectors). Standard
 * Electron on Linux does not support these, causing CSS variable cascade to
 * break:
 *
 * - Light mode: sidebar black (--color-token-side-bar-background undefined)
 * - Dark mode: ghosting/double text (layers without proper background)
 *
 * This patch injects a <style> block directly into webview/index.html before
 * the app JS loads, ensuring CSS variables always have fallback defaults.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

// CSS defaults extracted from the official Codex Light / Codex Dark theme files
// (codex-light-BezawPEe.js / codex-dark-DEKyfV9v.js).
//
// On macOS the Codex Framework's CSS env vars provide correct --vscode-* values,
// but on standard Electron (Linux) the app's CSS chain
//   --color-token-side-bar-background: var(--vscode-sideBar-background)
// resolves to wrong defaults (e.g. pure black #000 instead of #131313).
//
// The app's CSS (<link> injected by Vite at runtime) lands AFTER this <style>
// in document order, so it would override our values without !important.
// Using !important ensures correct colors even when the framework env vars
// are unavailable, preventing ghosting / double-text rendering issues.
const CSS_BLOCK = `
:root {
  --startup-background: #ffffff !important;
  --color-background-surface: #ffffff !important;
  --color-background-elevated-primary: #ffffff !important;
  --color-background-elevated-primary-opaque: #ffffff !important;
  --color-background-elevated-secondary: #f5f5f5 !important;
  --color-background-elevated-secondary-opaque: #f5f5f5 !important;
  --color-token-main-surface-primary: var(--color-background-surface) !important;
  --color-token-side-bar-background: #fcfcfc !important;
  --color-token-bg-primary: var(--color-token-side-bar-background) !important;
  --color-token-bg-secondary: var(--color-token-side-bar-background) !important;
  --color-token-bg-tertiary: rgba(0, 0, 0, 0.03) !important;
  --color-token-foreground: rgba(13, 13, 13, 1) !important;
  --color-token-text-primary: rgba(13, 13, 13, 1) !important;
  --color-token-text-secondary: rgba(143, 143, 143, 1) !important;
  --color-token-text-tertiary: rgba(143, 143, 143, 1) !important;
  --color-token-description-foreground: rgba(143, 143, 143, 1) !important;
  --color-token-border-default: rgba(13, 13, 13, 0.08) !important;
  --color-token-border-light: rgba(13, 13, 13, 0.05) !important;
  --color-token-charts-blue: #339cff !important;
  --color-token-list-hover-background: rgba(0, 0, 0, 0.05) !important;
  --color-token-focus-border: rgba(16, 163, 127, 0.8) !important;
  --color-token-interactive-bg-secondary-hover: rgba(13, 13, 13, 0.02) !important;
  --color-token-interactive-bg-secondary-press: rgba(13, 13, 13, 0.05) !important;
  --color-token-interactive-bg-secondary-selected: rgba(13, 13, 13, 0.05) !important;
  color-scheme: light !important;
}
@media (prefers-color-scheme: dark) {
  :root {
    --startup-background: #111111 !important;
    --color-background-surface: #111111 !important;
    --color-background-elevated-primary: #111111 !important;
    --color-background-elevated-primary-opaque: #111111 !important;
    --color-background-elevated-secondary: #252525 !important;
    --color-background-elevated-secondary-opaque: #252525 !important;
    --color-token-main-surface-primary: var(--color-background-surface) !important;
    --color-token-side-bar-background: #131313 !important;
    --color-token-bg-primary: var(--color-token-side-bar-background) !important;
    --color-token-bg-secondary: var(--color-token-side-bar-background) !important;
    --color-token-bg-tertiary: rgba(255, 255, 255, 0.03) !important;
    --color-token-foreground: rgba(235, 235, 235, 1) !important;
    --color-token-text-primary: rgba(235, 235, 235, 1) !important;
    --color-token-text-secondary: rgba(163, 163, 163, 1) !important;
    --color-token-text-tertiary: rgba(163, 163, 163, 1) !important;
    --color-token-description-foreground: rgba(163, 163, 163, 1) !important;
    --color-token-border-default: rgba(235, 235, 235, 0.12) !important;
    --color-token-border-light: rgba(235, 235, 235, 0.08) !important;
    --color-token-charts-blue: #339cff !important;
    --color-token-list-hover-background: rgba(255, 255, 255, 0.08) !important;
    --color-token-focus-border: rgba(16, 163, 127, 0.8) !important;
    --color-token-interactive-bg-secondary-hover: rgba(255, 255, 255, 0.05) !important;
    --color-token-interactive-bg-secondary-press: rgba(255, 255, 255, 0.08) !important;
    --color-token-interactive-bg-secondary-selected: rgba(255, 255, 255, 0.08) !important;
    color-scheme: dark !important;
  }
}
`;

function main() {
  const args2 = process.argv.slice(2);
  const plat2 = args2.find((a) => ["mac-arm64", "mac-x64", "win", "unix"].includes(a));
  if (plat2 === "mac-arm64" || plat2 === "mac-x64") {
    console.log("  [skip] this patch only applies to Linux builds");
    return;
  }
  const platform = process.argv[2];
  const validPlatforms = ["mac-arm64", "mac-x64", "win"];

  if (platform && !validPlatforms.includes(platform)) {
    console.error(`[x] Unknown platform: ${platform}`);
    process.exit(1);
  }

  const platforms = platform ? [platform] : validPlatforms;

  console.log("\n== patch-linux-css ==");

  let patchedCount = 0;

  for (const plat of platforms) {
    // Target webview/index.html
    const indexPath = path.join(SRC_DIR, plat, "_asar", "webview", "index.html");
    if (!fs.existsSync(indexPath)) {
      console.log(`   [--] ${plat}: no webview/index.html`);
      continue;
    }

    let content = fs.readFileSync(indexPath, "utf-8");

    // Check if already patched
    if (content.includes("patch-linux-css")) {
      console.log(`   [--] ${plat}: already patched`);
      continue;
    }

    // Insert CSS block before </head>
    const injectHtml = `<!-- patch-linux-css -->\n<style id="linux-css-fix">${CSS_BLOCK}</style>\n`;
    content = content.replace("</head>", injectHtml + "</head>");

    fs.writeFileSync(indexPath, content, "utf-8");
    patchedCount++;
    console.log(`   [ok] ${relPath(indexPath)}: injected Linux CSS defaults`);
  }

  if (patchedCount === 0) {
    console.log("   [!!] No files patched");
    process.exit(1);
  }

  console.log(`   [ok] ${patchedCount} file(s) patched`);
}

main();
