import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeLocale: vi.fn(),
  mountPopup: vi.fn(),
  saveLocalePreference: vi.fn(),
  t: vi.fn(() => 'translated'),
}));

vi.mock('@i18n/locale-runtime', () => ({
  LOCALE_PREFERENCE_STORAGE_KEY: 'ui_locale_preference_v1',
  getCurrentLocale: () => 'en',
  getLocalePreference: () => 'system',
  initializeLocale: mocks.initializeLocale,
  normalizeLocalePreference: (value: unknown) => (value === 'en' || value === 'zh' ? value : 'system'),
  saveLocalePreference: mocks.saveLocalePreference,
}));

vi.mock('@i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@i18n')>()),
  t: mocks.t,
}));

vi.mock('../../src/entrypoints/popup/render', () => ({
  mountPopup: mocks.mountPopup,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('popup entrypoint startup', () => {
  it('requests the render module before locale readiness and mounts once after locale settles', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);

    await import('../../src/entrypoints/popup/main');
    await flushMicrotasks();

    expect(mocks.initializeLocale).toHaveBeenCalledTimes(1);
    expect(mocks.mountPopup).not.toHaveBeenCalled();

    locale.resolve();
    await flushMicrotasks();

    expect(mocks.mountPopup).toHaveBeenCalledTimes(1);
  });

  it('does not evaluate module-scope translations while loading the real render graph', async () => {
    await vi.importActual('../../src/entrypoints/popup/render');
    expect(mocks.t).not.toHaveBeenCalled();
  });

  it('keeps only the pre-React surface CSS and locale runtime in the bootstrap source', () => {
    const mainSource = readFileSync(new URL('../../src/entrypoints/popup/main.tsx', import.meta.url), 'utf8');
    const renderSource = readFileSync(new URL('../../src/entrypoints/popup/render.tsx', import.meta.url), 'utf8');
    const htmlSource = readFileSync(new URL('../../src/entrypoints/popup/index.html', import.meta.url), 'utf8');

    expect(mainSource).toContain("from '@i18n/locale-runtime'");
    expect(mainSource).not.toContain("from '@i18n'");
    expect(mainSource).not.toContain("from 'react'");
    expect(mainSource).not.toContain("from 'react-dom/client'");
    expect(mainSource).not.toContain('PopupShell');
    expect(mainSource).toContain("import('./render')");
    expect(mainSource).not.toMatch(/setTimeout|requestAnimationFrame/);

    const mainCss = [...mainSource.matchAll(/^import ['"]([^'"]+\.css)['"];$/gm)].map((match) => match[1]);
    expect(mainCss).toEqual(['@ui/styles/tokens.css', '@entrypoints/popup/style.css']);

    expect(renderSource).toContain("import '@ui/styles/buttons.css'");
    expect(renderSource).toContain("import '@ui/styles/tailwind.css'");
    expect(renderSource).not.toContain('react-tooltip/dist/react-tooltip.css');
    expect(renderSource).not.toContain('@ui/styles/tooltip.css');
    expect(renderSource).not.toContain('initializeLocale');

    expect(htmlSource.match(/id=["']root["']/g)).toHaveLength(1);
    expect(htmlSource).toMatch(/<div id=["']root["']><\/div>/);
  });
});
