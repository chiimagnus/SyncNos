import { en, type TranslationKey } from './locales/en';
import { zh } from './locales/zh';

export type Locale = 'en' | 'zh';

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
const currentLocale: Locale = detectLocale();

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
