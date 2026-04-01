import { storageGet, storageSet } from '@platform/storage/local';

export const CHAT_WITH_TAB_REUSE_STORAGE_KEY = 'chat_with_tab_reuse_v1';

export type ChatWithTabReuseEntry = {
  aiTabId: number;
  updatedAt: number;
};

export type ChatWithTabReuseStore = Record<string, ChatWithTabReuseEntry>;

function safeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizePositiveInt(value: unknown): number | null {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return Math.trunc(normalized);
}

function normalizeTimestamp(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return Date.now();
  return Math.trunc(normalized);
}

function normalizeEntry(raw: unknown): ChatWithTabReuseEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const aiTabId = normalizePositiveInt(value.aiTabId);
  if (!aiTabId) return null;
  return {
    aiTabId,
    updatedAt: normalizeTimestamp(value.updatedAt),
  };
}

function normalizeStore(raw: unknown): ChatWithTabReuseStore {
  if (!raw || typeof raw !== 'object') return {};

  const out: ChatWithTabReuseStore = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = safeText(key);
    if (!normalizedKey) continue;
    const normalizedEntry = normalizeEntry(value);
    if (!normalizedEntry) continue;
    out[normalizedKey] = normalizedEntry;
  }
  return out;
}

export function buildChatWithTabReuseKey(platformId: unknown, articleKey: unknown): string {
  const normalizedPlatformId = safeText(platformId).toLowerCase();
  const normalizedArticleKey = safeText(articleKey);
  if (!normalizedPlatformId || !normalizedArticleKey) return '';
  return `${normalizedPlatformId}::${normalizedArticleKey}`;
}

export async function loadChatWithTabReuseStore(): Promise<ChatWithTabReuseStore> {
  const res = await storageGet([CHAT_WITH_TAB_REUSE_STORAGE_KEY]).catch(() => ({}));
  const payload = (res || {}) as Record<string, unknown>;
  return normalizeStore(payload[CHAT_WITH_TAB_REUSE_STORAGE_KEY]);
}

export async function saveChatWithTabReuseStore(store: ChatWithTabReuseStore): Promise<void> {
  await storageSet({
    [CHAT_WITH_TAB_REUSE_STORAGE_KEY]: normalizeStore(store),
  });
}

export async function getChatWithTabReuseEntry(input: {
  platformId: unknown;
  articleKey: unknown;
}): Promise<ChatWithTabReuseEntry | null> {
  const key = buildChatWithTabReuseKey(input?.platformId, input?.articleKey);
  if (!key) return null;

  const store = await loadChatWithTabReuseStore();
  return store[key] || null;
}

export async function setChatWithTabReuseEntry(input: {
  platformId: unknown;
  articleKey: unknown;
  aiTabId: unknown;
  updatedAt?: unknown;
}): Promise<void> {
  const key = buildChatWithTabReuseKey(input?.platformId, input?.articleKey);
  const aiTabId = normalizePositiveInt(input?.aiTabId);
  if (!key || !aiTabId) return;

  const store = await loadChatWithTabReuseStore();
  store[key] = {
    aiTabId,
    updatedAt: normalizeTimestamp(input?.updatedAt),
  };
  await saveChatWithTabReuseStore(store);
}

export async function removeChatWithTabReuseEntry(input: { platformId: unknown; articleKey: unknown }): Promise<void> {
  const key = buildChatWithTabReuseKey(input?.platformId, input?.articleKey);
  if (!key) return;

  const store = await loadChatWithTabReuseStore();
  if (!Object.prototype.hasOwnProperty.call(store, key)) return;
  delete store[key];
  await saveChatWithTabReuseStore(store);
}
