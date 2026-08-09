import { en, type TranslationKey } from './locales/en';
import { zh } from './locales/zh';
import { storageGet, storageOnChanged, storageSet } from '@services/shared/storage';

export type Locale = 'en' | 'zh';
export type LocalePreference = Locale | 'system';

export const LOCALE_PREFERENCE_STORAGE_KEY = 'ui_locale_preference_v1';

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

const translations: Record<Locale, { [K in TranslationKey]: string }> = { en, zh };
let currentLocalePreference: LocalePreference = 'system';
let currentLocale: Locale = detectLocale();
let initialization: Promise<Locale> | null = null;

export function normalizeLocalePreference(value: unknown): LocalePreference {
  const preference = String(value || '')
    .trim()
    .toLowerCase();
  return preference === 'en' || preference === 'zh' || preference === 'system' ? preference : 'system';
}

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
  await storageSet({ [LOCALE_PREFERENCE_STORAGE_KEY]: preference });
  applyLocalePreference(preference);
  return preference;
}

export function getCurrentLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey): string {
  return translations[currentLocale][key];
}

/** Returns the conversation title, falling back to the localised "Untitled" string. */
export function formatConversationTitle(title: string | null | undefined): string {
  return String(title || '').trim() || t('untitled');
}
