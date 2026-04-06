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

  it('supports hostname lookup and markdown domain detection', async () => {
    const { getAntiHotlinkRefererFromRules, includesAnyAntiHotlinkDomain } =
      await import('../../src/platform/webext/anti-hotlink-rules-store');

    const rules = [
      { domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' },
      { domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/' },
    ];

    expect(getAntiHotlinkRefererFromRules('https://cdnfile.sspai.com/cover.png?x=1', rules)).toBe('https://sspai.com/');
    expect(getAntiHotlinkRefererFromRules('https://example.com/a.png', rules)).toBe(null);
    expect(getAntiHotlinkRefererFromRules('notaurl', rules)).toBe(null);

    expect(includesAnyAntiHotlinkDomain('![img](https://picx.zhimg.com/v2-1.jpg)', rules)).toBe(true);
    expect(includesAnyAntiHotlinkDomain('![img](https://example.com/a.png)', rules)).toBe(false);
    expect(includesAnyAntiHotlinkDomain('![img](https://notcdnfile.sspai.com.evil/a.png)', rules)).toBe(false);
  });

  it('settings service blocks invalid drafts before writing to storage', async () => {
    const { saveAntiHotlinkRulesForSettings } =
      await import('../../src/services/integrations/anti-hotlink/anti-hotlink-settings');

    const result = await saveAntiHotlinkRulesForSettings([
      { domain: 'https://cdnfile.sspai.com', referer: 'https://sspai.com/' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'domain_invalid', field: 'domain' })]),
      );
    }
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it('settings service loads and resets through platform rule store', async () => {
    const { ANTI_HOTLINK_RULES_STORAGE_KEY } = await import('../../src/platform/webext/anti-hotlink-rules-store');
    const { loadAntiHotlinkRulesForSettings, resetAntiHotlinkRulesForSettings } =
      await import('../../src/services/integrations/anti-hotlink/anti-hotlink-settings');

    store[ANTI_HOTLINK_RULES_STORAGE_KEY] = [{ domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/' }];

    const loaded = await loadAntiHotlinkRulesForSettings();
    expect(loaded).toEqual([{ domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/' }]);

    const reset = await resetAntiHotlinkRulesForSettings();
    expect(reset).toEqual([{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }]);
  });

  it('settings service can persist an explicit empty rules list', async () => {
    const { ANTI_HOTLINK_RULES_STORAGE_KEY } = await import('../../src/platform/webext/anti-hotlink-rules-store');
    const { loadAntiHotlinkRulesForSettings, saveAntiHotlinkRulesForSettings } =
      await import('../../src/services/integrations/anti-hotlink/anti-hotlink-settings');

    const result = await saveAntiHotlinkRulesForSettings([]);
    expect(result.ok).toBe(true);
    expect(store[ANTI_HOTLINK_RULES_STORAGE_KEY]).toEqual([]);

    const loaded = await loadAntiHotlinkRulesForSettings();
    expect(loaded).toEqual([]);
  });

  it('settings service can force-refresh to sync external storage writes', async () => {
    const { ANTI_HOTLINK_RULES_STORAGE_KEY } = await import('../../src/platform/webext/anti-hotlink-rules-store');
    const { loadAntiHotlinkRulesForSettings } =
      await import('../../src/services/integrations/anti-hotlink/anti-hotlink-settings');

    store[ANTI_HOTLINK_RULES_STORAGE_KEY] = [{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }];
    const first = await loadAntiHotlinkRulesForSettings();
    expect(first).toEqual([{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }]);

    store[ANTI_HOTLINK_RULES_STORAGE_KEY] = [{ domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/' }];
    const stale = await loadAntiHotlinkRulesForSettings();
    expect(stale).toEqual([{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }]);

    const refreshed = await loadAntiHotlinkRulesForSettings({ forceRefresh: true });
    expect(refreshed).toEqual([{ domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/' }]);
  });
});
