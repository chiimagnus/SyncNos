import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepoRoot, resolveWebclipperRoot } from './script-utils.mjs';

function fail() {
  console.error('[identity] mismatch');
  process.exit(1);
}

function browserArg(argv) {
  for (const raw of argv) {
    if (raw.startsWith('--browser=')) return raw.slice('--browser='.length);
    throw new Error('unsupported identity checker argument');
  }
  return '';
}

try {
  const browser = browserArg(process.argv.slice(2));
  if (browser !== 'chrome' && browser !== 'edge' && browser !== 'firefox') fail();
  const evidence = String(process.env.STORE_EXTENSION_ID || '').trim();
  if (!evidence || /[\0\r\n]/.test(evidence)) fail();

  const repoRoot = resolveRepoRoot(import.meta.url);
  const webclipperRoot = resolveWebclipperRoot(repoRoot);
  const contract = JSON.parse(
    readFileSync(join(webclipperRoot, 'src', 'services', 'local-data', 'native-host-contract.json'), 'utf8'),
  );
  const expected =
    browser === 'firefox' ? contract?.browsers?.firefox?.geckoId : contract?.browsers?.[browser]?.runtimeId;
  if (typeof expected !== 'string' || evidence !== expected) fail();
  console.log('[identity] ok');
} catch {
  fail();
}
