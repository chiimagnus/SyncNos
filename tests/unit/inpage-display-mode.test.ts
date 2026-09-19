import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
}));

async function loadModule() {
  vi.resetModules();
  return import('@services/shared/inpage-display-mode');
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.get.mockResolvedValue({});
  storageMocks.set.mockResolvedValue(undefined);
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
  });

  it('rejects invalid owner writes without storage mutation', async () => {
    const api = await loadModule();
    await expect(api.setCanonicalInpageDisplayMode('bad')).rejects.toThrow('invalid inpage display mode');
    expect(storageMocks.set).not.toHaveBeenCalled();
  });
});
