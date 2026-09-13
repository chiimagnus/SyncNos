import { describe, expect, it } from 'vitest';

import {
  LOCALE_PREFERENCE_STORAGE_KEY,
  buildLocalePreferenceStoragePatch,
  normalizeLocalePreference,
} from '@services/protocols/locale-preference';

describe('locale preference', () => {
  it('accepts supported languages and falls back to the system language', () => {
    expect(normalizeLocalePreference('en')).toBe('en');
    expect(normalizeLocalePreference('zh')).toBe('zh');
    expect(normalizeLocalePreference('system')).toBe('system');
    expect(normalizeLocalePreference('fr')).toBe('system');
    expect(buildLocalePreferenceStoragePatch('zh')).toEqual({ [LOCALE_PREFERENCE_STORAGE_KEY]: 'zh' });
  });
});
