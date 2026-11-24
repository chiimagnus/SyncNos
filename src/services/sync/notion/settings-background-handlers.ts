import { NOTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { getURL } from '@platform/runtime/runtime';
import {
  clearNotionOAuthAttemptAndToken,
  connectNotionInternalToken,
  getNotionOAuthAttemptSummary,
  NOTION_INTERNAL_AUTH_ERRORS,
  startNotionOAuthAttempt,
} from '@services/sync/notion/auth/oauth';
import { getNotionConnectionToken } from '@services/sync/notion/auth/token-store';
import { listNotionParentPages, resolveNotionParentPage } from '@services/sync/notion/notion-parent-pages.ts';
import {
  clearAllNotionSettings,
  getNotionParentPage,
  getNotionSettingsConfig,
  NOTION_DATABASE_KIND_IDS,
  resetNotionDatabaseId,
  setNotionDatabaseId,
  setNotionParentPage,
} from '@services/sync/notion/settings-store';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any, sender?: any) => Promise<any> | any) => void;
};

type Deps = {
  runExclusiveMaintenance: <T>(mutation: () => Promise<T>) => Promise<T>;
  runExclusiveConfigMutation: <T>(mutation: () => Promise<T>) => Promise<T>;
};

function handlerError(router: AnyRouter, error: unknown, fallback: string) {
  const message = String((error as any)?.message ?? error ?? fallback);
  const code = String((error as any)?.extra?.code ?? (error as any)?.code ?? '').trim();
  return code ? router.err(message, { code }) : router.err(message);
}

async function readAuthStatus() {
  const [token, attempt] = await Promise.all([getNotionConnectionToken(), getNotionOAuthAttemptSummary()]);
  return {
    connected: !!token?.accessToken,
    workspaceName: String(token?.workspaceName || ''),
    ...(token?.connectionMethod === 'internal' ? { connectionMethod: 'internal' as const } : {}),
    pending: attempt.pending,
    errorPresent: attempt.errorPresent,
  };
}

export function registerNotionSettingsHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, async () => router.ok(await readAuthStatus()));

  router.register(NOTION_MESSAGE_TYPES.CONNECT_INTERNAL, async (msg, sender) => {
    const base = getURL('');
    if (!base || !String(sender?.url || '').startsWith(base)) {
      return router.err('Notion connection must be configured in SyncNos settings.', { code: 'INVALID_ARGUMENT' });
    }
    try {
      return await deps.runExclusiveConfigMutation(async () => {
        await connectNotionInternalToken(msg?.token);
        return router.ok(await readAuthStatus());
      });
    } catch (error) {
      const code = Object.values(NOTION_INTERNAL_AUTH_ERRORS).find((value) => value === (error as any)?.code);
      // Credential validation failures must never return a raw request or response body.
      return router.err(code || 'notion_internal_connect_failed', { code: code || 'notion_internal_connect_failed' });
    }
  });

  router.register(NOTION_MESSAGE_TYPES.START_AUTH, async () => {
    try {
      return router.ok(await startNotionOAuthAttempt());
    } catch (error) {
      return handlerError(router, error, 'notion oauth start failed');
    }
  });

  router.register(NOTION_MESSAGE_TYPES.GET_CONFIG, async () => {
    try {
      return router.ok(await getNotionSettingsConfig());
    } catch (error) {
      return handlerError(router, error, 'failed to read Notion config');
    }
  });

  router.register(NOTION_MESSAGE_TYPES.SAVE_CONFIG, async (msg) => {
    try {
      return await deps.runExclusiveConfigMutation(async () => {
        const hasParentId = Object.prototype.hasOwnProperty.call(msg || {}, 'parentPageId');
        const hasParentTitle = Object.prototype.hasOwnProperty.call(msg || {}, 'parentPageTitle');
        if (hasParentId || hasParentTitle) {
          const current = await getNotionSettingsConfig();
          const input = hasParentId ? String(msg?.parentPageId ?? '').trim() : current.parentPageId;
          if (hasParentId && input) {
            const token = await getNotionConnectionToken();
            if (!token?.accessToken) return router.err('notion not connected');
            const page = await resolveNotionParentPage(token.accessToken, input);
            await setNotionParentPage(page);
          } else {
            await setNotionParentPage({
              id: input,
              title: hasParentTitle ? msg?.parentPageTitle : current.parentPageTitle,
            });
          }
        }

        const databaseIds = msg?.databaseIds && typeof msg.databaseIds === 'object' ? msg.databaseIds : null;
        if (databaseIds) {
          for (const kindId of NOTION_DATABASE_KIND_IDS) {
            if (!Object.prototype.hasOwnProperty.call(databaseIds, kindId)) continue;
            await setNotionDatabaseId(kindId, databaseIds[kindId]);
          }
        }
        return router.ok(await getNotionSettingsConfig());
      });
    } catch (error) {
      return handlerError(router, error, 'failed to save Notion config');
    }
  });

  router.register(NOTION_MESSAGE_TYPES.RESET_DATABASE_ID, async (msg) => {
    try {
      return await deps.runExclusiveConfigMutation(async () => {
        await resetNotionDatabaseId(msg?.kindId);
        return router.ok(await getNotionSettingsConfig());
      });
    } catch (error) {
      return handlerError(router, error, 'failed to reset Notion database id');
    }
  });

  router.register(NOTION_MESSAGE_TYPES.LIST_PARENT_PAGES, async () => {
    const token = await getNotionConnectionToken();
    const accessToken = token?.accessToken ? String(token.accessToken) : '';
    if (!accessToken) return router.err('notion not connected');

    const savedPageId = (await getNotionParentPage()).id;
    try {
      const { pages, resolvedSaved } = await listNotionParentPages(accessToken, { savedPageId });
      return router.ok({ pages, resolvedSaved });
    } catch (error: any) {
      const status = Number(error?.status || 0) || null;
      const code = String(error?.code || '').trim() || null;
      const requestId = String(error?.requestId || '').trim() || null;

      let message = error?.notionMessage ? String(error.notionMessage) : '';
      if (!message.trim()) message = error?.message ? String(error.message) : 'failed to load pages';

      const retryAfterMs = Number(error?.retryAfterMs || 0) || 0;
      if (status === 429 && retryAfterMs > 0) {
        const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        message = `${message} Retry in about ${seconds}s.`;
      }
      return router.err(message, { code, status, requestId });
    }
  });

  router.register(NOTION_MESSAGE_TYPES.DISCONNECT, async () => {
    try {
      await deps.runExclusiveMaintenance(async () => {
        await clearNotionOAuthAttemptAndToken();
        await clearAllNotionSettings();
      });
      return router.ok({ disconnected: true });
    } catch (error) {
      return handlerError(router, error, 'notion disconnect failed');
    }
  });
}
