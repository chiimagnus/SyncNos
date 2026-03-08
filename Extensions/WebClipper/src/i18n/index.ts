import { en, type TranslationKey } from './locales/en';
import { zh } from './locales/zh';

type Locale = 'en' | 'zh';

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

export const currentLocale: Locale = detectLocale();

const translations: Record<Locale, { [K in TranslationKey]: string }> = { en, zh };

export function t(key: TranslationKey): string {
  return translations[currentLocale][key];
}

/** Returns the conversation title, falling back to the localised "Untitled" string. */
export function formatConversationTitle(title: string | null | undefined): string {
  return String(title || '').trim() || t('untitled');
}
