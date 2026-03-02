import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { root: null, manifest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
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

const cli = parseArgs(process.argv.slice(2));
const root = cli.root
  ? join(new URL("..", import.meta.url).pathname, cli.root)
  : join(new URL("..", import.meta.url).pathname, ".output", "chrome-mv3");

const manifestPath = cli.manifest ? join(root, cli.manifest) : join(root, "manifest.json");
if (!existsSync(manifestPath)) {
  fail(`manifest.json missing: ${manifestPath} (run \`npm --prefix Extensions/WebClipper run build\` first)`);
}

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

// eslint-disable-next-line no-console
console.log("[check] ok");

