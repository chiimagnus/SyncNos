import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES, UI_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import { storageRemove } from '../platform/storage/local';
import { clearNotionOAuthToken, getNotionOAuthToken } from '../integrations/notion/token-store';
import { getObsidianSettings, saveObsidianSettings } from '../integrations/obsidian/settings-store';
import { testObsidianConnection } from '../integrations/obsidian/sync/orchestrator';
import { conversationKinds } from '../protocols/conversation-kinds.ts';
import runtimeContext from '../runtime-context.ts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

function getInstanceId(): string {
  try {
    const id = runtimeContext.__backgroundInstanceId;
    return id ? String(id) : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch (_e) {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function getNotionDisconnectStorageKeys(): string[] {
  const base = [
    'notion_parent_page_id',
    'notion_parent_page_title',
    'notion_oauth_pending_state',
    'notion_oauth_last_error',
  ];

  const notionDbKeys = (() => {
    try {
      const keys = conversationKinds.getNotionStorageKeys();
      if (Array.isArray(keys) && keys.length) return keys.map((k: any) => String(k || '').trim()).filter(Boolean);
    } catch (_e) {
      // ignore
    }
    return ['notion_db_id_syncnos_ai_chats', 'notion_db_id_syncnos_web_articles'];
  })();

  const jobStore = runtimeContext.notionSyncJobStore;
  const syncJobKey = jobStore?.NOTION_SYNC_JOB_KEY ? String(jobStore.NOTION_SYNC_JOB_KEY).trim() : '';

  return Array.from(new Set([...base, ...notionDbKeys, ...(syncJobKey ? [syncJobKey] : [])]));
}

export function registerSettingsHandlers(router: AnyRouter) {
  router.register(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, async () => {
    const token = await getNotionOAuthToken();
    return router.ok({ connected: !!(token && token.accessToken), token: token || null });
  });

  router.register(NOTION_MESSAGE_TYPES.DISCONNECT, async () => {
    await clearNotionOAuthToken();
    const clearedKeys = getNotionDisconnectStorageKeys();
    await storageRemove(clearedKeys);
    return router.ok({ disconnected: true, clearedKeys });
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS, async () => {
    const data = await getObsidianSettings();
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, async (msg) => {
    const data = await saveObsidianSettings({
      enabled: msg.enabled,
      apiBaseUrl: msg.apiBaseUrl,
      apiKey: msg.apiKey,
      authHeaderName: msg.authHeaderName,
      chatFolder: msg.chatFolder,
      articleFolder: msg.articleFolder,
    });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION, async () => {
    const data = await testObsidianConnection({ instanceId: getInstanceId() });
    return router.ok(data);
  });

  router.register(UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP, async () => {
    const actionApi = (globalThis as any).chrome?.action ?? (globalThis as any).browser?.action;
    if (!actionApi || typeof actionApi.openPopup !== 'function') {
      return router.err('open popup is not supported in this browser', { code: 'OPEN_POPUP_UNSUPPORTED' });
    }
    try {
      await Promise.resolve(actionApi.openPopup());
      return router.ok({ opened: true });
    } catch (e) {
      const message = (e as any)?.message ?? String(e ?? 'open popup failed');
      return router.err(message, { code: 'OPEN_POPUP_FAILED' });
    }
  });

  router.register(UI_MESSAGE_TYPES.APPLY_INPAGE_VISIBILITY, async () => {
    const api = runtimeContext.backgroundInpageWebVisibility;
    if (!api || typeof api.applyVisibilitySetting !== 'function') {
      return router.err('inpage web visibility manager missing', { code: 'INPAGE_VISIBILITY_UNAVAILABLE' });
    }
    const data = await api.applyVisibilitySetting({ reason: 'app' });
    return router.ok(data);
  });
}
