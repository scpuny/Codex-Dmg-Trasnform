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

// CSS defaults extracted from the app's own popcorn-electron-surface-style-jyyIi7EC.js
// which ships the correct light/dark colors but the variable chain depends on
// Codex Framework's CSS env vars that don't exist on standard Electron.
const CSS_BLOCK = `
:root {
  --color-background-surface: #ffffff;
  --color-background-elevated-primary: #ffffff;
  --color-background-elevated-primary-opaque: #ffffff;
  --color-background-elevated-secondary: #f5f5f5;
  --color-background-elevated-secondary-opaque: #f5f5f5;
  --color-token-main-surface-primary: var(--color-background-surface);
  --color-token-side-bar-background: var(--color-background-surface);
  --color-token-bg-primary: var(--color-background-surface);
  --color-token-bg-secondary: var(--color-background-surface);
  --color-token-bg-tertiary: rgba(0, 0, 0, 0.03);
  --color-token-foreground: rgba(13, 13, 13, 1);
  --color-token-text-primary: rgba(13, 13, 13, 1);
  --color-token-text-secondary: rgba(143, 143, 143, 1);
  --color-token-text-tertiary: rgba(143, 143, 143, 1);
  --color-token-description-foreground: rgba(143, 143, 143, 1);
  --color-token-border-default: rgba(13, 13, 13, 0.08);
  --color-token-border-light: rgba(13, 13, 13, 0.05);
  --color-token-charts-blue: #339cff;
  --color-token-list-hover-background: rgba(0, 0, 0, 0.05);
  --color-token-focus-border: rgba(16, 163, 127, 0.8);
  --color-token-interactive-bg-secondary-hover: rgba(13, 13, 13, 0.02);
  --color-token-interactive-bg-secondary-press: rgba(13, 13, 13, 0.05);
  --color-token-interactive-bg-secondary-selected: rgba(13, 13, 13, 0.05);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-background-surface: #1a1a1a;
    --color-background-elevated-primary: #1a1a1a;
    --color-background-elevated-primary-opaque: #1a1a1a;
    --color-background-elevated-secondary: #252525;
    --color-background-elevated-secondary-opaque: #252525;
    --color-token-main-surface-primary: var(--color-background-surface);
    --color-token-side-bar-background: var(--color-background-surface);
    --color-token-bg-primary: var(--color-background-surface);
    --color-token-bg-secondary: var(--color-background-surface);
    --color-token-bg-tertiary: rgba(255, 255, 255, 0.03);
    --color-token-foreground: rgba(235, 235, 235, 1);
    --color-token-text-primary: rgba(235, 235, 235, 1);
    --color-token-text-secondary: rgba(163, 163, 163, 1);
    --color-token-text-tertiary: rgba(163, 163, 163, 1);
    --color-token-description-foreground: rgba(163, 163, 163, 1);
    --color-token-border-default: rgba(235, 235, 235, 0.12);
    --color-token-border-light: rgba(235, 235, 235, 0.08);
    --color-token-charts-blue: #339cff;
    --color-token-list-hover-background: rgba(255, 255, 255, 0.08);
    --color-token-focus-border: rgba(16, 163, 127, 0.8);
    --color-token-interactive-bg-secondary-hover: rgba(255, 255, 255, 0.05);
    --color-token-interactive-bg-secondary-press: rgba(255, 255, 255, 0.08);
    --color-token-interactive-bg-secondary-selected: rgba(255, 255, 255, 0.08);
    color-scheme: dark;
  }
}
`;

function main() {
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
