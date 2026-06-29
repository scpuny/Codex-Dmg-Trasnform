#!/usr/bin/env node
/**
 * patch-linux-controls.js — Fix window management on Linux
 *
 * root cause: The macOS ASAR's M9() helper (frameless window factory)
 * sets frame:!1 & skipTaskbar:!0 on every platform, including Linux.
 * titleBarStyle is macOS-only — it's silently ignored on Linux.
 *
 * Fixes (Linux-only unless noted):
 *   1. M9() helper → frame,fullscreenable,skipTaskbar conditional on Linux
 *   2. N9() primary → split win32||linux branch (Linux gets default frame)
 *   3. overlay windows → add explicit frame:!1 on Linux (they need to float)
 *   4. hud window → remove alwaysOnTop on Linux
 *   5. CSS → -webkit-app-region:no-drag on all focusable elements
 *   6. setWindowZoom → remove Linux from overlay call
 *   7. installApplicationMenuTitleBarOverlaySync → skip on Linux
 *   8. type:"panel" removal from macOS (applies always)
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, relPath } = require("./patch-util");

const TARGET_PATTERN = /^main-[a-zA-Z0-9_-]+\.js$/;

function patchMainBundle(filePath, isLinuxBuild) {
  let content = fs.readFileSync(filePath, "utf-8");

  if (content.includes("patch-linux-controls")) {
    console.log(`   [--] ${relPath(filePath)}: already patched`);
    return false;
  }

  let modified = false;

  // ── Fix 1: M9() helper — framed windows on Linux ──
  // Original (unpatched): frame:!1,...fullscreenable:!1,...skipTaskbar:!0,...{type:`panel`}:{}
  // We need to match the pre-Fix-3 state (with type:panel) since this runs before Fix 3.
  if (isLinuxBuild) {
    // Fresh upstream version (has type:`panel` on darwin branch)
    const m9Orig = 'return{frame:!1,transparent:a,hasShadow:t,resizable:r,minimizable:!1,maximizable:!1,fullscreenable:!1,skipTaskbar:!0,...e?{alwaysOnTop:!0}:{},...n===`win32`?{accentColor:!1,roundedCorners:!1,thickFrame:i}:{},...n===`darwin`?{type:`panel`}:{}}';
    const m9Repl = 'return{frame:process.platform===`linux`?!0:!1,transparent:a,hasShadow:t,resizable:r,minimizable:!1,maximizable:!1,fullscreenable:process.platform===`linux`?!0:!1,skipTaskbar:process.platform===`linux`?!1:!0,...e?{alwaysOnTop:!0}:{},...n===`win32`?{accentColor:!1,roundedCorners:!1,thickFrame:i}:{},...n===`darwin`?{type:`panel`}:{}}';
    if (content.includes(m9Orig)) {
      content = content.replace(m9Orig, m9Repl);
      modified = true;
      console.log(`   [fix1] ${relPath(filePath)}: M9() → framed windows on Linux`);
    } else {
      // Try already-patched-by-patch-linux-focus version (no type:panel, conditional minimizable)
      const m9Pf1 = 'return{frame:!1,transparent:a,hasShadow:t,resizable:r,minimizable:process.platform===`darwin`?!1:!0,maximizable:process.platform===`darwin`?!1:!0,fullscreenable:!1,skipTaskbar:!0,...e?{alwaysOnTop:!0}:{},...n===`win32`?{accentColor:!1,roundedCorners:!1,thickFrame:i}:{},...n===`darwin`?{}:{}}';
      const m9R1 = 'return{frame:process.platform===`linux`?!0:!1,transparent:a,hasShadow:t,resizable:r,minimizable:process.platform===`darwin`?!1:!0,maximizable:process.platform===`darwin`?!1:!0,fullscreenable:process.platform===`linux`?!0:!1,skipTaskbar:process.platform===`linux`?!1:!0,...e?{alwaysOnTop:!0}:{},...n===`win32`?{accentColor:!1,roundedCorners:!1,thickFrame:i}:{},...n===`darwin`?{}:{}}';
      if (content.includes(m9Pf1)) {
        content = content.replace(m9Pf1, m9R1);
        modified = true;
        console.log(`   [fix1b] ${relPath(filePath)}: M9() → framed (post-patch-linux-focus compat)`);
      } else {
        console.log(`   [!] ${relPath(filePath)}: M9() neither pattern matched`);
      }
    }
  }

  // ── Fix 2: N9() primary — split win32||linux ──
  if (isLinuxBuild) {
    const primaryJoint = 'n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:m9(r)}:{titleBarStyle:`default`}';
    if (content.includes(primaryJoint)) {
      content = content.replace(
        primaryJoint,
        'n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:m9(r)}:n===`linux`?{titleBarStyle:`default`}:{titleBarStyle:`default`}'
      );
      modified = true;
      console.log(`   [fix2] ${relPath(filePath)}: N9() primary → Linux titleBarStyle:default`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: N9() primary joint branch not found`);
    }
  }

  // ── Fix 3: Overlay windows — re-add frame:!1 on Linux ──
  if (isLinuxBuild) {
    // globalDictation
    const gdEnd = '...n===`darwin`?{acceptFirstMouse:!0}:{}};';
    if (content.includes(gdEnd)) {
      content = content.replace(gdEnd, '...n===`darwin`?{acceptFirstMouse:!0}:{},...n===`linux`?{frame:!1,skipTaskbar:!0}:{}};');
      modified = true;
      console.log(`   [fix3a] ${relPath(filePath)}: globalDictation → re-add frame:!1 on Linux`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: globalDictation end not found`);
    }

    // avatarOverlay
    const aoEnd = '...n===`darwin`?{enableLargerThanScreen:!0}:{},hasShadow:!1};';
    if (content.includes(aoEnd)) {
      content = content.replace(aoEnd, '...n===`darwin`?{enableLargerThanScreen:!0}:{},...n===`linux`?{frame:!1,skipTaskbar:!0}:{},hasShadow:!1};');
      modified = true;
      console.log(`   [fix3b] ${relPath(filePath)}: avatarOverlay → re-add frame:!1 on Linux`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: avatarOverlay end not found`);
    }
  }

  // ── Fix 4: hud window — remove alwaysOnTop on Linux ──
  if (isLinuxBuild) {
    const hudLinux = '{titleBarStyle:`default`,minimizable:!1,maximizable:!1,fullscreenable:!1,alwaysOnTop:!0}}}';
    if (content.includes(hudLinux)) {
      content = content.replace(hudLinux, '{titleBarStyle:`default`,minimizable:!1,maximizable:!1,fullscreenable:!1}}}');
      modified = true;
      console.log(`   [fix4] ${relPath(filePath)}: hud → removed alwaysOnTop on Linux`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: hud Linux branch not found`);
    }
  }

  // ── Fix 5: setWindowZoom — remove Linux from overlay call ──
  if (isLinuxBuild) {
    const zoomStr = 'process.platform===`win32`||process.platform===`linux`)&&(this.windowZooms.set(n.id,t),n.setTitleBarOverlay(m9(t))))';
    if (content.includes(zoomStr)) {
      content = content.replace(zoomStr, 'process.platform===`win32`)&&(this.windowZooms.set(n.id,t),n.setTitleBarOverlay(m9(t))))');
      modified = true;
      console.log(`   [fix5] ${relPath(filePath)}: setWindowZoom → only call overlay on win32`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: setWindowZoom not found`);
    }
  }

  // ── Fix 6: installApplicationMenuTitleBarOverlaySync — skip on Linux ──
  if (isLinuxBuild) {
    const guardStr = 'process.platform!==`win32`&&process.platform!==`linux`||t!==`primary`';
    if (content.includes(guardStr)) {
      content = content.replace(guardStr, 'process.platform!==`win32`||t!==`primary`');
      modified = true;
      console.log(`   [fix6] ${relPath(filePath)}: installApplicationMenuTitleBarOverlaySync → skip on Linux`);
    } else {
      console.log(`   [!] ${relPath(filePath)}: installApplicationMenuTitleBarOverlaySync guard not found`);
    }
  }

  // ── Fix 7: type:"panel" removal from macOS ──
  const panelPattern = 'n===`darwin`?{type:`panel`}:{}';
  if (content.includes(panelPattern)) {
    content = content.replace(panelPattern, 'n===`darwin`?{}:{}');
    modified = true;
    console.log(`   [fix7] ${relPath(filePath)}: removed type:"panel" for macOS`);
  } else {
    console.log(`   [??] ${relPath(filePath)}: type:"panel" not found`);
  }

  if (!modified) {
    console.log(`   [!!] ${relPath(filePath)}: nothing to patch`);
    return false;
  }

  fs.writeFileSync(filePath, content + "\n/* patch-linux-controls */", "utf-8");
  console.log(`   [ok] ${relPath(filePath)}: patched`);
  return true;
}

// ─── Fix CSS: Input focus ──────────────────────────────────────

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
input, textarea, select, [contenteditable=true], [contenteditable="true"],
[role="textbox"], [role="searchbox"], [contenteditable="plaintext-only"] {
  -webkit-app-region: no-drag !important;
}
#root, .app-shell, [class*="app-shell"] {
  -webkit-app-region: no-drag;
}
</style>`;

  const insertPos = content.lastIndexOf("</head>");
  if (insertPos === -1) return false;

  content = content.slice(0, insertPos) + focusCss + content.slice(insertPos);
  fs.writeFileSync(htmlPath, content, "utf-8");
  console.log("   [css] " + relPath(htmlPath) + ": injected input focus CSS");
  return true;
}

// ─── Main ──────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rawPlatform = args.find((a) => ["mac-arm64", "mac-x64", "win", "unix"].includes(a));
  const targetPlatform = rawPlatform === "unix" ? "mac-x64" : rawPlatform;
  const platforms = targetPlatform ? [targetPlatform] : ["mac-arm64", "mac-x64"];

  console.log("\n== patch-linux-controls ==");
  let mainPatched = 0, htmlPatched = 0;

  for (const plat of platforms) {
    const buildDir = path.join(SRC_DIR, plat, "_asar", ".vite", "build");
    if (!fs.existsSync(buildDir)) continue;
    const files = fs.readdirSync(buildDir).filter((f) => TARGET_PATTERN.test(f));
    if (files.length === 0) continue;

    const isLinuxBuild = rawPlatform === "unix";

    for (const file of files) {
      if (patchMainBundle(path.join(buildDir, file), isLinuxBuild)) mainPatched++;
    }

    const asarDir = path.join(SRC_DIR, plat, "_asar");
    if (isLinuxBuild && patchIndexHtml(asarDir)) htmlPatched++;
  }

  console.log(`   [done] main bundle: ${mainPatched}x, index.html: ${htmlPatched}x`);
}

main();
