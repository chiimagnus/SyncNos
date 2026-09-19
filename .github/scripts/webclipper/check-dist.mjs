import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
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
  const args = { root: null, manifest: null };
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
  }
  return args;
}

function fail(message) {
  console.error(`[check] ${message}`);
  process.exit(1);
}

function readJsonFile(path, label = 'JSON') {
  if (!existsSync(path)) fail(`${label} missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    fail(`${label} parse error: ${path}: ${e?.message || e}`);
  }
}

function readLocaleMessages(root, locale) {
  const messagesPath = join(root, '_locales', locale, 'messages.json');
  return {
    messagesPath,
    messages: readJsonFile(messagesPath, 'messages.json'),
  };
}

function listFilesRecursively(root, extension) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path.endsWith(extension)) files.push(path);
    }
  };
  walk(root);
  return files;
}

function validateJavascriptText(root) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const path of listFilesRecursively(root, '.js')) {
    const bytes = readFileSync(path);
    try {
      decoder.decode(bytes);
    } catch (error) {
      fail(`JavaScript is not valid UTF-8: ${path}: ${error?.message || error}`);
    }
    const controlIndex = bytes.findIndex((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
    if (controlIndex >= 0) {
      fail(
        `JavaScript contains raw C0 control byte 0x${bytes[controlIndex].toString(16).padStart(2, '0')} at offset ${controlIndex}: ${path}`,
      );
    }
  }
}

const cli = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(import.meta.url);
const webclipperRoot = resolveWebclipperRoot(repoRoot);
const root = cli.root ? join(repoRoot, cli.root) : join(webclipperRoot, '.output', 'chrome-mv3');

const manifestPath = cli.manifest ? join(root, cli.manifest) : join(root, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail(`manifest.json missing: ${manifestPath} (run \`npm run build\` first)`);
}

const manifest = readJsonFile(manifestPath, 'manifest.json');
validateJavascriptText(root);

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (
  !manifest.background?.service_worker &&
  !(Array.isArray(manifest.background?.scripts) && manifest.background.scripts.length > 0)
) {
  fail('background.service_worker or background.scripts missing');
}
if (!manifest.action?.default_popup) fail('action.default_popup missing');
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) fail('content_scripts missing');
if (!manifest.icons?.['16'] || !manifest.icons?.['48'] || !manifest.icons?.['128']) fail('icons 16/48/128 missing');

if (manifest.options_ui?.page !== 'app.html#/settings') fail('options_ui.page must be app.html#/settings');
if (manifest.options_ui?.open_in_tab !== true) fail('options_ui.open_in_tab must be true');
const optionsPageFile = manifest.options_ui.page.split('#', 1)[0];
if (!existsSync(join(root, optionsPageFile))) fail(`options page missing: ${optionsPageFile}`);

const expectedCommandIds = ['_execute_action', 'capture-current-page', 'open-syncnos-app'];
const commands = manifest.commands;
if (!commands || typeof commands !== 'object' || Array.isArray(commands)) fail('manifest.commands must be an object');
const actualCommandIds = Object.keys(commands).sort();
if (JSON.stringify(actualCommandIds) !== JSON.stringify([...expectedCommandIds].sort())) {
  fail(`manifest.commands must contain exactly: ${expectedCommandIds.join(', ')}`);
}

for (const commandId of expectedCommandIds) {
  const command = commands[commandId];
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    fail(`manifest.commands.${commandId} must be an object`);
  }
  if (Object.hasOwn(command, 'suggested_key')) fail(`manifest.commands.${commandId} must not declare suggested_key`);
  if (Object.hasOwn(command, 'global')) fail(`manifest.commands.${commandId} must not declare global`);
}

const customCommandIds = ['capture-current-page', 'open-syncnos-app'];
const commandDescriptionKeys = new Map();
for (const commandId of customCommandIds) {
  const descriptionKey = extractManifestMsgKey(commands[commandId]?.description);
  if (!descriptionKey) fail(`manifest.commands.${commandId}.description must use __MSG_*__ localization`);
  commandDescriptionKeys.set(commandId, descriptionKey);
}

const defaultLocale = String(manifest.default_locale || '').trim();
if (!defaultLocale) fail('manifest.default_locale missing for localized command descriptions');
const requiredCommandLocales = [defaultLocale, 'zh_CN', 'zh_TW'];
for (const locale of requiredCommandLocales) {
  const localeDir = join(root, '_locales', locale);
  if (locale !== defaultLocale && !existsSync(localeDir)) continue;
  const { messages, messagesPath } = readLocaleMessages(root, locale);
  for (const [commandId, descriptionKey] of commandDescriptionKeys) {
    const message = messages?.[descriptionKey]?.message;
    if (typeof message !== 'string' || !message.trim()) {
      fail(`Missing non-empty __MSG_${descriptionKey}__ for ${commandId} in ${messagesPath}`);
    }
  }
}

for (const size of [16, 48, 128]) {
  const p = join(root, manifest.icons[String(size)]);
  if (!existsSync(p)) fail(`icon missing: ${manifest.icons[String(size)]}`);
}

const isSafariBuild = String(root).includes('safari-mv3');
if (isSafariBuild) {
  const localesRoot = join(root, '_locales');
  const nameKey = extractManifestMsgKey(manifest.name);
  const descriptionKey = extractManifestMsgKey(manifest.description);

  if (!existsSync(localesRoot)) fail('_locales missing (Safari build expects localized name/description)');
  if (!nameKey) fail('manifest.name must be localized for Safari builds');
  if (!descriptionKey) fail('manifest.description must be localized for Safari builds');

  const locales = readdirSync(localesRoot).filter((d) => !d.startsWith('.'));
  for (const locale of locales) {
    const { messages, messagesPath } = readLocaleMessages(root, locale);

    const name = messages?.[nameKey]?.message;
    const desc = messages?.[descriptionKey]?.message;
    if (typeof name !== 'string') fail(`Missing __MSG_${nameKey}__ in ${messagesPath}`);
    if (typeof desc !== 'string') fail(`Missing __MSG_${descriptionKey}__ in ${messagesPath}`);
    if (stringLen(name) > 40) fail(`__MSG_${nameKey}__ exceeds 40 chars in ${messagesPath}`);
    if (stringLen(desc) > 112) fail(`__MSG_${descriptionKey}__ exceeds 112 chars in ${messagesPath}`);
  }
}

console.log('[check] ok');
