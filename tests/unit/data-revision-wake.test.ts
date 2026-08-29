import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function clearStorageGlobals(): void {
  delete (globalThis as any).chrome;
  delete (globalThis as any).browser;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('data revision wake', () => {
  beforeEach(() => {
    clearStorageGlobals();
    vi.resetModules();
  });

  afterEach(() => {
    clearStorageGlobals();
  });

  it('publishes only opaque runtime metadata under the canonical storage key', async () => {
    const writes: Record<string, unknown>[] = [];
    (globalThis as any).chrome = {
      runtime: {},
      storage: {
        local: {
          set(payload: Record<string, unknown>, callback: () => void) {
            writes.push(payload);
            callback();
          },
        },
      },
    };
    const { DATA_REVISION_WAKE_STORAGE_KEY, publishDataRevisionWake } = await import('@services/data-revisions/wake');

    publishDataRevisionWake();
    await vi.waitFor(() => expect(writes).toHaveLength(1));

    expect(Object.keys(writes[0])).toEqual([DATA_REVISION_WAKE_STORAGE_KEY]);
    expect(typeof writes[0][DATA_REVISION_WAKE_STORAGE_KEY]).toBe('string');
    expect(String(writes[0][DATA_REVISION_WAKE_STORAGE_KEY])).not.toMatch(
      /conversations|messages|sync_mappings|article_comments|image_cache/i,
    );
  });

  it('coalesces concurrent publishes to one active write plus one trailing write', async () => {
    const writes: Record<string, unknown>[] = [];
    const callbacks: Array<() => void> = [];
    (globalThis as any).chrome = {
      runtime: {},
      storage: {
        local: {
          set(payload: Record<string, unknown>, callback: () => void) {
            writes.push(payload);
            callbacks.push(callback);
          },
        },
      },
    };
    const { DATA_REVISION_WAKE_STORAGE_KEY, publishDataRevisionWake } = await import('@services/data-revisions/wake');

    publishDataRevisionWake();
    publishDataRevisionWake();
    publishDataRevisionWake();
    await vi.waitFor(() => expect(writes).toHaveLength(1));

    callbacks.shift()?.();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    callbacks.shift()?.();
    await flushMicrotasks();

    expect(writes).toHaveLength(2);
    expect(writes[0][DATA_REVISION_WAKE_STORAGE_KEY]).not.toBe(writes[1][DATA_REVISION_WAKE_STORAGE_KEY]);
  });

  it('isolates synchronous throws and asynchronous rejections and remains reusable', async () => {
    let attempts = 0;
    (globalThis as any).chrome = {
      runtime: {},
      storage: {
        local: {
          set() {
            attempts += 1;
            throw new Error('sync storage failure');
          },
        },
      },
    };
    const { publishDataRevisionWake } = await import('@services/data-revisions/wake');

    expect(() => publishDataRevisionWake()).not.toThrow();
    await vi.waitFor(() => expect(attempts).toBe(1));
    await flushMicrotasks();

    clearStorageGlobals();
    (globalThis as any).browser = {
      storage: {
        local: {
          set: vi.fn().mockRejectedValueOnce(new Error('async storage failure')).mockResolvedValue(undefined),
        },
      },
    };
    publishDataRevisionWake();
    await flushMicrotasks();
    publishDataRevisionWake();
    await vi.waitFor(() => expect((globalThis as any).browser.storage.local.set).toHaveBeenCalledTimes(2));
  });
});
