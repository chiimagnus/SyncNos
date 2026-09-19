import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageOnChanged: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: mocks.storageGet,
  storageSet: mocks.storageSet,
  storageOnChanged: mocks.storageOnChanged,
}));

const storageKey = 'ui_locale_preference_v1';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.storageSet.mockResolvedValue(undefined);
  mocks.storageOnChanged.mockReturnValue(() => {});
});

describe('locale runtime', () => {
  it('uses the system locale when persisted preference loading fails', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    mocks.storageGet.mockRejectedValue(new Error('storage unavailable'));

    const runtime = await import('../../src/ui/i18n/locale-runtime');

    expect(runtime.getCurrentLocale()).toBe('zh');
    await expect(runtime.initializeLocale()).resolves.toBe('zh');
    expect(runtime.getLocalePreference()).toBe('system');
    expect(mocks.storageOnChanged).toHaveBeenCalledTimes(1);
  });

  it('shares persisted locale state with the i18n barrel and tracks storage changes', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    mocks.storageGet.mockResolvedValue({ [storageKey]: 'zh' });
    let onChanged: ((changes: any, areaName: string) => void) | null = null;
    mocks.storageOnChanged.mockImplementation((listener) => {
      onChanged = listener;
      return () => {};
    });

    const runtime = await import('../../src/ui/i18n/locale-runtime');
    await expect(runtime.initializeLocale()).resolves.toBe('zh');

    const i18n = await import('../../src/ui/i18n');
    const { en } = await import('../../src/ui/i18n/locales/en');
    const { zh } = await import('../../src/ui/i18n/locales/zh');

    expect(i18n.getCurrentLocale()).toBe('zh');
    expect(i18n.t('untitled')).toBe(zh.untitled);

    onChanged?.({ [storageKey]: { newValue: 'en' } }, 'sync');
    expect(runtime.getCurrentLocale()).toBe('zh');

    onChanged?.({ [storageKey]: { newValue: 'en' } }, 'local');
    expect(runtime.getCurrentLocale()).toBe('en');
    expect(i18n.getCurrentLocale()).toBe('en');
    expect(i18n.t('untitled')).toBe(en.untitled);
  });

  it('persists a normalized preference and updates the shared state', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    mocks.storageGet.mockResolvedValue({ [storageKey]: 'system' });

    const runtime = await import('../../src/ui/i18n/locale-runtime');
    await runtime.initializeLocale();

    await expect(runtime.saveLocalePreference('ZH')).resolves.toBe('zh');
    expect(mocks.storageSet).toHaveBeenCalledWith({ [storageKey]: 'zh' });
    expect(runtime.getLocalePreference()).toBe('zh');
    expect(runtime.getCurrentLocale()).toBe('zh');
  });
});
