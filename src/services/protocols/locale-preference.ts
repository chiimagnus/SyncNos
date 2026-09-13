export const LOCALE_PREFERENCE_STORAGE_KEY = 'ui_locale_preference_v1';

export const LOCALE_PREFERENCES = ['system', 'en', 'zh'] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];
export type Locale = Exclude<LocalePreference, 'system'>;

const LOCALE_PREFERENCE_SET = new Set<string>(LOCALE_PREFERENCES);

export function isLocalePreference(value: unknown): value is LocalePreference {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return LOCALE_PREFERENCE_SET.has(raw);
}

export function normalizeLocalePreference(value: unknown): LocalePreference {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return isLocalePreference(raw) ? raw : 'system';
}

export function buildLocalePreferenceStoragePatch(value: unknown): {
  [LOCALE_PREFERENCE_STORAGE_KEY]: LocalePreference;
} {
  return { [LOCALE_PREFERENCE_STORAGE_KEY]: normalizeLocalePreference(value) };
}
