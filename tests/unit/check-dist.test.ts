import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
const totalBudget = 5 * 1024 * 1024;
const contentBudget = 1600 * 1024;

function put(root: string, file: string, content: string | Buffer) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeDist() {
  const root = mkdtempSync(join(tmpdir(), 'syncnos-dist-check-'));
  roots.push(root);
  const manifest = {
    manifest_version: 3,
    action: { default_popup: 'popup.html' },
    background: { service_worker: 'background.js' },
    content_scripts: [{ matches: ['https://example.com/*'], js: ['content-scripts/content.js'] }],
    icons: { '16': 'icons/icon.png', '48': 'icons/icon.png', '128': 'icons/icon.png' },
    options_ui: { page: 'app.html#/settings', open_in_tab: true },
    default_locale: 'en',
    commands: {
      _execute_action: {},
      'capture-current-page': { description: '__MSG_captureDescription__' },
      'open-syncnos-app': { description: '__MSG_openDescription__' },
    },
  };
  put(root, 'manifest.json', JSON.stringify(manifest));
  put(
    root,
    '_locales/en/messages.json',
    JSON.stringify({
      captureDescription: { message: 'Capture page' },
      openDescription: { message: 'Open app' },
    }),
  );
  put(root, 'popup.html', '<script type="module" src="/popup.js"></script>');
  put(root, 'popup.js', "import('./render.js');");
  put(root, 'render.js', 'export const mounted = true;');
  put(root, 'background.js', '');
  put(root, 'content-scripts/content.js', '');
  put(root, 'app.html', '<main></main>');
  put(root, 'icons/icon.png', '');
  return root;
}

function check(root: string) {
  const result = spawnSync(
    process.execPath,
    ['.github/scripts/webclipper/check-dist.mjs', `--root=${relative(repoRoot, root)}`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function bytes(root: string): number {
  return readdirSync(root, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(root, entry.name);
    return sum + (entry.isDirectory() ? bytes(path) : statSync(path).size);
  }, 0);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('production dist size guardrails', () => {
  it('accepts WOFF2 and unrelated custom fonts without stripping assets', () => {
    const root = makeDist();
    put(root, 'assets/KaTeX_Main-Regular-hash.woff2', 'font');
    put(root, 'assets/custom.ttf', 'custom font');
    const result = check(root);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('[check] unpacked extension:');
    expect(result.output).toContain('[check] content scripts:');
  });

  it('counts nested non-code assets, accepts the total boundary and rejects one byte over', () => {
    const root = makeDist();
    put(root, 'assets/nested/padding.bin', Buffer.alloc(totalBudget - bytes(root)));
    expect(bytes(root)).toBe(totalBudget);
    const atLimit = check(root);
    expect(atLimit.status, atLimit.output).toBe(0);
    put(root, 'assets/nested/padding.bin', Buffer.alloc(statSync(join(root, 'assets/nested/padding.bin')).size + 1));
    const overLimit = check(root);
    expect(overLimit.status).toBe(1);
    expect(overLimit.output).toContain('Unpacked extension exceeds budget');
    expect(overLimit.output).toContain('largest=assets/nested/padding.bin');
  });

  it('accepts the content script boundary and rejects one byte over', () => {
    const root = makeDist();
    put(root, 'content-scripts/content.js', ' '.repeat(contentBudget));
    const atLimit = check(root);
    expect(atLimit.status, atLimit.output).toBe(0);
    put(root, 'content-scripts/content.js', ' '.repeat(contentBudget + 1));
    const overLimit = check(root);
    expect(overLimit.status).toBe(1);
    expect(overLimit.output).toContain('Content script JS entries exceeds budget');
    expect(overLimit.output).toContain('largest=content-scripts/content.js');
  });

  it('sums all manifest content entries without counting a shared entry twice', () => {
    const root = makeDist();
    const path = join(root, 'manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.content_scripts.push({
      matches: ['https://example.org/*'],
      js: ['content-scripts/content.js', 'extra.js'],
    });
    writeFileSync(path, JSON.stringify(manifest));
    put(root, 'content-scripts/content.js', ' '.repeat(contentBudget));
    put(root, 'extra.js', '');
    const atLimit = check(root);
    expect(atLimit.status, atLimit.output).toBe(0);
    put(root, 'extra.js', ' ');
    expect(check(root).output).toContain('Content script JS entries exceeds budget');
  });

  it.each(['woff', 'ttf', 'TTF'])('rejects emitted KaTeX fallback .%s fonts', (extension) => {
    const root = makeDist();
    put(root, `assets/nested/KaTeX_Main-Regular-hash.${extension}`, 'font');
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Redundant KaTeX fallback fonts');
  });

  it('reports a missing manifest content entry clearly', () => {
    const root = makeDist();
    rmSync(join(root, 'content-scripts/content.js'));
    expect(check(root).output).toContain('content script missing: content-scripts/content.js');
  });
});

describe('production JavaScript byte safety', () => {
  it.each([0x00, 0x01, 0x1f])('still rejects raw C0 byte %i in any nested JavaScript', (byte) => {
    const root = makeDist();
    put(root, 'assets/nested/unsafe.js', Buffer.from([byte]));
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('JavaScript contains raw C0 control byte');
  });

  it('still rejects invalid UTF-8', () => {
    const root = makeDist();
    put(root, 'assets/unsafe.js', Buffer.from([0xc3, 0x28]));
    expect(check(root).output).toContain('JavaScript is not valid UTF-8');
  });

  it('accepts ordinary JavaScript whitespace', () => {
    const root = makeDist();
    put(root, 'assets/safe.js', '\t\r\n');
    const result = check(root);
    expect(result.status, result.output).toBe(0);
  });
});
