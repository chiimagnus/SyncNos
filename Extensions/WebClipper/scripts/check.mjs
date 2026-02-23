import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

function parseArgs(argv) {
  const args = { root: null, manifest: null, syntax: true };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--no-syntax") {
      args.syntax = false;
      continue;
    }
    if (raw === "--root") {
      args.root = argv[i + 1] || args.root;
      i += 1;
      continue;
    }
    if (raw.startsWith("--root=")) {
      args.root = raw.slice("--root=".length) || args.root;
      continue;
    }
    if (raw === "--manifest") {
      args.manifest = argv[i + 1] || args.manifest;
      i += 1;
      continue;
    }
    if (raw.startsWith("--manifest=")) {
      args.manifest = raw.slice("--manifest=".length) || args.manifest;
      continue;
    }
  }
  return args;
}

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`[check] ${message}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const raw of arr || []) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
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

const cli = parseArgs(process.argv.slice(2));
const root = cli.root ? join(new URL("..", import.meta.url).pathname, cli.root) : new URL("..", import.meta.url).pathname;

const manifestPath = cli.manifest ? join(root, cli.manifest) : join(root, "manifest.json");
if (!existsSync(manifestPath)) fail("manifest.json missing");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch (e) {
  fail(`manifest.json parse error: ${e?.message || e}`);
}

if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!manifest.background?.service_worker && !(Array.isArray(manifest.background?.scripts) && manifest.background.scripts.length > 0)) {
  fail("background.service_worker or background.scripts missing");
}
if (!manifest.action?.default_popup) fail("action.default_popup missing");
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) fail("content_scripts missing");
if (!manifest.icons?.["16"] || !manifest.icons?.["48"] || !manifest.icons?.["128"]) fail("icons 16/48/128 missing");

for (const size of [16, 48, 128]) {
  const p = join(root, manifest.icons[String(size)]);
  if (!existsSync(p)) fail(`icon missing: ${manifest.icons[String(size)]}`);
}

if (cli.syntax) {
  const contentScriptJs = (() => {
    const cs = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    const first = cs[0] || null;
    const js = first && Array.isArray(first.js) ? first.js : [];
    return js.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim());
  })();

  const popupScriptJs = (() => {
    const popupHtmlPath = join(root, "src", "ui", "popup", "popup.html");
    if (!existsSync(popupHtmlPath)) return [];
    const html = readFileSync(popupHtmlPath, "utf-8");
    const popupDir = join(root, "src", "ui", "popup");
    const srcs = extractPopupScriptSrcs(html);
    return srcs.map((src) => relative(root, join(popupDir, src)));
  })();

  const backgroundDeps = (() => {
    const bgPath = join(root, "src", "bootstrap", "background.js");
    if (!existsSync(bgPath)) return [];
    const txt = readFileSync(bgPath, "utf-8");
    const bootstrapDir = join(root, "src", "bootstrap");
    const deps = extractImportScriptsPaths(txt);
    return deps.map((p) => relative(root, join(bootstrapDir, p)));
  })();

  // Syntax check all js sources (fast, no bundling required).
  const jsFiles = uniqStrings(["src/bootstrap/background.js", "src/bootstrap/content.js"]
    .concat(backgroundDeps)
    .concat(contentScriptJs)
    .concat(popupScriptJs));

  for (const f of jsFiles) {
    const p = join(root, f);
    if (!existsSync(p)) fail(`missing: ${f}`);
    run("node", ["-c", p], root);
  }
}

// eslint-disable-next-line no-console
console.log("[check] ok");
