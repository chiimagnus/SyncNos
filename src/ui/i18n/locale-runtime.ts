import { storageGet, storageOnChanged, storageSet } from '@services/shared/storage';
import {
  LOCALE_PREFERENCE_STORAGE_KEY,
  buildLocalePreferenceStoragePatch,
  normalizeLocalePreference,
  type Locale,
  type LocalePreference,
} from '@services/protocols/locale-preference';

export { LOCALE_PREFERENCE_STORAGE_KEY, normalizeLocalePreference } from '@services/protocols/locale-preference';
export type { Locale, LocalePreference } from '@services/protocols/locale-preference';

function detectLocale(): Locale {
  try {
    if (typeof navigator !== 'undefined') {
      const lang = (navigator.language || '').toLowerCase();
      if (lang.startsWith('zh')) return 'zh';
    }
  } catch (_e) {
    // ignore
  }
  return 'en';
}

let currentLocalePreference: LocalePreference = 'system';
let currentLocale: Locale = detectLocale();
let initialization: Promise<Locale> | null = null;

function applyLocalePreference(value: unknown): Locale {
  currentLocalePreference = normalizeLocalePreference(value);
  currentLocale = currentLocalePreference === 'system' ? detectLocale() : currentLocalePreference;
  return currentLocale;
}

export function getLocalePreference(): LocalePreference {
  return currentLocalePreference;
}

export async function initializeLocale(): Promise<Locale> {
  if (initialization) return initialization;

  initialization = storageGet([LOCALE_PREFERENCE_STORAGE_KEY])
    .then((settings) => applyLocalePreference(settings[LOCALE_PREFERENCE_STORAGE_KEY]))
    .catch(() => currentLocale)
    .finally(() => {
      storageOnChanged((changes, areaName) => {
        if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, LOCALE_PREFERENCE_STORAGE_KEY)) {
          return;
        }
        applyLocalePreference(changes[LOCALE_PREFERENCE_STORAGE_KEY]?.newValue);
      });
    });

  return initialization;
}

export async function saveLocalePreference(value: unknown): Promise<LocalePreference> {
  const preference = normalizeLocalePreference(value);
  await storageSet(buildLocalePreferenceStoragePatch(preference));
  applyLocalePreference(preference);
  return preference;
}

export function getCurrentLocale(): Locale {
  return currentLocale;
}
