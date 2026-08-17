import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepoRoot, resolveWebclipperRoot } from './script-utils.mjs';

function extractManifestMsgKey(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^__MSG_(.+)__$/);
  return m?.[1] ?? null;
}

function stringLen(value) {
  return Array.from(String(value ?? '')).length;
}

function parseArgs(argv) {
  const args = { root: null, manifest: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--root') {
      args.root = argv[i + 1] || args.root;
      i += 1;
      continue;
    }
    if (raw.startsWith('--root=')) {
      args.root = raw.slice('--root='.length) || args.root;
      continue;
    }
    if (raw === '--manifest') {
      args.manifest = argv[i + 1] || args.manifest;
      i += 1;
      continue;
    }
    if (raw.startsWith('--manifest=')) {
      args.manifest = raw.slice('--manifest='.length) || args.manifest;
      continue;
    }
    if (raw === '--target') {
      args.target = argv[i + 1] || args.target;
      i += 1;
      continue;
    }
    if (raw.startsWith('--target=')) {
      args.target = raw.slice('--target='.length) || args.target;
      continue;
    }
  }
  return args;
}

function fail(message) {
  console.error(`[check] ${message}`);
  process.exit(1);
}

const cli = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(import.meta.url);
const webclipperRoot = resolveWebclipperRoot(repoRoot);
const root = cli.root ? join(repoRoot, cli.root) : join(webclipperRoot, '.output', 'chrome-mv3');

const manifestPath = cli.manifest ? join(root, cli.manifest) : join(root, 'manifest.json');
const contract = JSON.parse(
  readFileSync(join(webclipperRoot, 'src', 'services', 'local-data', 'native-host-contract.json'), 'utf8'),
);
if (!existsSync(manifestPath)) {
  fail(`manifest.json missing: ${manifestPath} (run \`npm run build\` first)`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (e) {
  fail(`manifest.json parse error: ${e?.message || e}`);
}

const inferredTarget = String(root).includes('safari-mv3')
  ? 'safari'
  : String(root).includes('firefox')
    ? 'firefox'
    : String(root).includes('edge')
      ? 'edge'
      : 'chrome';
const target = cli.target || inferredTarget;
if (!['chrome', 'edge', 'firefox', 'safari'].includes(target)) fail(`unknown target: ${target}`);
const isSafariBuild = target === 'safari';
const hasNativeMessaging = Array.isArray(manifest.permissions) && manifest.permissions.includes('nativeMessaging');

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.key !== undefined) fail('release manifest must not contain a Chromium key');
if (
  !manifest.background?.service_worker &&
  !(Array.isArray(manifest.background?.scripts) && manifest.background.scripts.length > 0)
) {
  fail('background.service_worker or background.scripts missing');
}
if (!manifest.action?.default_popup) fail('action.default_popup missing');
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) fail('content_scripts missing');
if (!manifest.icons?.['16'] || !manifest.icons?.['48'] || !manifest.icons?.['128']) fail('icons 16/48/128 missing');
if (isSafariBuild ? hasNativeMessaging : !hasNativeMessaging) {
  fail(isSafariBuild ? 'Safari manifest must not request nativeMessaging' : 'nativeMessaging permission missing');
}
if (target === 'firefox') {
  const gecko = manifest.browser_specific_settings?.gecko;
  if (
    gecko?.id !== contract?.browsers?.firefox?.geckoId ||
    gecko?.strict_min_version !== contract?.browsers?.firefox?.strictMinVersion
  ) {
    fail('Firefox manifest identity does not match the native host contract');
  }
} else if (manifest.browser_specific_settings?.gecko !== undefined) {
  fail('non-Firefox release manifest must not contain Gecko identity');
}

for (const size of [16, 48, 128]) {
  const p = join(root, manifest.icons[String(size)]);
  if (!existsSync(p)) fail(`icon missing: ${manifest.icons[String(size)]}`);
}

if (isSafariBuild) {
  const localesRoot = join(root, '_locales');
  const nameKey = extractManifestMsgKey(manifest.name);
  const descriptionKey = extractManifestMsgKey(manifest.description);

  if (!existsSync(localesRoot)) fail('_locales missing (Safari build expects localized name/description)');
  if (!nameKey) fail('manifest.name must be localized for Safari builds');
  if (!descriptionKey) fail('manifest.description must be localized for Safari builds');

  const locales = readdirSync(localesRoot).filter((d) => !d.startsWith('.'));
  for (const locale of locales) {
    const messagesPath = join(localesRoot, locale, 'messages.json');
    if (!existsSync(messagesPath)) fail(`messages.json missing: ${messagesPath}`);
    let messages;
    try {
      messages = JSON.parse(readFileSync(messagesPath, 'utf-8'));
    } catch (e) {
      fail(`messages.json parse error: ${messagesPath}: ${e?.message || e}`);
    }

    const name = messages?.[nameKey]?.message;
    const desc = messages?.[descriptionKey]?.message;
    if (typeof name !== 'string') fail(`Missing __MSG_${nameKey}__ in ${messagesPath}`);
    if (typeof desc !== 'string') fail(`Missing __MSG_${descriptionKey}__ in ${messagesPath}`);
    if (stringLen(name) > 40) fail(`__MSG_${nameKey}__ exceeds 40 chars in ${messagesPath}`);
    if (stringLen(desc) > 112) fail(`__MSG_${descriptionKey}__ exceeds 112 chars in ${messagesPath}`);
  }
}

console.log('[check] ok');
