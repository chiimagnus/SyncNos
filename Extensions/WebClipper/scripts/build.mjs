import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function parseArgs(argv) {
  const args = {
    target: "chrome",
    outDir: null,
    zip: false,
    zipName: null,
    geckoId: null,
    geckoMinVersion: null
  };
  for (const raw of argv) {
    if (raw === "--zip") {
      args.zip = true;
      continue;
    }
    if (raw.startsWith("--target=")) {
      args.target = raw.slice("--target=".length) || args.target;
      continue;
    }
    if (raw.startsWith("--out=")) {
      args.outDir = raw.slice("--out=".length) || args.outDir;
      continue;
    }
    if (raw.startsWith("--zip-name=")) {
      args.zipName = raw.slice("--zip-name=".length) || args.zipName;
      continue;
    }
    if (raw.startsWith("--gecko-id=")) {
      args.geckoId = raw.slice("--gecko-id=".length) || args.geckoId;
      continue;
    }
    if (raw.startsWith("--gecko-min-version=")) {
      args.geckoMinVersion = raw.slice("--gecko-min-version=".length) || args.geckoMinVersion;
      continue;
    }
  }
  return args;
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

const root = new URL("..", import.meta.url).pathname;
const cli = parseArgs(process.argv.slice(2));
const target = String(cli.target || "chrome");
const distDirName = cli.outDir
  || (target === "firefox"
    ? "dist-firefox"
    : (target === "edge" ? "dist-edge" : "dist"));
const dist = join(root, distDirName);

// Fail fast before packaging: detect missing references in source files.
run("node", ["scripts/check.mjs"], root);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Create a loadable extension directly in dist/ (flat layout).
const out = dist;
const repoLicense = join(root, "..", "..", "LICENSE");

function readText(p) {
  return readFileSync(p, "utf-8");
}

function writeText(p, text) {
  writeFileSync(p, text, "utf-8");
}

function concatFiles({ outFile, files }) {
  const parts = [];
  for (const f of files) {
    const p = join(root, f);
    const text = readText(p);
    parts.push(text);
  }
  // Use explicit separators to avoid accidental ASI edge cases between IIFEs.
  writeText(outFile, `${parts.join("\n;\n")}\n`);
}

function concatCssFiles({ outFile, files }) {
  const parts = [];
  for (const f of files) {
    const p = join(root, f);
    const text = readText(p);
    parts.push(text);
  }
  writeText(outFile, `${parts.join("\n\n")}\n`);
}

function concatParts({ outFile, parts }) {
  writeText(outFile, `${parts.join("\n;\n")}\n`);
}

function stripBackgroundImportScripts(backgroundSource) {
  const marker = "// Load storage schema into this service worker.";
  const start = backgroundSource.indexOf(marker);
  if (start < 0) return backgroundSource;

  // Remove the entire try/catch block that importScripts dependencies.
  const tryIdx = backgroundSource.indexOf("try {", start);
  if (tryIdx < 0) return backgroundSource;
  const catchIdx = backgroundSource.indexOf("} catch (_e) {", tryIdx);
  if (catchIdx < 0) return backgroundSource;
  const afterCatchOpen = catchIdx + "} catch (_e) {".length;
  const catchCloseIdx = backgroundSource.indexOf("}", afterCatchOpen);
  if (catchCloseIdx < 0) return backgroundSource;
  const blockEndIdx = catchCloseIdx + 1;

  return `${backgroundSource.slice(0, tryIdx)}\n${backgroundSource.slice(blockEndIdx)}`;
}

function extractImportScriptsPaths(backgroundSource) {
  const idx = backgroundSource.indexOf("importScripts(");
  if (idx < 0) return [];
  const start = idx + "importScripts(".length;
  const end = backgroundSource.indexOf(");", start);
  if (end < 0) return [];
  const inside = backgroundSource.slice(start, end);
  const out = [];
  const re = /["']([^"']+)["']/g;
  let m = null;
  while ((m = re.exec(inside))) {
    const p = String(m[1] || "").trim();
    if (p) out.push(p);
  }
  return out;
}

function extractPopupScriptSrcs(popupHtml) {
  const out = [];
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*>\s*<\/script>/g;
  let m = null;
  while ((m = re.exec(popupHtml))) {
    const src = String(m[1] || "").trim();
    if (src) out.push(src);
  }
  return out;
}

async function minifyJsFile(file) {
  const { minify } = await import("terser");

  const input = readText(file);
  const result = await minify({ [file]: input }, {
    compress: {
      passes: 3,
      drop_debugger: true,
      drop_console: true
    },
    mangle: {
      toplevel: true
    },
    format: {
      comments: false
    }
  });

  if (!result || typeof result.code !== "string") {
    throw new Error(`terser failed for ${file}`);
  }
  writeText(file, result.code);
}

function applyTargetManifestPatches(manifest, { target, geckoId, geckoMinVersion }) {
  if (target !== "firefox") return manifest;

  const next = { ...manifest };
  const nextBackground = { ...(next.background || {}) };

  // AMO validator: Firefox doesn't guarantee MV3 service worker support in all channels.
  // Provide a "background.scripts" fallback so the add-on can still run as a classic background script.
  if (!Array.isArray(nextBackground.scripts) || nextBackground.scripts.length === 0) {
    nextBackground.scripts = [nextBackground.service_worker || "background.js"];
  }
  // Keep Firefox manifest clean for AMO: MV3 service_worker is ignored on Firefox.
  // We rely on `background.scripts` for runtime compatibility.
  delete nextBackground.service_worker;
  next.background = nextBackground;

  // Firefox requires a stable extension id for many workflows (AMO signing, persistent storage, etc.).
  // For local testing, users can still run it as a temporary add-on.
  const existingBss = (next.browser_specific_settings && typeof next.browser_specific_settings === "object")
    ? next.browser_specific_settings
    : {};
  const existingGecko = (existingBss.gecko && typeof existingBss.gecko === "object")
    ? existingBss.gecko
    : {};
  const resolvedGeckoId = (geckoId && String(geckoId).trim())
    ? String(geckoId).trim()
    : (existingGecko.id || "syncnos-webclipper@syncnos.app");
  const resolvedMinVersion = (geckoMinVersion && String(geckoMinVersion).trim())
    ? String(geckoMinVersion).trim()
    : (existingGecko.strict_min_version || "142.0");

  next.browser_specific_settings = {
    ...existingBss,
    gecko: {
      ...existingGecko,
      id: resolvedGeckoId,
      strict_min_version: resolvedMinVersion,
      // Required by AMO for new Firefox extensions.
      data_collection_permissions: existingGecko.data_collection_permissions || {
        required: ["none"]
      }
    }
  };

  return next;
}

const manifestSrc = JSON.parse(readText(join(root, "manifest.json")));
const contentScriptSourceFiles = (() => {
  // Single source of truth: `manifest.json` content_scripts js list(s).
  // This avoids "forgot to add file into build list" regressions.
  const cs = Array.isArray(manifestSrc.content_scripts) ? manifestSrc.content_scripts : [];
  const files = [];
  const seen = new Set();
  for (const entry of cs) {
    const js = entry && Array.isArray(entry.js) ? entry.js : [];
    for (const raw of js) {
      if (typeof raw !== "string") continue;
      const p = raw.trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      files.push(p);
    }
  }
  return files;
})();

const popupHtmlSrcPath = join(root, "src", "ui", "popup", "popup.html");
const popupHtmlSrc = readText(popupHtmlSrcPath);
const popupScriptFiles = (() => {
  const popupDir = join(root, "src", "ui", "popup");
  const srcs = extractPopupScriptSrcs(popupHtmlSrc);
  return srcs.map((src) => relative(root, join(popupDir, src)));
})();

const backgroundSrcPath = join(root, "src", "bootstrap", "background.js");
const backgroundSrcText = readText(backgroundSrcPath);
const backgroundBundleParts = (() => {
  const bootstrapDir = join(root, "src", "bootstrap");
  const deps = extractImportScriptsPaths(backgroundSrcText);
  const parts = deps.map((p) => readText(join(bootstrapDir, p)));
  parts.push(stripBackgroundImportScripts(backgroundSrcText));
  return parts;
})();

// Copy only minimal runtime assets into dist root.
if (existsSync(repoLicense)) {
  cpSync(repoLicense, join(out, "LICENSE"));
}
// Popup HTML references icon assets under `icons/*` (source layout).
// Keep an `icons/` folder in dist so those relative URLs keep working across browsers.
cpSync(join(root, "icons"), join(out, "icons"), { recursive: true });
if (existsSync(join(root, "vendor"))) {
  cpSync(join(root, "vendor"), join(out, "vendor"), { recursive: true });
}
for (const relPath of ["src/collectors/web/readability.js"]) {
  const srcPath = join(root, relPath);
  const outPath = join(out, relPath);
  mkdirSync(dirname(outPath), { recursive: true });
  cpSync(srcPath, outPath);
}
concatCssFiles({
  outFile: join(out, "popup.css"),
  files: ["src/ui/styles/tokens.css", "src/ui/styles/flash-ok.css", "src/ui/styles/popup.css"]
});
concatCssFiles({
  outFile: join(out, "inpage.css"),
  files: ["src/ui/styles/tokens.css", "src/ui/styles/flash-ok.css", "src/ui/styles/inpage.css"]
});

// Bundle content scripts into one file.
const contentBundle = join(out, "content.js");
concatFiles({
  outFile: contentBundle,
  files: contentScriptSourceFiles
});
// Dist layout keeps runtime entrypoints at the root, while preserving the source `icons/*` folder layout.
await minifyJsFile(contentBundle);

// Bundle background SW (including previously importScripts-loaded modules).
const backgroundBundle = join(out, "background.js");
concatParts({
  outFile: backgroundBundle,
  parts: backgroundBundleParts
});
await minifyJsFile(backgroundBundle);

// Bundle popup JS (export utils + notion api + popup logic).
const popupBundle = join(out, "popup.js");
concatFiles({
  outFile: popupBundle,
  files: popupScriptFiles
});
await minifyJsFile(popupBundle);

// Rewrite popup.html to load the bundled script only.
let popupHtml = popupHtmlSrc
  .replace(
    /<title>SyncNos<\/title>\s*(?:<link\s+rel="stylesheet"[^>]*>\s*)+/g,
    '<title>SyncNos</title>\n    <link rel="stylesheet" href="./popup.css" />\n'
  )
  .replace(/src="\.\.\/\.\.\/\.\.\/icons\//g, 'src="./icons/');

// Remove all script tags from source HTML and re-inject the bundled script only.
popupHtml = popupHtml.replace(/<script\s+[^>]*src="[^"]+"[^>]*>\s*<\/script>\s*/g, "");
popupHtml = popupHtml.replace(/<\/body>/i, '    <script src="./popup.js"></script>\n  </body>');
writeText(join(out, "popup.html"), popupHtml);

// Rewrite manifest.json for bundled entrypoints.
let manifest = { ...manifestSrc };
manifest.background = { service_worker: "background.js" };
manifest.action = { ...(manifest.action || {}), default_popup: "popup.html" };
if (Array.isArray(manifest.content_scripts) && manifest.content_scripts[0]) {
  manifest.content_scripts = manifest.content_scripts.map((entry) => ({
    ...entry,
    css: ["inpage.css"],
    js: ["content.js"]
  }));
}
if (manifest.icons && typeof manifest.icons === "object") {
  manifest.icons = {
    ...manifest.icons,
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  };
}
manifest = applyTargetManifestPatches(manifest, {
  target,
  geckoId: cli.geckoId || process.env.FIREFOX_EXTENSION_ID || null,
  geckoMinVersion: cli.geckoMinVersion || process.env.FIREFOX_MIN_VERSION || null
});
writeText(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (cli.zip) {
  const zipName = cli.zipName
    || (target === "firefox"
      ? "SyncNos-WebClipper-firefox.xpi"
      : (target === "edge" ? "SyncNos-WebClipper-edge.zip" : "SyncNos-WebClipper.zip"));
  const zipOut = join(root, zipName);
  rmSync(zipOut, { force: true });

  if (!existsSync(out)) throw new Error(`dist folder missing: ${out}`);
  // `.xpi` is simply a zip; Firefox tooling accepts a standard zip payload.
  run("zip", ["-r", zipOut, "."], out);
  // eslint-disable-next-line no-console
  console.log(`[build] packaged: ${zipOut}`);
}

// eslint-disable-next-line no-console
console.log(`[build] dist: ${out}`);
