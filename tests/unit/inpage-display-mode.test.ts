import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
  storageRemove: storageMocks.remove,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadModule() {
  vi.resetModules();
  return import('@services/shared/inpage-display-mode');
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.get.mockResolvedValue({});
  storageMocks.set.mockResolvedValue(undefined);
  storageMocks.remove.mockResolvedValue(undefined);
});

describe('inpage display mode contract', () => {
  it('canonicalizes the canonical value without mutating input', async () => {
    const api = await loadModule();
    const input = { inpage_display_mode: 'supported', keep: 1 };
    const original = structuredClone(input);
    expect(api.canonicalizeInpageDisplayModeStorageRecord(input)).toEqual({
      inpage_display_mode: 'supported',
      keep: 1,
    });
    expect(input).toEqual(original);
    expect(api.canonicalizeInpageDisplayModeStorageRecord({ inpage_display_mode: 'garbage' })).toEqual({});
    expect(api.canonicalizeInpageDisplayModeStorageRecord({ keep: 1 })).toEqual({ keep: 1 });
  });

  it('reads only canonical state and defaults invalid or missing values to all', async () => {
    const api = await loadModule();
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'off' });
    expect(await api.readEffectiveInpageDisplayMode()).toBe('off');
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'bad' });
    expect(await api.readEffectiveInpageDisplayMode()).toBe('all');
    storageMocks.get.mockResolvedValueOnce({});
    expect(await api.readEffectiveInpageDisplayMode()).toBe('all');
    expect(storageMocks.get).toHaveBeenCalledWith(['inpage_display_mode']);
    expect(storageMocks.set).not.toHaveBeenCalled();
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it('rejects invalid owner writes without storage mutation', async () => {
    const api = await loadModule();
    await expect(api.setCanonicalInpageDisplayMode('bad')).rejects.toThrow('invalid inpage display mode');
    expect(storageMocks.set).not.toHaveBeenCalled();
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it('drops invalid canonical residue without materializing the default', async () => {
    const api = await loadModule();
    storageMocks.get.mockResolvedValue({ inpage_display_mode: 'bad' });
    expect(await api.ensureCanonicalInpageDisplayMode()).toBe('all');
    expect(storageMocks.set).not.toHaveBeenCalled();
    expect(storageMocks.remove).toHaveBeenCalledWith(['inpage_display_mode']);
  });

  it('serializes invalid-value cleanup before a newer canonical writer', async () => {
    const api = await loadModule();
    const cleanup = deferred<void>();
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'bad' });
    storageMocks.remove.mockImplementationOnce(() => cleanup.promise).mockResolvedValue(undefined);
    const ensure = api.ensureCanonicalInpageDisplayMode();
    const newer = api.setCanonicalInpageDisplayMode('off');
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(storageMocks.set).not.toHaveBeenCalled();
    cleanup.resolve();
    await expect(ensure).resolves.toBe('all');
    await expect(newer).resolves.toBe('off');
    expect(storageMocks.set).toHaveBeenLastCalledWith({ inpage_display_mode: 'off' });
  });

  it('performs canonical validation reads only when its queued turn starts', async () => {
    const api = await loadModule();
    const firstWrite = deferred<void>();
    storageMocks.set.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    const first = api.setCanonicalInpageDisplayMode('supported');
    const ensure = api.ensureCanonicalInpageDisplayMode();
    await Promise.resolve();
    expect(storageMocks.get).not.toHaveBeenCalled();
    firstWrite.resolve();
    await first;
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'supported' });
    await expect(ensure).resolves.toBe('supported');
    expect(storageMocks.get).toHaveBeenCalledTimes(1);
  });
});
