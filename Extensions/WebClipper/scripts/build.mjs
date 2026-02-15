import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Create a loadable extension directly in dist/ (flat layout).
const out = dist;

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

// Copy only minimal runtime assets into dist root.
cpSync(join(root, "icons/icon-16.png"), join(out, "icon-16.png"));
cpSync(join(root, "icons/icon-48.png"), join(out, "icon-48.png"));
cpSync(join(root, "icons/icon-128.png"), join(out, "icon-128.png"));
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
  files: [
    "src/shared/normalize.js",
    "src/shared/runtime-client.js",
    "src/storage/incremental-updater.js",
    "src/collectors/collector-contract.js",
    "src/collectors/registry.js",
    "src/collectors/runtime-observer.js",
    "src/collectors/collector-utils.js",
    "src/collectors/chatgpt-collector.js",
    "src/collectors/claude-collector.js",
    "src/collectors/gemini-collector.js",
    "src/collectors/deepseek-collector.js",
    "src/collectors/kimi-collector.js",
    "src/collectors/doubao-collector.js",
    "src/collectors/yuanbao-collector.js",
    "src/collectors/notionai-collector.js",
    "src/bootstrap/content.js"
  ]
});
await minifyJsFile(contentBundle);

// Bundle background SW (including previously importScripts-loaded modules).
const backgroundBundle = join(out, "background.js");
const backgroundText = stripBackgroundImportScripts(readText(join(root, "src/bootstrap/background.js")));
concatParts({
  outFile: backgroundBundle,
  parts: [
    readText(join(root, "src/storage/schema.js")),
    readText(join(root, "src/sync/notion/oauth-config.js")),
    readText(join(root, "src/sync/notion/token-store.js")),
    readText(join(root, "src/sync/notion/notion-api.js")),
    readText(join(root, "src/sync/notion/notion-ai.js")),
    readText(join(root, "src/sync/notion/notion-db-manager.js")),
    readText(join(root, "src/sync/notion/notion-sync-service.js")),
    backgroundText
  ]
});
await minifyJsFile(backgroundBundle);

// Bundle popup JS (export utils + notion api + popup logic).
const popupBundle = join(out, "popup.js");
concatFiles({
  outFile: popupBundle,
  files: [
    "src/shared/runtime-client.js",
    "src/export/article-markdown.js",
    "src/export/zip-utils.js",
    "src/vendor/markdown-it.min.js",
    "src/sync/notion/oauth-config.js",
    "src/sync/notion/notion-api.js",
    "src/ui/popup/popup-core.js",
    "src/ui/popup/popup-tabs.js",
    "src/ui/popup/popup-list.js",
    "src/ui/popup/popup-chat-preview.js",
    "src/ui/popup/popup-export.js",
    "src/ui/popup/popup-delete.js",
    "src/ui/popup/popup-notion.js",
    "src/ui/popup/popup-about.js",
    "src/ui/popup/popup.js"
  ]
});
await minifyJsFile(popupBundle);

// Rewrite popup.html to load the bundled script only.
const popupHtmlSrc = readText(join(root, "src/ui/popup/popup.html"));
const popupHtml = popupHtmlSrc
  .replace(/<title>SyncNos<\/title>\s*(?:<link\s+rel="stylesheet"[^>]*>\s*)+/g, '<title>SyncNos</title>\n    <link rel="stylesheet" href="./popup.css" />\n')
  .replace(/<script\s+src="\.\.\/\.\.\/shared\/runtime-client\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\.\/\.\.\/export\/article-markdown\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\.\/\.\.\/export\/zip-utils\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\.\/\.\.\/vendor\/markdown-it\.min\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\.\/\.\.\/sync\/notion\/oauth-config\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\.\/\.\.\/sync\/notion\/notion-api\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-core\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-tabs\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-list\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-chat-preview\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-export\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-delete\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-notion\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup-about\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup\.js"><\/script>\s*/g, '<script src="./popup.js"></script>\n');
writeText(join(out, "popup.html"), popupHtml);

// Rewrite manifest.json for bundled entrypoints.
const manifest = JSON.parse(readText(join(root, "manifest.json")));
manifest.background = { service_worker: "background.js" };
manifest.action = { ...(manifest.action || {}), default_popup: "popup.html" };
if (Array.isArray(manifest.content_scripts) && manifest.content_scripts[0]) {
  manifest.content_scripts[0] = {
    ...manifest.content_scripts[0],
    css: ["inpage.css"],
    js: ["content.js"]
  };
}
if (Array.isArray(manifest.web_accessible_resources)) {
  manifest.web_accessible_resources = manifest.web_accessible_resources.map((item) => ({
    ...item,
    resources: (item.resources || []).map((resource) => resource === "icons/icon-128.png" ? "icon-128.png" : resource)
  }));
}
if (manifest.icons && typeof manifest.icons === "object") {
  manifest.icons = {
    ...manifest.icons,
    "16": "icon-16.png",
    "48": "icon-48.png",
    "128": "icon-128.png"
  };
}
writeText(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Optional zip (uses system zip if available).
const zipPath = join(dist, "webclipper.zip");
if (existsSync("/usr/bin/zip") || spawnSync("which", ["zip"]).status === 0) {
  rmSync(zipPath, { force: true });
  run("zip", ["-r", zipPath, "."], out);
}

// eslint-disable-next-line no-console
console.log(`[build] dist: ${out}`);
