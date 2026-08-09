import { describe, expect, it } from 'vitest';

import { normalizeLocalePreference } from '../../src/ui/i18n';

describe('locale preference', () => {
  it('accepts supported languages and falls back to the system language', () => {
    expect(normalizeLocalePreference('en')).toBe('en');
    expect(normalizeLocalePreference('zh')).toBe('zh');
    expect(normalizeLocalePreference('system')).toBe('system');
    expect(normalizeLocalePreference('fr')).toBe('system');
  });
});
