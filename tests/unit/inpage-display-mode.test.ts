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
  it('canonicalizes without mutating input', async () => {
    const api = await loadModule();
    const input = { inpage_display_mode: 'supported', inpage_supported_only: false, keep: 1 };
    const original = structuredClone(input);
    expect(api.canonicalizeInpageDisplayModeStorageRecord(input)).toEqual({
      inpage_display_mode: 'supported',
      keep: 1,
    });
    expect(input).toEqual(original);
    expect(api.canonicalizeInpageDisplayModeStorageRecord({ inpage_supported_only: true })).toEqual({
      inpage_display_mode: 'supported',
    });
    expect(api.canonicalizeInpageDisplayModeStorageRecord({ inpage_supported_only: false })).toEqual({
      inpage_display_mode: 'all',
    });
    expect(api.canonicalizeInpageDisplayModeStorageRecord({ inpage_display_mode: 'garbage' })).toEqual({});
    expect(api.canonicalizeInpageDisplayModeStorageRecord({ keep: 1 })).toEqual({ keep: 1 });
  });

  it('reads effective legacy/canonical state without writing', async () => {
    const api = await loadModule();
    storageMocks.get.mockResolvedValueOnce({ inpage_supported_only: true });
    expect(await api.readEffectiveInpageDisplayMode()).toBe('supported');
    storageMocks.get.mockResolvedValueOnce({ inpage_supported_only: false });
    expect(await api.readEffectiveInpageDisplayMode()).toBe('all');
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'off', inpage_supported_only: true });
    expect(await api.readEffectiveInpageDisplayMode()).toBe('off');
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'bad' });
    expect(await api.readEffectiveInpageDisplayMode()).toBe('all');
    expect(storageMocks.set).not.toHaveBeenCalled();
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it('migrates legacy only after canonical write succeeds', async () => {
    const api = await loadModule();
    const order: string[] = [];
    storageMocks.get.mockResolvedValue({ inpage_supported_only: true });
    storageMocks.set.mockImplementation(async () => {
      order.push('set');
    });
    storageMocks.remove.mockImplementation(async () => {
      order.push('remove');
    });
    expect(await api.ensureCanonicalInpageDisplayMode()).toBe('supported');
    expect(order).toEqual(['set', 'remove']);

    vi.clearAllMocks();
    storageMocks.get.mockResolvedValue({ inpage_supported_only: true });
    storageMocks.set.mockRejectedValue(new Error('write failed'));
    await expect(api.ensureCanonicalInpageDisplayMode()).rejects.toThrow('write failed');
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it('keeps the owner queue usable after best-effort cleanup failure', async () => {
    const api = await loadModule();
    storageMocks.get.mockResolvedValue({ inpage_display_mode: 'all', inpage_supported_only: true });
    storageMocks.remove.mockRejectedValueOnce(new Error('cleanup failed'));
    expect(await api.ensureCanonicalInpageDisplayMode()).toBe('all');
    storageMocks.set.mockResolvedValue(undefined);
    expect(await api.setCanonicalInpageDisplayMode('off')).toBe('off');
    expect(storageMocks.set).toHaveBeenLastCalledWith({ inpage_display_mode: 'off' });
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

  it('serializes migration before a newer canonical writer so the newer mode wins', async () => {
    const api = await loadModule();
    const migrationWrite = deferred<void>();
    storageMocks.get.mockResolvedValueOnce({ inpage_supported_only: true });
    storageMocks.set.mockImplementationOnce(() => migrationWrite.promise).mockResolvedValue(undefined);
    const migration = api.ensureCanonicalInpageDisplayMode();
    const newer = api.setCanonicalInpageDisplayMode('off');
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(storageMocks.set).toHaveBeenCalledTimes(1);
    expect(storageMocks.set).toHaveBeenNthCalledWith(1, { inpage_display_mode: 'supported' });
    migrationWrite.resolve();
    await expect(migration).resolves.toBe('supported');
    await expect(newer).resolves.toBe('off');
    expect(storageMocks.set).toHaveBeenLastCalledWith({ inpage_display_mode: 'off' });
  });

  it('performs migration reads only when its queued turn starts', async () => {
    const api = await loadModule();
    const firstWrite = deferred<void>();
    storageMocks.set.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    const first = api.setCanonicalInpageDisplayMode('supported');
    const migration = api.ensureCanonicalInpageDisplayMode();
    await Promise.resolve();
    expect(storageMocks.get).not.toHaveBeenCalled();
    firstWrite.resolve();
    await first;
    storageMocks.get.mockResolvedValueOnce({ inpage_display_mode: 'supported' });
    await expect(migration).resolves.toBe('supported');
    expect(storageMocks.get).toHaveBeenCalledTimes(1);
  });
});
