import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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

function toPosixPath(p) {
  return String(p || "").split("\\").join("/");
}

function listJsFilesRecursively(startDir, rootDir) {
  if (!existsSync(startDir)) return [];

  const out = [];
  const stack = [startDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".js")) continue;
      out.push(toPosixPath(relative(rootDir, abs)));
    }
  }
  return out.sort();
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

function collectContentScriptJs(manifest) {
  const contentScripts = Array.isArray(manifest?.content_scripts) ? manifest.content_scripts : [];
  const out = [];
  for (const cs of contentScripts) {
    const js = Array.isArray(cs?.js) ? cs.js : [];
    for (const p of js) out.push(p);
  }
  return uniqStrings(out);
}

function collectBackgroundEntryJs(manifest) {
  const out = [];
  const sw = manifest?.background?.service_worker;
  if (typeof sw === "string" && sw.trim()) out.push(sw.trim());
  const scripts = Array.isArray(manifest?.background?.scripts) ? manifest.background.scripts : [];
  for (const s of scripts) out.push(s);
  return uniqStrings(out);
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
  const contentScriptJs = collectContentScriptJs(manifest);
  const backgroundEntryJs = collectBackgroundEntryJs(manifest);

  const popupScriptJs = (() => {
    const popupRelPath = (manifest.action && typeof manifest.action.default_popup === "string")
      ? manifest.action.default_popup
      : "src/ui/popup/popup.html";
    const popupHtmlPath = join(root, popupRelPath);
    if (!existsSync(popupHtmlPath)) return [];
    const html = readFileSync(popupHtmlPath, "utf-8");
    const popupDir = dirname(popupHtmlPath);
    const srcs = extractPopupScriptSrcs(html);
    return srcs.map((src) => toPosixPath(relative(root, join(popupDir, src))));
  })();

  const backgroundDeps = (() => {
    const out = [];
    for (const relFile of backgroundEntryJs) {
      const bgPath = join(root, relFile);
      if (!existsSync(bgPath)) continue;
      const txt = readFileSync(bgPath, "utf-8");
      const bgDir = dirname(bgPath);
      const deps = extractImportScriptsPaths(txt);
      for (const p of deps) {
        out.push(toPosixPath(relative(root, join(bgDir, p))));
      }
    }
    return uniqStrings(out);
  })();

  // Syntax check all js sources (fast, no bundling required).
  const jsFiles = uniqStrings(backgroundEntryJs
    .concat(backgroundDeps)
    .concat(contentScriptJs)
    .concat(popupScriptJs));

  for (const f of jsFiles) {
    const p = join(root, f);
    if (!existsSync(p)) fail(`missing: ${f}`);
    run("node", ["-c", p], root);
  }

  const sourceJsFiles = listJsFilesRecursively(join(root, "src"), root)
    .filter((f) => !f.endsWith(".test.js") && !f.endsWith(".spec.js"));
  const referenced = new Set(jsFiles);
  const unreferenced = sourceJsFiles.filter((f) => !referenced.has(f));
  if (unreferenced.length > 0) {
    fail([
      "unreferenced source js files:",
      ...unreferenced.map((f) => `- ${f}`),
      "add them to manifest.content_scripts[].js, popup.html <script src>, or background importScripts()."
    ].join("\n"));
  }
}

// eslint-disable-next-line no-console
console.log("[check] ok");
