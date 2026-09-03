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

  it('replays invalidation once to late subscribers and supports cancellation', async () => {
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { id: 'ext', sendMessage: vi.fn() } };
    const client = createRuntimeClient();
    delete (globalThis.chrome as any).runtime.id;
    await expect(client.send('x')).rejects.toThrow();

    const replayed = vi.fn();
    client.onInvalidated(replayed);
    const cancelled = vi.fn();
    const unsubscribe = client.onInvalidated(cancelled);
    unsubscribe();
    await Promise.resolve();
    expect(replayed).toHaveBeenCalledTimes(1);
    expect(replayed.mock.calls[0]?.[0]?.message).toBe('Extension context invalidated');
    expect(cancelled).not.toHaveBeenCalled();
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

  it('isolates throwing late listeners', async () => {
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { id: 'ext', sendMessage: vi.fn() } };
    const client = createRuntimeClient();
    delete (globalThis.chrome as any).runtime.id;
    await expect(client.send('x')).rejects.toThrow();
    client.onInvalidated(() => {
      throw new Error('listener failed');
    });
    const safe = vi.fn();
    client.onInvalidated(safe);
    await Promise.resolve();
    expect(safe).toHaveBeenCalledTimes(1);
  });
});
