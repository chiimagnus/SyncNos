import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  return {
    state,
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys.filter((key) => Object.prototype.hasOwnProperty.call(state, key)).map((key) => [key, state[key]]),
      ),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => Object.assign(state, items)),
  };
});

vi.mock('@platform/storage/local', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
}));

import {
  ensureContentScriptLifecycleToken,
  startContentScriptLifecycle,
} from '@services/bootstrap/content-script-lifecycle';

const TOKEN = '0123456789abcdef0123456789abcdef';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(storageMocks.state)) delete storageMocks.state[key];
});

describe('content script lifecycle', () => {
  it('preempts the previous page generation and tears it down exactly once', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const first = startContentScriptLifecycle(dom.window.document, TOKEN);
    const firstCleanup = vi.fn();
    first.addCleanup(firstCleanup);

    const second = startContentScriptLifecycle(dom.window.document, TOKEN);

    expect(first.isDisposed()).toBe(true);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(second.isDisposed()).toBe(false);

    first.dispose();
    expect(firstCleanup).toHaveBeenCalledTimes(1);

    const secondCleanup = vi.fn();
    second.addCleanup(secondCleanup);
    second.dispose();
    expect(secondCleanup).toHaveBeenCalledTimes(1);
  });

  it('runs a late cleanup immediately after disposal', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const lifecycle = startContentScriptLifecycle(dom.window.document, TOKEN);
    lifecycle.dispose();

    const cleanup = vi.fn();
    lifecycle.addCleanup(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('ignores the old public dispose event that page scripts can forge', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const lifecycle = startContentScriptLifecycle(dom.window.document, TOKEN);

    dom.window.document.dispatchEvent(new dom.window.Event('__syncnos_content_script_dispose_v1__'));

    expect(lifecycle.isDisposed()).toBe(false);
    lifecycle.dispose();
  });

  it('creates one private token and reuses it from extension storage', async () => {
    const first = await ensureContentScriptLifecycleToken();
    const second = await ensureContentScriptLifecycleToken();

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toBe(first);
    expect(storageMocks.set).toHaveBeenCalledTimes(1);
  });
});
