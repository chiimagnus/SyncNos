import { beforeEach, describe, expect, it, vi } from 'vitest';

type Store = Record<string, unknown>;

let store: Store;
const storageGetMock = vi.fn();
const storageSetMock = vi.fn();

vi.mock('../../src/platform/storage/local', () => ({
  storageGet: (...args: unknown[]) => storageGetMock(...args),
  storageSet: (...args: unknown[]) => storageSetMock(...args),
}));

describe('anti-hotlink-rules-store', () => {
  beforeEach(() => {
    store = {};
    vi.clearAllMocks();
    vi.resetModules();

    storageGetMock.mockImplementation(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys || []) {
        if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
      }
      return out;
    });

    storageSetMock.mockImplementation(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items || {})) {
        store[key] = value;
      }
    });
  });

  it('seeds defaults once when storage key is missing', async () => {
    const mod = await import('../../src/platform/webext/anti-hotlink-rules-store');
    const first = await mod.getAntiHotlinkRulesSnapshot();
    const second = await mod.getAntiHotlinkRulesSnapshot();

    expect(first).toEqual([{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }]);
    expect(second).toEqual(first);
    expect(storageSetMock).toHaveBeenCalledTimes(1);
    expect(store[mod.ANTI_HOTLINK_RULES_STORAGE_KEY]).toEqual(first);
  });

  it('keeps explicit empty list without re-seeding default rules', async () => {
    const mod = await import('../../src/platform/webext/anti-hotlink-rules-store');
    store[mod.ANTI_HOTLINK_RULES_STORAGE_KEY] = [];

    const rules = await mod.getAntiHotlinkRulesSnapshot({ forceRefresh: true });
    expect(rules).toEqual([]);
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it('sanitizes malformed rows and de-duplicates by domain', async () => {
    const mod = await import('../../src/platform/webext/anti-hotlink-rules-store');
    store[mod.ANTI_HOTLINK_RULES_STORAGE_KEY] = [
      { domain: ' CDNFILE.SSPAI.COM ', referer: 'https://sspai.com' },
      { domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/another' },
      { domain: 'https://bad-domain.example.com', referer: 'https://example.com/' },
      { domain: 'picx.zhimg.com', referer: 'javascript:alert(1)' },
      { domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/question/1#frag' },
    ];

    const rules = await mod.getAntiHotlinkRulesSnapshot({ forceRefresh: true });
    expect(rules).toEqual([
      { domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' },
      { domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/question/1' },
    ]);
  });

  it('reports row-level validation issues for invalid draft inputs', async () => {
    const { validateAndNormalizeAntiHotlinkRules } = await import('../../src/platform/webext/anti-hotlink-rules-store');
    const result = validateAndNormalizeAntiHotlinkRules([
      { domain: '', referer: '' },
      { domain: 'https://cdnfile.sspai.com', referer: 'https://sspai.com/' },
      { domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' },
      { domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' },
    ]);

    expect(result.rules).toEqual([{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, code: 'domain_required', field: 'domain' }),
        expect.objectContaining({ index: 0, code: 'referer_required', field: 'referer' }),
        expect.objectContaining({ index: 1, code: 'domain_invalid', field: 'domain' }),
        expect.objectContaining({ index: 3, code: 'domain_duplicate', field: 'domain' }),
      ]),
    );
  });
});
