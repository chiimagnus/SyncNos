import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeLocale: vi.fn(),
  mountApp: vi.fn(),
}));

vi.mock('@i18n/locale-runtime', () => ({
  initializeLocale: mocks.initializeLocale,
}));

vi.mock('../../src/entrypoints/app/render', () => ({
  mountApp: mocks.mountApp,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('app entrypoint startup', () => {
  it('loads the side-effect-free render module in parallel and mounts only after locale readiness', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);

    await import('../../src/entrypoints/app/main');
    await flushMicrotasks();

    expect(mocks.initializeLocale).toHaveBeenCalledTimes(1);
    expect(mocks.mountApp).not.toHaveBeenCalled();

    locale.resolve();
    await flushMicrotasks();

    expect(mocks.mountApp).toHaveBeenCalledTimes(1);
  });

  it('keeps the HTML entry free of React/AppShell mount side effects', () => {
    const mainSource = readFileSync(new URL('../../src/entrypoints/app/main.tsx', import.meta.url), 'utf8');
    const renderSource = readFileSync(new URL('../../src/entrypoints/app/render.tsx', import.meta.url), 'utf8');

    expect(mainSource).toContain("from '@i18n/locale-runtime'");
    expect(mainSource).toContain("import('./render')");
    expect(mainSource).not.toContain("from 'react'");
    expect(mainSource).not.toContain("from 'react-dom/client'");
    expect(mainSource).not.toContain('AppShell');
    expect(mainSource).not.toContain('createRoot');

    expect(renderSource).toContain("from 'react'");
    expect(renderSource).toContain("from 'react-dom/client'");
    expect(renderSource).toContain('AppShell');
    expect(renderSource).toContain('export function mountApp');
    expect(renderSource).not.toMatch(/\bmountApp\(\);/);
  });
});
