import { CHATWITH_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { tabsCreate } from '@platform/webext/tabs';
import { getSyncMappingByConversation } from '@services/conversations/data/storage-idb';
import { buildFeishuDocUrl } from '@services/integrations/openin/feishu-openin';
import { buildGithubSyncedMarkdownUrl } from '@services/integrations/openin/github-openin';
import { buildNotionPageUrl } from '@services/integrations/openin/notion-openin';
import { loadChatWithSettings } from '@services/integrations/chatwith/chatwith-settings';
import { normalizePositiveInt } from '@services/shared/numbers';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any, sender?: any) => Promise<any> | any) => void;
};

function safeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizePlatformId(value: unknown): string {
  return safeText(value).toLowerCase();
}

function normalizeHttpUrl(raw: unknown): string {
  const text = safeText(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

async function resolveEnabledPlatform(input: { platformId: string; fallbackUrl?: unknown }) {
  const platformId = normalizePlatformId(input.platformId);
  if (!platformId) {
    return {
      error: {
        message: 'invalid platformId',
        extra: { code: 'CHATWITH_PLATFORM_ID_REQUIRED' },
      },
      platformId: '',
      resolvedUrl: '',
      platform: null,
    };
  }

  const settings = await loadChatWithSettings();
  const platforms = Array.isArray(settings?.platforms) ? settings.platforms : [];
  const platform = platforms.find((item) => normalizePlatformId(item?.id) === platformId) || null;
  if (!platform || !platform.enabled) {
    return {
      error: {
        message: `platform is not enabled: ${platformId}`,
        extra: {
          code: 'CHATWITH_PLATFORM_NOT_ENABLED',
          platformId,
        },
      },
      platformId,
      resolvedUrl: '',
      platform: null,
    };
  }

  const resolvedUrl = normalizeHttpUrl(platform.url) || normalizeHttpUrl(input?.fallbackUrl);
  if (!resolvedUrl) {
    return {
      error: {
        message: `invalid platform url: ${platformId}`,
        extra: {
          code: 'CHATWITH_INVALID_PLATFORM_URL',
          platformId,
        },
      },
      platformId,
      resolvedUrl: '',
      platform,
    };
  }

  return {
    error: null,
    platformId,
    resolvedUrl,
    platform,
  };
}

export function registerChatWithBackgroundHandlers(router: AnyRouter) {
  router.register(CHATWITH_MESSAGE_TYPES.OPEN_PLATFORM_TAB, async (msg, sender) => {
    const resolved = await resolveEnabledPlatform({
      platformId: msg?.platformId,
      fallbackUrl: msg?.fallbackUrl,
    });
    if (resolved.error) {
      return router.err(resolved.error.message, resolved.error.extra);
    }

    const platformId = resolved.platformId;
    const resolvedUrl = resolved.resolvedUrl;

    const senderWindowId = Number(sender?.tab?.windowId);
    const createInput: Record<string, unknown> = {
      url: resolvedUrl,
      active: true,
    };
    if (Number.isFinite(senderWindowId) && senderWindowId > 0) {
      createInput.windowId = senderWindowId;
    }

    try {
      const tab = await tabsCreate(createInput);
      return router.ok({
        tabId: Number(tab?.id) > 0 ? Number(tab?.id) : null,
        windowId:
          Number(tab?.windowId) > 0
            ? Number(tab?.windowId)
            : Number.isFinite(senderWindowId) && senderWindowId > 0
              ? senderWindowId
              : null,
        url: resolvedUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : String(error || `failed to open platform: ${platformId}`);
      return router.err(message, {
        code: 'CHATWITH_OPEN_PLATFORM_FAILED',
        platformId,
        url: resolvedUrl,
      });
    }
  });

  router.register(CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS, async (msg) => {
    const conversationId = normalizePositiveInt(msg?.conversationId);
    if (!conversationId) {
      return router.err('invalid conversationId', { code: 'CHATWITH_CONVERSATION_ID_REQUIRED' });
    }

    const row = await getSyncMappingByConversation(conversationId);
    if (!row?.conversation) {
      return router.err('conversation not found', {
        code: 'CHATWITH_CONVERSATION_NOT_FOUND',
        conversationId,
      });
    }

    const mapping = row.mapping || null;
    const conversation = row.conversation;
    const mappedValue = (field: string) => safeText(mapping?.[field]) || safeText((conversation as any)?.[field]);
    const notionPageId = mappedValue('notionPageId');
    const notionUrl = buildNotionPageUrl(notionPageId, {
      workspaceSlug: mappedValue('notionWorkspaceSlug'),
      pageUrl: mappedValue('notionPageUrl'),
    });
    const feishuUrl = buildFeishuDocUrl(mappedValue('feishuDocId'));
    const githubUrl = buildGithubSyncedMarkdownUrl({ conversation, mapping });

    return router.ok({ notionUrl, feishuUrl, githubUrl });
  });
}
