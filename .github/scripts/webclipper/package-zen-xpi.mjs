import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepoRoot, resolveWebclipperRoot, run } from './script-utils.mjs';

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function writeJson(p, obj) {
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf-8');
}

function applyZenManifestPatches(manifest) {
  const next = { ...(manifest || {}) };

  const existingBss =
    next.browser_specific_settings && typeof next.browser_specific_settings === 'object'
      ? next.browser_specific_settings
      : {};
  const existingGecko = existingBss.gecko && typeof existingBss.gecko === 'object' ? existingBss.gecko : {};
  const resolvedGeckoId =
    process.env.FIREFOX_EXTENSION_ID && String(process.env.FIREFOX_EXTENSION_ID).trim()
      ? String(process.env.FIREFOX_EXTENSION_ID).trim()
      : existingGecko.id || 'syncnos-webclipper@syncnos.app';

  next.browser_specific_settings = {
    ...existingBss,
    gecko: {
      ...existingGecko,
      id: resolvedGeckoId,
    },
  };

  return next;
}

const repoRoot = resolveRepoRoot(import.meta.url);
const webclipperRoot = resolveWebclipperRoot(repoRoot);

const outDir = join(webclipperRoot, '.output');
const wxtOut = join(outDir, 'firefox-mv3');
if (!existsSync(wxtOut)) {
  throw new Error(`[build] wxt output missing: ${wxtOut}`);
}

const manifestPath = join(wxtOut, 'manifest.json');
if (!existsSync(manifestPath)) {
  throw new Error(`[build] manifest missing: ${manifestPath}`);
}

const manifest = readJson(manifestPath);
const version = String(manifest?.version || '').trim();
if (!version) {
  throw new Error(`[build] failed to read manifest version from: ${manifestPath}`);
}

const xpiPath = join(outDir, `webclipper-${version}-zen.xpi`);

// Clean up zip artifacts created by `wxt zip` (older build:zen behavior).
rmSync(join(outDir, `webclipper-${version}-firefox.zip`), { force: true });
rmSync(join(outDir, `webclipper-${version}-sources.zip`), { force: true });

rmSync(xpiPath, { force: true });

const tmpDir = join(outDir, '.zen-xpi-tmp');
rmSync(tmpDir, { recursive: true, force: true });

try {
  mkdirSync(tmpDir, { recursive: true });
  cpSync(wxtOut, tmpDir, { recursive: true });

  const tmpManifestPath = join(tmpDir, 'manifest.json');
  const tmpManifest = readJson(tmpManifestPath);
  writeJson(tmpManifestPath, applyZenManifestPatches(tmpManifest));

  run('node', ['.github/scripts/webclipper/check-dist.mjs', '--root=.output/.zen-xpi-tmp'], webclipperRoot);
  run('zip', ['-r', '-q', '-Z', 'deflate', '-9', xpiPath, '.'], tmpDir);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[build] packaged: ${xpiPath}`);
