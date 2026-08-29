const UNKNOWN_LIST_KEY = 'unknown';

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeConversationListStoredSourceKey(value: unknown): string {
  return normalizeText(value) || UNKNOWN_LIST_KEY;
}

export function normalizeConversationListStoredSiteKey(value: unknown): string {
  const key = normalizeText(value);
  if (!key || key === UNKNOWN_LIST_KEY) return UNKNOWN_LIST_KEY;
  if (key.startsWith('domain:')) {
    const host = key.slice('domain:'.length).trim();
    return host ? `domain:${host}` : UNKNOWN_LIST_KEY;
  }
  return `domain:${key}`;
}

export function deriveConversationListStoredSiteKeyFromUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return UNKNOWN_LIST_KEY;
  try {
    const url = new URL(text);
    const protocol = normalizeText(url.protocol);
    if (protocol !== 'http:' && protocol !== 'https:') return UNKNOWN_LIST_KEY;
    const host = normalizeText(url.hostname);
    return host ? `domain:${host}` : UNKNOWN_LIST_KEY;
  } catch (_error) {
    return UNKNOWN_LIST_KEY;
  }
}

export function normalizeConversationListRecord<T extends Record<string, any>>(record: T): T {
  const existingSourceKey = String(record?.listSourceKey ?? '').trim();
  const existingSiteKey = String(record?.listSiteKey ?? '').trim();

  const derivedSourceKey = normalizeConversationListStoredSourceKey(record?.source);
  const sourceKey =
    derivedSourceKey !== UNKNOWN_LIST_KEY
      ? derivedSourceKey
      : normalizeConversationListStoredSourceKey(existingSourceKey);

  const derivedSiteKey = deriveConversationListStoredSiteKeyFromUrl(record?.url);
  const siteKey =
    derivedSiteKey !== UNKNOWN_LIST_KEY
      ? derivedSiteKey
      : normalizeConversationListStoredSiteKey(existingSiteKey);

  if (existingSourceKey === sourceKey && existingSiteKey === siteKey) return record;
  return {
    ...record,
    listSourceKey: sourceKey,
    listSiteKey: siteKey,
  } as T;
}
