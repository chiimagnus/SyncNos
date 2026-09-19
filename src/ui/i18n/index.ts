import { en, type TranslationKey } from './locales/en';
import { zh } from './locales/zh';
import { getCurrentLocale } from './locale-runtime';
import type { Locale } from '@services/protocols/locale-preference';

export {
  LOCALE_PREFERENCE_STORAGE_KEY,
  getCurrentLocale,
  getLocalePreference,
  initializeLocale,
  normalizeLocalePreference,
  saveLocalePreference,
} from './locale-runtime';
export type { Locale, LocalePreference } from './locale-runtime';

const translations: Record<Locale, { [K in TranslationKey]: string }> = { en, zh };

export function t(key: TranslationKey): string {
  return translations[getCurrentLocale()][key];
}

/** Returns the conversation title, falling back to the localised "Untitled" string. */
export function formatConversationTitle(title: string | null | undefined): string {
  return String(title || '').trim() || t('untitled');
}
