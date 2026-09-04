import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

export const WEB_ARTICLE_SOURCE = 'web' as const;
const WEB_ARTICLE_CONVERSATION_KEY_PREFIX = 'article:';

type CanonicalWebArticleIdentity = {
  source: typeof WEB_ARTICLE_SOURCE;
  conversationKey: string;
  url: string;
};

export function buildCanonicalWebArticleConversationKey(url: unknown): string {
  const canonicalUrl = canonicalizeArticleUrl(url);
  return canonicalUrl ? `${WEB_ARTICLE_CONVERSATION_KEY_PREFIX}${canonicalUrl}` : '';
}

export function normalizeWebArticleConversationKey(raw: unknown): string {
  const key = String(raw ?? '').trim();
  if (!key) return '';
  if (!key.toLowerCase().startsWith(WEB_ARTICLE_CONVERSATION_KEY_PREFIX)) return key;

  const canonicalKey = buildCanonicalWebArticleConversationKey(key.slice(WEB_ARTICLE_CONVERSATION_KEY_PREFIX.length));
  return canonicalKey || key;
}

export function buildCanonicalWebArticleIdentity(url: unknown): CanonicalWebArticleIdentity | null {
  const canonicalUrl = canonicalizeArticleUrl(url);
  if (!canonicalUrl) return null;
  return {
    source: WEB_ARTICLE_SOURCE,
    conversationKey: `${WEB_ARTICLE_CONVERSATION_KEY_PREFIX}${canonicalUrl}`,
    url: canonicalUrl,
  };
}
