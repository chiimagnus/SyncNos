import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function readText(p) {
  return readFileSync(p, "utf-8");
}

function writeText(p, text) {
  writeFileSync(p, text, "utf-8");
}

function applyTargetManifestPatches(manifest, { target, geckoId, geckoMinVersion }) {
  if (target !== "firefox") return manifest;

  const next = { ...manifest };
  const nextBackground = { ...(next.background || {}) };

  // AMO validator: provide a "background.scripts" fallback so the add-on can still run
  // as a classic background script in channels without MV3 service worker support.
  if (!Array.isArray(nextBackground.scripts) || nextBackground.scripts.length === 0) {
    nextBackground.scripts = [nextBackground.service_worker || "background.js"];
  }
  // Keep Firefox manifest clean for AMO: MV3 service_worker is ignored on Firefox.
  delete nextBackground.service_worker;
  next.background = nextBackground;

  // Firefox requires a stable extension id for many workflows (AMO signing, persistent storage, etc.).
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const webclipperRoot = join(repoRoot, "Extensions", "WebClipper");
if (!existsSync(join(webclipperRoot, "package.json"))) {
  throw new Error(`webclipper root not found: ${webclipperRoot}`);
}

const cli = parseArgs(process.argv.slice(2));
const target = String(cli.target || "chrome");
const distDirName = cli.outDir
  || (target === "firefox"
    ? "dist-firefox"
    : (target === "edge" ? "dist-edge" : "dist"));
const dist = join(webclipperRoot, distDirName);

const wxtScript = target === "firefox" ? "build:firefox" : "build";
run("npm", ["run", wxtScript], webclipperRoot);

const wxtOut = join(webclipperRoot, ".output", target === "firefox" ? "firefox-mv3" : "chrome-mv3");
if (!existsSync(wxtOut)) throw new Error(`wxt output missing: ${wxtOut}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(wxtOut, dist, { recursive: true });

const manifestPath = join(dist, "manifest.json");
if (!existsSync(manifestPath)) throw new Error(`dist manifest missing: ${manifestPath}`);

let manifest = JSON.parse(readText(manifestPath));
manifest = applyTargetManifestPatches(manifest, {
  target,
  geckoId: cli.geckoId || process.env.FIREFOX_EXTENSION_ID || null,
  geckoMinVersion: cli.geckoMinVersion || process.env.FIREFOX_MIN_VERSION || null
});
writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

if (cli.zip) {
  const zipName = cli.zipName
    || (target === "firefox"
      ? "SyncNos-WebClipper-firefox.xpi"
      : (target === "edge" ? "SyncNos-WebClipper-edge.zip" : "SyncNos-WebClipper.zip"));
  const zipOut = join(webclipperRoot, zipName);
  rmSync(zipOut, { force: true });

  run("zip", ["-r", zipOut, "."], dist);
  // eslint-disable-next-line no-console
  console.log(`[build] packaged: ${zipOut}`);
}

// eslint-disable-next-line no-console
console.log(`[build] dist: ${dist}`);
