import { conversationKinds } from '@services/protocols/conversation-kinds.ts';
import { storageGet, storageSet } from '@platform/storage/local';

export const FEISHU_STORAGE_KEYS = Object.freeze({
  chatFolder: 'feishu_chat_folder',
  articleFolder: 'feishu_article_folder',
  videoFolder: 'feishu_video_folder',
});

export const FEISHU_DEFAULTS = Object.freeze({
  chatFolder: 'SyncNos-AIChats',
  articleFolder: 'SyncNos-WebArticles',
  videoFolder: 'SyncNos-Videos',
});

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

export function normalizeFeishuFolderPath(input: unknown, fallbackFolder?: unknown): string {
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

export type FeishuPathConfig = {
  chatFolder: string;
  articleFolder: string;
  videoFolder: string;
  defaults: {
    chatFolder: string;
    articleFolder: string;
    videoFolder: string;
  };
};

export async function getFeishuPathConfig(): Promise<FeishuPathConfig> {
  const values = await storageGet([
    FEISHU_STORAGE_KEYS.chatFolder,
    FEISHU_STORAGE_KEYS.articleFolder,
    FEISHU_STORAGE_KEYS.videoFolder,
  ]);

  return {
    chatFolder: normalizeFeishuFolderPath(values[FEISHU_STORAGE_KEYS.chatFolder], FEISHU_DEFAULTS.chatFolder),
    articleFolder: normalizeFeishuFolderPath(values[FEISHU_STORAGE_KEYS.articleFolder], FEISHU_DEFAULTS.articleFolder),
    videoFolder: normalizeFeishuFolderPath(values[FEISHU_STORAGE_KEYS.videoFolder], FEISHU_DEFAULTS.videoFolder),
    defaults: {
      chatFolder: FEISHU_DEFAULTS.chatFolder,
      articleFolder: FEISHU_DEFAULTS.articleFolder,
      videoFolder: FEISHU_DEFAULTS.videoFolder,
    },
  };
}

export async function saveFeishuPathConfig(
  input: {
    chatFolder?: unknown;
    articleFolder?: unknown;
    videoFolder?: unknown;
  } = {},
): Promise<FeishuPathConfig> {
  const payload: Record<string, unknown> = {};
  if (input.chatFolder != null) {
    payload[FEISHU_STORAGE_KEYS.chatFolder] = normalizeFeishuFolderPath(input.chatFolder, FEISHU_DEFAULTS.chatFolder);
  }
  if (input.articleFolder != null) {
    payload[FEISHU_STORAGE_KEYS.articleFolder] = normalizeFeishuFolderPath(
      input.articleFolder,
      FEISHU_DEFAULTS.articleFolder,
    );
  }
  if (input.videoFolder != null) {
    payload[FEISHU_STORAGE_KEYS.videoFolder] = normalizeFeishuFolderPath(
      input.videoFolder,
      FEISHU_DEFAULTS.videoFolder,
    );
  }

  if (Object.keys(payload).length > 0) await storageSet(payload);
  return getFeishuPathConfig();
}

export function pickFeishuFolderPathForConversation(conversation: any, config: FeishuPathConfig): string {
  try {
    const kind =
      conversationKinds && typeof conversationKinds.pick === 'function' ? conversationKinds.pick(conversation) : null;
    const kindId = kind && (kind as any).id ? safeString((kind as any).id) : '';
    if (kindId === 'article')
      return safeString((config as any).articleFolder) || safeString(config.defaults.articleFolder);
    if (kindId === 'video') return safeString((config as any).videoFolder) || safeString(config.defaults.videoFolder);
    return safeString((config as any).chatFolder) || safeString(config.defaults.chatFolder);
  } catch (_e) {
    return safeString(config?.chatFolder) || safeString(config?.defaults?.chatFolder) || FEISHU_DEFAULTS.chatFolder;
  }
}
