import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  // Syntax check all js sources (fast, no bundling required).
  const jsFiles = [
    "src/bootstrap/background.js",
    "src/bootstrap/content.js",
    "src/collectors/collector-contract.js",
    "src/collectors/registry.js",
    "src/collectors/runtime-observer.js",
    "src/collectors/collector-utils.js",
    "src/storage/incremental-updater.js",
    "src/storage/schema.js",
    "src/shared/normalize.js",
    "src/collectors/chatgpt-collector.js",
    "src/collectors/claude-collector.js",
    "src/collectors/gemini-collector.js",
    "src/collectors/deepseek-collector.js",
    "src/collectors/kimi-collector.js",
    "src/collectors/doubao-collector.js",
    "src/collectors/yuanbao-collector.js",
    "src/collectors/notionai-collector.js",
    "src/sync/notion/oauth-config.js",
    "src/sync/notion/token-store.js",
    "src/sync/notion/notion-api.js",
    "src/sync/notion/notion-ai.js",
    "src/sync/notion/notion-db-manager.js",
    "src/sync/notion/notion-sync-service.js",
    "src/export/article-markdown.js",
    "src/export/zip-utils.js",
    "src/vendor/markdown-it.js",
    "src/ui/popup/popup-core.js",
    "src/ui/popup/popup-tabs.js",
    "src/ui/popup/popup-list.js",
    "src/ui/popup/popup-chat-preview.js",
    "src/ui/popup/popup-export.js",
    "src/ui/popup/popup-delete.js",
    "src/ui/popup/popup-notion.js",
    "src/ui/popup/popup-about.js",
    "src/ui/popup/popup.js"
  ];

  for (const f of jsFiles) {
    const p = join(root, f);
    if (!existsSync(p)) fail(`missing: ${f}`);
    run("node", ["-c", p], root);
  }
}

// eslint-disable-next-line no-console
console.log("[check] ok");
