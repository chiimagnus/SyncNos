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
import { resolveNotionDatabaseId } from '@services/sync/notion/notion-db-manager';
import { normalizeNotionId } from '@services/shared/notion-id';
import { normalizeNotionIdInput } from '@services/sync/notion/notion-id-utils';
import { listNotionParentPages, resolveNotionParentPage } from '@services/sync/notion/notion-parent-pages.ts';
import {
  clearAllNotionSettings,
  getNotionParentPage,
  getNotionSettingsConfig,
  NOTION_DATABASE_KIND_IDS,
  type NotionDatabaseKindId,
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
        const current = await getNotionSettingsConfig();
        const token = await getNotionConnectionToken();
        const parentInput = hasParentId ? String(msg?.parentPageId ?? '').trim() : current.parentPageId;
        let parent = {
          id: parentInput,
          title: hasParentTitle ? String(msg?.parentPageTitle ?? '').trim() : current.parentPageTitle,
        };
        if (hasParentId && parentInput) {
          if (!token?.accessToken) return router.err('notion not connected');
          parent = await resolveNotionParentPage(token.accessToken, parentInput);
        }

        // Validate every new destination before writing any of the settings.
        const updates: [NotionDatabaseKindId, string][] = [];
        const databaseIds = msg?.databaseIds && typeof msg.databaseIds === 'object' ? msg.databaseIds : null;
        if (databaseIds) {
          for (const kindId of NOTION_DATABASE_KIND_IDS) {
            if (!Object.prototype.hasOwnProperty.call(databaseIds, kindId)) continue;
            const raw = String(databaseIds[kindId] ?? '').trim();
            if (!raw) {
              updates.push([kindId, '']);
              continue;
            }
            const id = normalizeNotionIdInput(raw);
            if (!id) return router.err('Enter a database link or ID.', { code: 'invalid_notion_database_id' });
            const unchanged =
              id === normalizeNotionId(current.databaseIds[kindId]) &&
              parent.id &&
              normalizeNotionId(parent.id) === normalizeNotionId(current.parentPageId);
            if (!unchanged) {
              if (!token?.accessToken) return router.err('notion not connected');
              await resolveNotionDatabaseId(token.accessToken, id, parent.id);
            }
            updates.push([kindId, id]);
          }
        }
        if (hasParentId || hasParentTitle) await setNotionParentPage(parent);
        for (const [kindId, id] of updates) await setNotionDatabaseId(kindId, id);
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
