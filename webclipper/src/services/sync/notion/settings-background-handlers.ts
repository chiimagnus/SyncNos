import { NOTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { storageGet, storageRemove } from '@platform/storage/local';
import { clearNotionOAuthToken, getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import { listNotionParentPages } from '@services/sync/notion/notion-parent-pages.ts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  notionSyncJobStore: { NOTION_SYNC_JOB_KEY?: unknown } | null;
  conversationKinds: { getNotionStorageKeys?: () => unknown[] } | null;
};

function getNotionDisconnectStorageKeys(deps: Deps): string[] {
  const base = [
    'notion_parent_page_id',
    'notion_parent_page_title',
    'notion_oauth_pending_state',
    'notion_oauth_last_error',
  ];

  const notionDbKeys = (() => {
    try {
      const keys = deps.conversationKinds?.getNotionStorageKeys?.();
      if (Array.isArray(keys) && keys.length) return keys.map((k: any) => String(k || '').trim()).filter(Boolean);
    } catch (_e) {
      // ignore
    }
    return ['notion_db_id_syncnos_ai_chats', 'notion_db_id_syncnos_web_articles'];
  })();

  const syncJobKey = deps.notionSyncJobStore?.NOTION_SYNC_JOB_KEY
    ? String(deps.notionSyncJobStore.NOTION_SYNC_JOB_KEY).trim()
    : '';

  return Array.from(new Set([...base, ...notionDbKeys, ...(syncJobKey ? [syncJobKey] : [])]));
}

export function registerNotionSettingsHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, async () => {
    const token = await getNotionOAuthToken();
    return router.ok({
      connected: !!(token && token.accessToken),
      workspaceName: token?.workspaceName ? String(token.workspaceName) : '',
      token: token || null,
    });
  });

  router.register(NOTION_MESSAGE_TYPES.LIST_PARENT_PAGES, async () => {
    const token = await getNotionOAuthToken();
    const accessToken = token?.accessToken ? String(token.accessToken) : '';
    if (!accessToken) return router.err('notion not connected');

    const local = await storageGet(['notion_parent_page_id']).catch(() => ({}));
    const savedPageId = String((local as any)?.notion_parent_page_id || '').trim();

    try {
      const { pages, resolvedSaved } = await listNotionParentPages(accessToken, { savedPageId });
      return router.ok({ pages, resolvedSaved });
    } catch (error: any) {
      return router.err(error?.message ? String(error.message) : 'failed to load pages', {
        code: String(error?.code || '').trim() || null,
        status: Number(error?.status || 0) || null,
      });
    }
  });

  router.register(NOTION_MESSAGE_TYPES.DISCONNECT, async () => {
    await clearNotionOAuthToken();
    const clearedKeys = getNotionDisconnectStorageKeys(deps);
    await storageRemove(clearedKeys);
    return router.ok({ disconnected: true, clearedKeys });
  });
}
