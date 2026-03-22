import { storageGet, storageSet } from '@platform/storage/local';

export const OBSIDIAN_STORAGE_KEYS = Object.freeze({
  apiBaseUrl: 'obsidian_api_base_url',
  apiKey: 'obsidian_api_key',
  authHeaderName: 'obsidian_api_auth_header_name',
  chatFolder: 'obsidian_chat_folder',
  articleFolder: 'obsidian_article_folder',
});

export const OBSIDIAN_DEFAULTS = Object.freeze({
  apiBaseUrl: 'http://127.0.0.1:27123',
  authHeaderName: 'Authorization',
  chatFolder: 'SyncNos-AIChats',
  articleFolder: 'SyncNos-WebArticles',
});

type SaveSettingsInput = {
  enabled?: boolean;
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  authHeaderName?: unknown;
  chatFolder?: unknown;
  articleFolder?: unknown;
};

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function normalizeBaseUrl(input: unknown): string {
  const normalized = safeString(input);
  return normalized || OBSIDIAN_DEFAULTS.apiBaseUrl;
}

function normalizeAuthHeaderName(input: unknown): string {
  const normalized = safeString(input);
  return normalized || OBSIDIAN_DEFAULTS.authHeaderName;
}

function normalizeFolder(input: unknown, fallbackFolder: unknown): string {
  const raw = safeString(input);
  const fallback = safeString(fallbackFolder);
  const value = raw || fallback;
  if (!value) return '';

  const normalized = value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter((segment) => !!segment && segment !== '.' && segment !== '..')
    .join('/');
  return normalized || fallback || '';
}

export async function getObsidianSettings() {
  const values = await storageGet([
    OBSIDIAN_STORAGE_KEYS.apiBaseUrl,
    OBSIDIAN_STORAGE_KEYS.apiKey,
    OBSIDIAN_STORAGE_KEYS.authHeaderName,
    OBSIDIAN_STORAGE_KEYS.chatFolder,
    OBSIDIAN_STORAGE_KEYS.articleFolder,
  ]);

  const apiBaseUrl = normalizeBaseUrl(values[OBSIDIAN_STORAGE_KEYS.apiBaseUrl]);
  const apiKey = safeString(values[OBSIDIAN_STORAGE_KEYS.apiKey]);
  const authHeaderName = normalizeAuthHeaderName(values[OBSIDIAN_STORAGE_KEYS.authHeaderName]);
  const chatFolder = normalizeFolder(
    values[OBSIDIAN_STORAGE_KEYS.chatFolder],
    OBSIDIAN_DEFAULTS.chatFolder,
  );
  const articleFolder = normalizeFolder(
    values[OBSIDIAN_STORAGE_KEYS.articleFolder],
    OBSIDIAN_DEFAULTS.articleFolder,
  );

  return {
    apiBaseUrl,
    authHeaderName,
    apiKey,
    apiKeyPresent: !!apiKey,
    chatFolder,
    articleFolder,
    apiKeyMasked: apiKey ? '********************************' : '',
  };
}

export async function getObsidianConnectionConfig() {
  const values = await storageGet([
    OBSIDIAN_STORAGE_KEYS.apiBaseUrl,
    OBSIDIAN_STORAGE_KEYS.apiKey,
    OBSIDIAN_STORAGE_KEYS.authHeaderName,
  ]);
  return {
    apiBaseUrl: normalizeBaseUrl(values[OBSIDIAN_STORAGE_KEYS.apiBaseUrl]),
    apiKey: safeString(values[OBSIDIAN_STORAGE_KEYS.apiKey]),
    authHeaderName: normalizeAuthHeaderName(values[OBSIDIAN_STORAGE_KEYS.authHeaderName]),
  };
}

export async function getObsidianPathConfig() {
  const values = await storageGet([
    OBSIDIAN_STORAGE_KEYS.chatFolder,
    OBSIDIAN_STORAGE_KEYS.articleFolder,
  ]);
  return {
    chatFolder: normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.chatFolder], OBSIDIAN_DEFAULTS.chatFolder),
    articleFolder: normalizeFolder(
      values[OBSIDIAN_STORAGE_KEYS.articleFolder],
      OBSIDIAN_DEFAULTS.articleFolder,
    ),
    defaults: {
      chatFolder: OBSIDIAN_DEFAULTS.chatFolder,
      articleFolder: OBSIDIAN_DEFAULTS.articleFolder,
    },
  };
}

export async function saveObsidianSettings(input: SaveSettingsInput = {}) {
  const payload: Record<string, unknown> = {};
  if (input.apiBaseUrl != null) {
    payload[OBSIDIAN_STORAGE_KEYS.apiBaseUrl] = normalizeBaseUrl(input.apiBaseUrl);
  }
  if (input.authHeaderName != null) {
    payload[OBSIDIAN_STORAGE_KEYS.authHeaderName] = normalizeAuthHeaderName(input.authHeaderName);
  }
  if (input.apiKey != null) {
    payload[OBSIDIAN_STORAGE_KEYS.apiKey] = safeString(input.apiKey);
  }
  if (input.chatFolder != null) {
    payload[OBSIDIAN_STORAGE_KEYS.chatFolder] = normalizeFolder(
      input.chatFolder,
      OBSIDIAN_DEFAULTS.chatFolder,
    );
  }
  if (input.articleFolder != null) {
    payload[OBSIDIAN_STORAGE_KEYS.articleFolder] = normalizeFolder(
      input.articleFolder,
      OBSIDIAN_DEFAULTS.articleFolder,
    );
  }

  if (Object.keys(payload).length > 0) await storageSet(payload);
  return getObsidianSettings();
}
