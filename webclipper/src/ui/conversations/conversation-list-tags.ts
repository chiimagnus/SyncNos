import type { Conversation } from '@services/conversations/domain/models';
import { parseHostnameFromUrl } from '@services/url-cleaning/hostname';
import type { TranslationKey } from '@i18n/locales/en';

type Translate = (key: TranslationKey) => string;

type SourceLabelMapItem = {
  key: string;
  i18nKey: TranslationKey;
};

const SOURCE_LABEL_MAP: Record<string, SourceLabelMapItem> = {
  chatgpt: { key: 'chatgpt', i18nKey: 'sourceChatgpt' },
  claude: { key: 'claude', i18nKey: 'sourceClaude' },
  deepseek: { key: 'deepseek', i18nKey: 'sourceDeepseek' },
  notionai: { key: 'notionai', i18nKey: 'sourceNotionai' },
  gemini: { key: 'gemini', i18nKey: 'sourceGemini' },
  googleaistudio: { key: 'googleaistudio', i18nKey: 'sourceGoogleAiStudio' },
  kimi: { key: 'kimi', i18nKey: 'sourceKimi' },
  doubao: { key: 'doubao', i18nKey: 'sourceDoubao' },
  yuanbao: { key: 'yuanbao', i18nKey: 'sourceYuanbao' },
  poe: { key: 'poe', i18nKey: 'sourcePoe' },
  zai: { key: 'zai', i18nKey: 'sourceZai' },
  web: { key: 'web', i18nKey: 'sourceWeb' },
};

const SOURCE_TONE_CLASS_MAP: Record<string, string> = {
  chatgpt:
    'tw-border-[var(--brand-chatgpt)] tw-bg-[color-mix(in_srgb,var(--brand-chatgpt)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  claude:
    'tw-border-[var(--brand-claude)] tw-bg-[color-mix(in_srgb,var(--brand-claude)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  deepseek:
    'tw-border-[var(--brand-deepseek)] tw-bg-[color-mix(in_srgb,var(--brand-deepseek)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  notionai:
    'tw-border-[var(--brand-notionai)] tw-bg-[color-mix(in_srgb,var(--brand-notionai)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  gemini:
    'tw-border-[var(--brand-gemini)] tw-bg-[color-mix(in_srgb,var(--brand-gemini)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  googleaistudio:
    'tw-border-[var(--brand-googleaistudio)] tw-bg-[color-mix(in_srgb,var(--brand-googleaistudio)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  kimi: 'tw-border-[var(--brand-kimi)] tw-bg-[color-mix(in_srgb,var(--brand-kimi)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  doubao:
    'tw-border-[var(--brand-doubao)] tw-bg-[color-mix(in_srgb,var(--brand-doubao)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  yuanbao:
    'tw-border-[var(--brand-yuanbao)] tw-bg-[color-mix(in_srgb,var(--brand-yuanbao)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  poe: 'tw-border-[var(--brand-poe)] tw-bg-[color-mix(in_srgb,var(--brand-poe)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  zai: 'tw-border-[var(--brand-zai)] tw-bg-[color-mix(in_srgb,var(--brand-zai)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
  web: 'tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-text-[var(--text-secondary)]',
  unknown: 'tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-text-[var(--text-secondary)]',
};

function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeSourceKey(value: unknown): string {
  const text = safeString(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return text || 'unknown';
}

function normalizeListSiteKey(value: unknown): string {
  const key = safeString(value).toLowerCase();
  if (!key || key === 'unknown' || key === 'all') return '';
  if (key.startsWith('domain:')) return key.slice('domain:'.length).trim();
  return key;
}

function resolveWebLabel(conversation: Pick<Conversation, 'listSiteKey' | 'url'>, translate: Translate): string {
  const fromListSiteKey = normalizeListSiteKey(conversation?.listSiteKey);
  if (fromListSiteKey) return fromListSiteKey;
  const fromUrl = parseHostnameFromUrl(conversation?.url);
  if (fromUrl) return fromUrl;
  return translate('insightUnknownLabel');
}

function resolveSourceLabel(
  sourceKey: string,
  rawSource: unknown,
  conversation: Pick<Conversation, 'listSiteKey' | 'url'>,
  translate: Translate,
): string {
  if (sourceKey === 'web') return resolveWebLabel(conversation, translate);
  const known = SOURCE_LABEL_MAP[sourceKey];
  if (known) return translate(known.i18nKey);
  return safeString(rawSource);
}

export function resolveConversationSourceKey(conversation: Pick<Conversation, 'listSourceKey' | 'source'>): string {
  const preferred = safeString(conversation?.listSourceKey);
  const fallback = safeString(conversation?.source);
  return normalizeSourceKey(preferred || fallback);
}

export function resolveConversationSourceOptionLabel(input: {
  sourceKey: unknown;
  fallbackLabel?: unknown;
  translate: Translate;
}): string {
  const sourceKey = normalizeSourceKey(input.sourceKey);
  const known = SOURCE_LABEL_MAP[sourceKey];
  if (known) return input.translate(known.i18nKey);

  const fallbackLabel = safeString(input.fallbackLabel);
  if (fallbackLabel) return fallbackLabel;

  const cleanedSource = safeString(input.sourceKey);
  return cleanedSource || input.translate('insightUnknownLabel');
}

export function resolveConversationListTag(input: {
  conversation: Pick<Conversation, 'source' | 'listSourceKey' | 'listSiteKey' | 'url'>;
  translate: Translate;
}): { sourceKey: string; label: string; toneClassName: string } {
  const conversation = input.conversation;
  const sourceKey = resolveConversationSourceKey(conversation);
  const label = resolveSourceLabel(sourceKey, conversation?.source, conversation, input.translate);
  const toneClassName = SOURCE_TONE_CLASS_MAP[sourceKey] || SOURCE_TONE_CLASS_MAP.unknown;
  return { sourceKey, label, toneClassName };
}
