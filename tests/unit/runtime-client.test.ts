import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeClient } from '@platform/runtime/client';

beforeEach(() => {
  // @ts-expect-error test global
  delete globalThis.browser;
  // @ts-expect-error test global
  delete globalThis.chrome;
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global
  delete globalThis.browser;
  // @ts-expect-error test global
  delete globalThis.chrome;
});

describe('runtime client invalidation', () => {
  it('notifies current subscribers once when runtime disappears', async () => {
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { id: 'ext', sendMessage: vi.fn() } };
    const client = createRuntimeClient();
    const listener = vi.fn();
    client.onInvalidated(listener);
    delete (globalThis.chrome as any).runtime.id;
    await expect(client.send('x')).rejects.toThrow('Extension context invalidated');
    await expect(client.send('x')).rejects.toThrow('Extension context invalidated');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('allows a current subscriber to unsubscribe before invalidation', async () => {
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { id: 'ext', sendMessage: vi.fn() } };
    const client = createRuntimeClient();
    const listener = vi.fn();
    const unsubscribe = client.onInvalidated(listener);
    unsubscribe();

    delete (globalThis.chrome as any).runtime.id;
    await expect(client.send('x')).rejects.toThrow('Extension context invalidated');
    expect(listener).not.toHaveBeenCalled();
  });

  it('treats swallowed invalid getURL failure as invalidation only when getURL exists', async () => {
    const listener = vi.fn();
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        id: 'ext',
        getURL: vi.fn(() => {
          throw new Error('Extension context invalidated');
        }),
      },
    };
    const client = createRuntimeClient();
    client.onInvalidated(listener);
    expect(client.getURL('icon.png')).toBe('');
    expect(listener).toHaveBeenCalledTimes(1);

    // Missing capability is not evidence that a live extension context was invalidated.
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { id: 'ext' } };
    const second = createRuntimeClient();
    const secondListener = vi.fn();
    second.onInvalidated(secondListener);
    expect(second.getURL('icon.png')).toBe('');
    expect(secondListener).not.toHaveBeenCalled();
  });
});
