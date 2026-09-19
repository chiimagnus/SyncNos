import { afterEach, describe, expect, it, vi } from 'vitest';

import { onInstalled } from '@platform/runtime/runtime';

afterEach(() => {
  // @ts-expect-error test global cleanup
  delete globalThis.browser;
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('runtime onInstalled adapter', () => {
  it('is a no-op when the runtime event is unavailable', () => {
    expect(() => onInstalled(vi.fn())).not.toThrow();
  });

  it('registers with browser runtime when available', () => {
    const addListener = vi.fn();
    // @ts-expect-error test global
    globalThis.browser = { runtime: { onInstalled: { addListener } } };
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { onInstalled: { addListener: vi.fn() } } };
    const listener = vi.fn();

    onInstalled(listener);

    expect(addListener).toHaveBeenCalledWith(listener);
  });

  it('falls back to chrome runtime', () => {
    const addListener = vi.fn();
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { onInstalled: { addListener } } };
    const listener = vi.fn();

    onInstalled(listener);

    expect(addListener).toHaveBeenCalledWith(listener);
  });

  it('contains addListener failures inside the platform adapter', () => {
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onInstalled: {
          addListener: vi.fn(() => {
            throw new Error('extension context unavailable');
          }),
        },
      },
    };

    expect(() => onInstalled(vi.fn())).not.toThrow();
  });
});
