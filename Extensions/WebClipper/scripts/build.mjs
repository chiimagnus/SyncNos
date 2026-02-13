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

// Copy a loadable extension folder into dist/extension (manifest at root).
const out = join(dist, "extension");
mkdirSync(out, { recursive: true });

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

// Copy only the minimal runtime assets; bundle JS into a small number of files.
cpSync(join(root, "icons"), join(out, "icons"), { recursive: true });

mkdirSync(join(out, "src/ui/popup"), { recursive: true });
mkdirSync(join(out, "src/ui/inpage"), { recursive: true });
cpSync(join(root, "src/ui/popup/popup.css"), join(out, "src/ui/popup/popup.css"));
cpSync(join(root, "src/ui/inpage/inpage.css"), join(out, "src/ui/inpage/inpage.css"));

// Bundle content scripts into one file.
mkdirSync(join(out, "bundle"), { recursive: true });
const contentBundle = join(out, "bundle/content.js");
concatFiles({
  outFile: contentBundle,
  files: [
    "src/shared/normalize.js",
    "src/storage/incremental-updater.js",
    "src/collectors/collector-contract.js",
    "src/collectors/registry.js",
    "src/collectors/runtime-observer.js",
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
const backgroundBundle = join(out, "bundle/background.js");
const backgroundText = stripBackgroundImportScripts(readText(join(root, "src/bootstrap/background.js")));
concatParts({
  outFile: backgroundBundle,
  parts: [
    readText(join(root, "src/storage/schema.js")),
    readText(join(root, "src/sync/notion/oauth-config.js")),
    readText(join(root, "src/sync/notion/oauth-client.js")),
    readText(join(root, "src/sync/notion/token-store.js")),
    readText(join(root, "src/sync/notion/notion-api.js")),
    readText(join(root, "src/sync/notion/notion-db-manager.js")),
    readText(join(root, "src/sync/notion/notion-sync-service.js")),
    backgroundText
  ]
});
await minifyJsFile(backgroundBundle);

// Bundle popup JS (export utils + notion api + popup logic).
const popupBundle = join(out, "bundle/popup.js");
concatFiles({
  outFile: popupBundle,
  files: [
    "src/export/article-markdown.js",
    "src/export/zip-utils.js",
    "src/sync/notion/notion-api.js",
    "src/ui/popup/popup.js"
  ]
});
await minifyJsFile(popupBundle);

// Rewrite popup.html to load the bundled script only.
const popupHtmlSrc = readText(join(root, "src/ui/popup/popup.html"));
const popupHtml = popupHtmlSrc
  .replace(/<script\s+src="\.\.\/\.\.\/export\/article-markdown\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\.\/\.\.\/export\/zip-utils\.js"><\/script>\s*/g, "")
  .replace(/<script\s+src="\.\/popup\.js"><\/script>\s*/g, '<script src="../../../bundle/popup.js"></script>\n');
writeText(join(out, "src/ui/popup/popup.html"), popupHtml);

// Rewrite manifest.json for bundled entrypoints.
const manifest = JSON.parse(readText(join(root, "manifest.json")));
manifest.background = { service_worker: "bundle/background.js" };
manifest.action = { ...(manifest.action || {}), default_popup: "src/ui/popup/popup.html" };
if (Array.isArray(manifest.content_scripts) && manifest.content_scripts[0]) {
  manifest.content_scripts[0] = {
    ...manifest.content_scripts[0],
    css: ["src/ui/inpage/inpage.css"],
    js: ["bundle/content.js"]
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
