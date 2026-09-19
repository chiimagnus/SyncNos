import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

// @ts-expect-error repository build helper is intentionally authored as ESM JavaScript
import {
  analyzeBackgroundRuntime,
  analyzePopupStartup,
  assertHtmlModuleEntriesAreRoots,
  collectStaticModuleClosure,
  inspectStartupStylesheets,
  resolveBackgroundEntries,
  resolveBackgroundMode,
  resolvePopupAssets,
} from '../../.github/scripts/webclipper/dist-static-closure.mjs';

const roots: string[] = [];

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), 'syncnos-dist-'));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, contents: string) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
  return path;
}

function popupManifest() {
  return { action: { default_popup: 'popup.html' } };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('dist static closure analyzer', () => {
  it('resolves one local Popup module entry plus direct stylesheets and bootstrap modulepreloads', () => {
    const root = createRoot();
    write(
      root,
      'popup.html',
      '<script type="module" src="/chunks/popup.js"></script><link rel="stylesheet" href="/assets/base.css"><link rel="modulepreload" href="/chunks/base.js">',
    );
    write(root, 'chunks/popup.js', '');
    write(root, 'chunks/base.js', '');
    write(root, 'assets/base.css', 'body{}');

    const assets = resolvePopupAssets(root, popupManifest());

    expect(assets.entry).toBe(join(root, 'chunks/popup.js'));
    expect(assets.stylesheets).toEqual([join(root, 'assets/base.css')]);
    expect(assets.modulePreloads).toEqual([join(root, 'chunks/base.js')]);
  });

  it('rejects zero, multiple, remote, missing, and escaping Popup assets', () => {
    const root = createRoot();
    write(root, 'popup.html', '<div></div>');
    expect(() => resolvePopupAssets(root, popupManifest())).toThrow(/exactly one module script/);

    write(root, 'popup.html', '<script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>');
    write(root, 'a.js', '');
    write(root, 'b.js', '');
    expect(() => resolvePopupAssets(root, popupManifest())).toThrow(/exactly one module script/);

    write(root, 'popup.html', '<script type="module" src="https://example.com/a.js"></script>');
    expect(() => resolvePopupAssets(root, popupManifest())).toThrow(/must be local/);

    write(root, 'popup.html', '<script type="module" src="/missing.js"></script>');
    expect(() => resolvePopupAssets(root, popupManifest())).toThrow(/missing/);

    write(root, 'popup.html', '<script type="module" src="../outside.js"></script>');
    expect(() => resolvePopupAssets(root, popupManifest())).toThrow(/escapes dist root/);
  });

  it('follows static import/re-export cycles while ignoring import-like text and import.meta', async () => {
    const root = createRoot();
    const a = write(root, 'a.js', "import './b.js'; export { value } from './c.js';");
    write(root, 'b.js', "export const b = import.meta.url; import './a.js';");
    const tick = String.fromCharCode(96);
    write(
      root,
      'c.js',
      "export const value = 1; const a = \"import('./fake.js')\"; /* import './fake2.js' */ const b = " +
        tick +
        "import('./fake3.js')" +
        tick +
        ';',
    );

    const closure = await collectStaticModuleClosure(root, [a]);

    expect(closure.files.map((file: string) => file.slice(root.length + 1)).sort()).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('keeps only the Popup entry first-hop dynamic target plus its static closure in immediate UI bytes', async () => {
    const root = createRoot();
    write(
      root,
      'popup.html',
      '<script type="module" src="/chunks/popup.js"></script><link rel="modulepreload" href="/chunks/base.js"><link rel="stylesheet" href="/assets/base.css">',
    );
    write(root, 'chunks/popup.js', "import './base.js'; import('./render.js');");
    write(root, 'chunks/base.js', 'export const base = 1;');
    write(root, 'chunks/render.js', "import './ui.js'; import('./detail.js');");
    write(root, 'chunks/ui.js', 'export const ui = 1;');
    write(root, 'chunks/detail.js', 'export const detail = 1;');
    write(root, 'assets/base.css', 'body{}');

    const result = await analyzePopupStartup(root, popupManifest());
    const immediate = result.immediateFiles.map((file: string) => file.slice(root.length + 1)).sort();

    expect(immediate).toEqual(['chunks/base.js', 'chunks/popup.js', 'chunks/render.js', 'chunks/ui.js']);
    expect(immediate).not.toContain('chunks/detail.js');
  });

  it('keeps every HTML module entry as a graph root in both dependency directions', async () => {
    const popupToAppRoot = createRoot();
    write(popupToAppRoot, 'popup.html', '<script type="module" src="/popup.js"></script>');
    write(popupToAppRoot, 'app.html', '<script type="module" src="/app.js"></script>');
    write(popupToAppRoot, 'popup.js', "import('./render.js');");
    write(popupToAppRoot, 'render.js', "import('./detail.js');");
    write(popupToAppRoot, 'detail.js', "import './app.js';");
    write(popupToAppRoot, 'app.js', 'globalThis.__mountedApp = true;');

    await expect(assertHtmlModuleEntriesAreRoots(popupToAppRoot)).rejects.toThrow(/must remain a graph root/);

    const appToPopupRoot = createRoot();
    write(appToPopupRoot, 'popup.html', '<script type="module" src="/popup.js"></script>');
    write(appToPopupRoot, 'app.html', '<script type="module" src="/app.js"></script>');
    write(appToPopupRoot, 'popup.js', "import('./render.js');");
    write(appToPopupRoot, 'render.js', '');
    write(appToPopupRoot, 'app.js', "import './shared.js';");
    write(appToPopupRoot, 'shared.js', "import './popup.js';");

    await expect(assertHtmlModuleEntriesAreRoots(appToPopupRoot)).rejects.toThrow(/must remain a graph root/);
  });

  it('rejects imports of nested HTML module entries', async () => {
    const root = createRoot();
    write(root, 'popup.html', '<script type="module" src="/popup.js"></script>');
    write(root, 'pages/settings.html', '<script type="module" src="./settings.js"></script>');
    write(root, 'popup.js', "import('./render.js');");
    write(root, 'render.js', "import './pages/settings.js';");
    write(root, 'pages/settings.js', 'globalThis.__mountedSettings = true;');

    await expect(assertHtmlModuleEntriesAreRoots(root)).rejects.toThrow(/must remain a graph root/);
  });

  it('ignores unrelated non-literal runtime imports while checking HTML entry roots', async () => {
    const root = createRoot();
    write(root, 'popup.html', '<script type="module" src="/popup.js"></script>');
    write(root, 'app.html', '<script type="module" src="/app.js"></script>');
    write(root, 'popup.js', "import('./render.js');");
    write(root, 'render.js', '');
    write(root, 'app.js', "import('./app-render.js');");
    write(root, 'app-render.js', 'export const app = true;');
    write(root, 'router-runtime.js', 'export async function load(route) { return import(route.module); }');

    await expect(assertHtmlModuleEntriesAreRoots(root)).resolves.toBeUndefined();
    await expect(analyzePopupStartup(root, popupManifest())).resolves.toBeDefined();
  });

  it('rejects a Popup modulepreload that bypasses the bootstrap static closure', async () => {
    const root = createRoot();
    write(
      root,
      'popup.html',
      '<script type="module" src="/popup.js"></script><link rel="modulepreload" href="/render.js">',
    );
    write(root, 'popup.js', "import('./render.js');");
    write(root, 'render.js', '');

    await expect(analyzePopupStartup(root, popupManifest())).rejects.toThrow(/modulepreload bypasses/);
  });

  it('requires exactly one direct Popup dynamic import', async () => {
    const root = createRoot();
    write(root, 'popup.html', '<script type="module" src="/popup.js"></script>');
    write(root, 'popup.js', "import('./a.js'); import('./b.js');");
    write(root, 'a.js', '');
    write(root, 'b.js', '');

    await expect(analyzePopupStartup(root, popupManifest())).rejects.toThrow(/exactly one direct dynamic import/);
  });

  it('rejects non-literal dynamic imports, bare imports, missing files, and root escapes', async () => {
    const root = createRoot();

    const dynamic = write(root, 'dynamic.js', 'const target = "./x.js"; import(target);');
    await expect(collectStaticModuleClosure(root, [dynamic])).rejects.toThrow(/string literal/);

    const bare = write(root, 'bare.js', "import 'react';");
    await expect(collectStaticModuleClosure(root, [bare])).rejects.toThrow(/bare specifier/);

    const missing = write(root, 'missing.js', "import './does-not-exist.js';");
    await expect(collectStaticModuleClosure(root, [missing])).rejects.toThrow(/missing/);

    const escaping = write(root, 'nested/escape.js', "import '../../outside.js';");
    await expect(collectStaticModuleClosure(root, [escaping])).rejects.toThrow(/escapes dist root/);
  });

  it('parses startup CSS and rejects real @import rules', () => {
    const root = createRoot();
    const clean = write(root, 'clean.css', '.a{display:block}');
    expect(inspectStartupStylesheets(root, [clean]).bytes).toBeGreaterThan(0);

    const imported = write(root, 'imported.css', '@import "./other.css"; .a{display:block}');
    expect(() => inspectStartupStylesheets(root, [imported])).toThrow(/must not contain @import/);
  });

  it('resolves exactly one background declaration and rejects duplicates or ambiguity', () => {
    expect(resolveBackgroundEntries({ background: { service_worker: 'background.js' } })).toEqual(['background.js']);
    expect(resolveBackgroundEntries({ background: { scripts: ['a.js', 'b.js'] } })).toEqual(['a.js', 'b.js']);
    expect(() =>
      resolveBackgroundEntries({ background: { service_worker: 'background.js', scripts: ['background.js'] } }),
    ).toThrow(/must not both/);
    expect(() => resolveBackgroundEntries({ background: { scripts: ['a.js', 'a.js'] } })).toThrow(/duplicate/);
    expect(() => resolveBackgroundEntries({ background: {} })).toThrow(/required/);
  });

  it('accepts classic/module background modes and rejects unknown values', () => {
    expect(resolveBackgroundMode({ background: {} })).toBe('classic');
    expect(resolveBackgroundMode({ background: { type: 'classic' } })).toBe('classic');
    expect(resolveBackgroundMode({ background: { type: 'module' } })).toBe('module');
    expect(() => resolveBackgroundMode({ background: { type: 'future' } })).toThrow(/Unsupported background.type/);
  });

  it('requires classic background entries to be self-contained scripts', async () => {
    const staticRoot = createRoot();
    write(staticRoot, 'background.js', "import './child.js';");
    write(staticRoot, 'child.js', '');
    await expect(
      analyzeBackgroundRuntime(staticRoot, { background: { service_worker: 'background.js' } }),
    ).rejects.toThrow(/must not contain ESM static imports/);

    const dynamicRoot = createRoot();
    write(dynamicRoot, 'background.js', "import('./child.js');");
    write(dynamicRoot, 'child.js', '');
    await expect(
      analyzeBackgroundRuntime(dynamicRoot, { background: { service_worker: 'background.js' } }),
    ).rejects.toThrow(/dynamic import is not supported/);
  });

  it('allows module background static closure but rejects dynamic import anywhere in it', async () => {
    const root = createRoot();
    write(root, 'background.js', "import './child.js';");
    write(root, 'child.js', 'export const value = 1;');

    const result = await analyzeBackgroundRuntime(root, {
      background: { service_worker: 'background.js', type: 'module' },
    });
    expect(result.files.map((file: string) => file.slice(root.length + 1)).sort()).toEqual([
      'background.js',
      'child.js',
    ]);

    write(root, 'child.js', "import('./late.js');");
    write(root, 'late.js', '');
    await expect(
      analyzeBackgroundRuntime(root, { background: { service_worker: 'background.js', type: 'module' } }),
    ).rejects.toThrow(/Dynamic import is not allowed/);
  });
});
