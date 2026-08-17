import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepoRoot, resolveWebclipperRoot, run } from './script-utils.mjs';

function parseArgs(argv) {
  const args = {
    target: 'chrome',
    outDir: null,
    fixture: false,
    zip: false,
    zipName: null,
  };
  for (const raw of argv) {
    if (raw === '--fixture') {
      args.fixture = true;
      continue;
    }
    if (raw === '--zip') {
      args.zip = true;
      continue;
    }
    if (raw.startsWith('--target=')) {
      args.target = raw.slice('--target='.length) || args.target;
      continue;
    }
    if (raw.startsWith('--out=')) {
      args.outDir = raw.slice('--out='.length) || args.outDir;
      continue;
    }
    if (raw.startsWith('--zip-name=')) {
      args.zipName = raw.slice('--zip-name='.length) || args.zipName;
      continue;
    }
    if (
      raw === '--gecko-id' ||
      raw.startsWith('--gecko-id=') ||
      raw === '--gecko-min-version' ||
      raw.startsWith('--gecko-min-version=')
    ) {
      throw new Error('Firefox identity overrides are not allowed for release artifacts');
    }
    throw new Error(`Unknown argument: ${raw}`);
  }
  return args;
}

function readText(p) {
  return readFileSync(p, 'utf-8');
}

function writeText(p, text) {
  writeFileSync(p, text, 'utf-8');
}

function readNativeHostContract(root) {
  const contractPath = join(root, 'src', 'services', 'local-data', 'native-host-contract.json');
  const contract = JSON.parse(readText(contractPath));
  const firefox = contract?.browsers?.firefox;
  if (
    contract?.version !== 1 ||
    typeof firefox?.geckoId !== 'string' ||
    typeof firefox?.strictMinVersion !== 'string' ||
    firefox.allowedExtension !== firefox.geckoId
  ) {
    throw new Error(`invalid native host contract: ${contractPath}`);
  }
  return firefox;
}

function assertNoReleaseIdentityOverride() {
  if (String(process.env.FIREFOX_EXTENSION_ID || '').trim() || String(process.env.FIREFOX_MIN_VERSION || '').trim()) {
    throw new Error('FIREFOX_EXTENSION_ID and FIREFOX_MIN_VERSION are not allowed for release artifacts');
  }
}

function applyTargetManifestPatches(manifest, { target, firefoxContract }) {
  if (target !== 'firefox') return manifest;

  const next = { ...manifest };
  const nextBackground = { ...(next.background || {}) };

  // AMO validator: provide a "background.scripts" fallback so the add-on can still run
  // as a classic background script in channels without MV3 service worker support.
  if (!Array.isArray(nextBackground.scripts) || nextBackground.scripts.length === 0) {
    nextBackground.scripts = [nextBackground.service_worker || 'background.js'];
  }
  // Keep Firefox manifest clean for AMO: MV3 service_worker is ignored on Firefox.
  delete nextBackground.service_worker;
  next.background = nextBackground;

  const existingBss =
    next.browser_specific_settings && typeof next.browser_specific_settings === 'object'
      ? next.browser_specific_settings
      : {};
  const existingGecko = existingBss.gecko && typeof existingBss.gecko === 'object' ? existingBss.gecko : {};
  if (
    existingGecko.id !== firefoxContract.geckoId ||
    existingGecko.strict_min_version !== firefoxContract.strictMinVersion
  ) {
    throw new Error('Firefox manifest identity must exactly match the native host contract');
  }

  next.browser_specific_settings = {
    ...existingBss,
    gecko: {
      ...existingGecko,
      id: firefoxContract.geckoId,
      strict_min_version: firefoxContract.strictMinVersion,
      // Required by AMO for new Firefox extensions.
      data_collection_permissions: existingGecko.data_collection_permissions || {
        required: ['none'],
      },
    },
  };

  return next;
}

const repoRoot = resolveRepoRoot(import.meta.url);
const webclipperRoot = resolveWebclipperRoot(repoRoot);

const cli = parseArgs(process.argv.slice(2));
const target = String(cli.target || 'chrome');
if (!['chrome', 'edge', 'firefox'].includes(target)) throw new Error(`Unknown release target: ${target}`);
if (cli.fixture && (cli.outDir || cli.zip || cli.zipName)) {
  throw new Error('--fixture cannot be combined with --out, --zip, or --zip-name');
}
if (target === 'firefox') assertNoReleaseIdentityOverride();
const firefoxContract = target === 'firefox' ? readNativeHostContract(webclipperRoot) : null;
const distDirName = cli.outDir || (target === 'firefox' ? 'dist-firefox' : target === 'edge' ? 'dist-edge' : 'dist');
const dist = cli.fixture
  ? join(webclipperRoot, '.output', 'release-contract', target)
  : join(webclipperRoot, distDirName);

const wxtScript = target === 'firefox' ? 'build:firefox' : 'build';
run('npm', ['run', wxtScript], webclipperRoot);

const wxtOut = join(webclipperRoot, '.output', target === 'firefox' ? 'firefox-mv3' : 'chrome-mv3');
if (!existsSync(wxtOut)) throw new Error(`wxt output missing: ${wxtOut}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(wxtOut, dist, { recursive: true });

const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error(`dist manifest missing: ${manifestPath}`);

let manifest = JSON.parse(readText(manifestPath));
manifest = applyTargetManifestPatches(manifest, {
  target,
  firefoxContract,
});
writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

if (cli.zip) {
  const zipName =
    cli.zipName ||
    (target === 'firefox'
      ? 'SyncNos-WebClipper-firefox.xpi'
      : target === 'edge'
        ? 'SyncNos-WebClipper-edge.zip'
        : 'SyncNos-WebClipper.zip');
  const zipOut = join(webclipperRoot, zipName);
  rmSync(zipOut, { force: true });

  run('zip', ['-r', zipOut, '.'], dist);

  console.log(`[build] packaged: ${zipOut}`);
}

console.log(`[build] dist: ${dist}`);
