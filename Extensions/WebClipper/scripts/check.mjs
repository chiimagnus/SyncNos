import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`[check] ${message}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
}

const root = new URL("..", import.meta.url).pathname;

const manifestPath = join(root, "manifest.json");
if (!existsSync(manifestPath)) fail("manifest.json missing");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch (e) {
  fail(`manifest.json parse error: ${e?.message || e}`);
}

if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!manifest.background?.service_worker) fail("background.service_worker missing");
if (!manifest.action?.default_popup) fail("action.default_popup missing");
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) fail("content_scripts missing");
if (!manifest.icons?.["16"] || !manifest.icons?.["48"] || !manifest.icons?.["128"]) fail("icons 16/48/128 missing");

for (const size of [16, 48, 128]) {
  const p = join(root, manifest.icons[String(size)]);
  if (!existsSync(p)) fail(`icon missing: ${manifest.icons[String(size)]}`);
}

// Syntax check all js sources (fast, no bundling required).
const jsFiles = [
  "src/bootstrap/background.js",
  "src/bootstrap/content.js",
  "src/collectors/collector-contract.js",
  "src/collectors/registry.js",
  "src/collectors/runtime-observer.js",
  "src/storage/incremental-updater.js",
  "src/storage/schema.js",
  "src/shared/normalize.js",
  "src/collectors/chatgpt-collector.js",
  "src/collectors/notionai-collector.js",
  "src/sync/notion/oauth-config.js",
  "src/sync/notion/oauth-client.js",
  "src/sync/notion/token-store.js",
  "src/sync/notion/notion-api.js",
  "src/sync/notion/notion-db-manager.js",
  "src/sync/notion/notion-sync-service.js",
  "src/ui/popup/popup.js"
];

for (const f of jsFiles) {
  const p = join(root, f);
  if (!existsSync(p)) fail(`missing: ${f}`);
  run("node", ["-c", p], root);
}

// eslint-disable-next-line no-console
console.log("[check] ok");
