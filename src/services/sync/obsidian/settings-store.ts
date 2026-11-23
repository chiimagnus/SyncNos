import { storageGet, storageSet } from '@platform/storage/local';
import {
  DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER,
  normalizeAttachmentFolder,
} from '@services/sync/obsidian/obsidian-attachment-path';

export const OBSIDIAN_STORAGE_KEYS = Object.freeze({
  apiBaseUrl: 'obsidian_api_base_url',
  apiKey: 'obsidian_api_key',
  authHeaderName: 'obsidian_api_auth_header_name',
  chatFolder: 'obsidian_chat_folder',
  articleFolder: 'obsidian_article_folder',
  videoFolder: 'obsidian_video_folder',
  chatAttachmentFolder: 'obsidian_chat_attachment_folder',
  articleAttachmentFolder: 'obsidian_article_attachment_folder',
  videoAttachmentFolder: 'obsidian_video_attachment_folder',
});

export const OBSIDIAN_DEFAULTS = Object.freeze({
  apiBaseUrl: 'http://127.0.0.1:27123',
  authHeaderName: 'Authorization',
  chatFolder: 'SyncNos-AIChats',
  articleFolder: 'SyncNos-WebArticles',
  videoFolder: 'SyncNos-Videos',
  chatAttachmentFolder: DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER,
  articleAttachmentFolder: DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER,
  videoAttachmentFolder: DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER,
});

type SaveSettingsInput = {
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  authHeaderName?: unknown;
  chatFolder?: unknown;
  articleFolder?: unknown;
  videoFolder?: unknown;
  chatAttachmentFolder?: unknown;
  articleAttachmentFolder?: unknown;
  videoAttachmentFolder?: unknown;
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
    OBSIDIAN_STORAGE_KEYS.videoFolder,
    OBSIDIAN_STORAGE_KEYS.chatAttachmentFolder,
    OBSIDIAN_STORAGE_KEYS.articleAttachmentFolder,
    OBSIDIAN_STORAGE_KEYS.videoAttachmentFolder,
  ]);

  const apiBaseUrl = normalizeBaseUrl(values[OBSIDIAN_STORAGE_KEYS.apiBaseUrl]);
  const apiKey = safeString(values[OBSIDIAN_STORAGE_KEYS.apiKey]);
  const authHeaderName = normalizeAuthHeaderName(values[OBSIDIAN_STORAGE_KEYS.authHeaderName]);
  const chatFolder = normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.chatFolder], OBSIDIAN_DEFAULTS.chatFolder);
  const articleFolder = normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.articleFolder], OBSIDIAN_DEFAULTS.articleFolder);
  const videoFolder = normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.videoFolder], OBSIDIAN_DEFAULTS.videoFolder);
  const chatAttachmentFolder = normalizeAttachmentFolder(values[OBSIDIAN_STORAGE_KEYS.chatAttachmentFolder]);
  const articleAttachmentFolder = normalizeAttachmentFolder(values[OBSIDIAN_STORAGE_KEYS.articleAttachmentFolder]);
  const videoAttachmentFolder = normalizeAttachmentFolder(values[OBSIDIAN_STORAGE_KEYS.videoAttachmentFolder]);

  return {
    apiBaseUrl,
    authHeaderName,
    apiKeyPresent: !!apiKey,
    chatFolder,
    articleFolder,
    videoFolder,
    chatAttachmentFolder,
    articleAttachmentFolder,
    videoAttachmentFolder,
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
    OBSIDIAN_STORAGE_KEYS.videoFolder,
    OBSIDIAN_STORAGE_KEYS.chatAttachmentFolder,
    OBSIDIAN_STORAGE_KEYS.articleAttachmentFolder,
    OBSIDIAN_STORAGE_KEYS.videoAttachmentFolder,
  ]);
  return {
    chatFolder: normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.chatFolder], OBSIDIAN_DEFAULTS.chatFolder),
    articleFolder: normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.articleFolder], OBSIDIAN_DEFAULTS.articleFolder),
    videoFolder: normalizeFolder(values[OBSIDIAN_STORAGE_KEYS.videoFolder], OBSIDIAN_DEFAULTS.videoFolder),
    chatAttachmentFolder: normalizeAttachmentFolder(values[OBSIDIAN_STORAGE_KEYS.chatAttachmentFolder]),
    articleAttachmentFolder: normalizeAttachmentFolder(values[OBSIDIAN_STORAGE_KEYS.articleAttachmentFolder]),
    videoAttachmentFolder: normalizeAttachmentFolder(values[OBSIDIAN_STORAGE_KEYS.videoAttachmentFolder]),
    defaults: {
      chatFolder: OBSIDIAN_DEFAULTS.chatFolder,
      articleFolder: OBSIDIAN_DEFAULTS.articleFolder,
      videoFolder: OBSIDIAN_DEFAULTS.videoFolder,
      chatAttachmentFolder: OBSIDIAN_DEFAULTS.chatAttachmentFolder,
      articleAttachmentFolder: OBSIDIAN_DEFAULTS.articleAttachmentFolder,
      videoAttachmentFolder: OBSIDIAN_DEFAULTS.videoAttachmentFolder,
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
    payload[OBSIDIAN_STORAGE_KEYS.chatFolder] = normalizeFolder(input.chatFolder, OBSIDIAN_DEFAULTS.chatFolder);
  }
  if (input.articleFolder != null) {
    payload[OBSIDIAN_STORAGE_KEYS.articleFolder] = normalizeFolder(
      input.articleFolder,
      OBSIDIAN_DEFAULTS.articleFolder,
    );
  }
  if (input.videoFolder != null) {
    payload[OBSIDIAN_STORAGE_KEYS.videoFolder] = normalizeFolder(input.videoFolder, OBSIDIAN_DEFAULTS.videoFolder);
  }
  for (const field of ['chatAttachmentFolder', 'articleAttachmentFolder', 'videoAttachmentFolder'] as const) {
    if (input[field] != null) payload[OBSIDIAN_STORAGE_KEYS[field]] = normalizeAttachmentFolder(input[field]);
  }

  if (Object.keys(payload).length > 0) await storageSet(payload);
  return getObsidianSettings();
}
