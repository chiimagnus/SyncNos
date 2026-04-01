import { CHATWITH_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { tabsCreate } from '@platform/webext/tabs';
import { loadChatWithSettings } from '@services/integrations/chatwith/chatwith-settings';
import { openOrFocusGroupedChatTab } from '@services/integrations/chatwith/tabgroup-runner';
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

function normalizeArticleKey(value: unknown): string {
  return safeText(value);
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

  router.register(CHATWITH_MESSAGE_TYPES.OPEN_OR_FOCUS_GROUPED_CHAT_TAB, async (msg, sender) => {
    const resolved = await resolveEnabledPlatform({
      platformId: msg?.platformId,
      fallbackUrl: msg?.fallbackUrl,
    });
    if (resolved.error) {
      return router.err(resolved.error.message, resolved.error.extra);
    }

    const platformId = resolved.platformId;
    const resolvedUrl = resolved.resolvedUrl;
    const articleKey = normalizeArticleKey(msg?.articleKey);
    if (!articleKey) {
      return router.err('invalid articleKey', { code: 'CHATWITH_ARTICLE_KEY_REQUIRED', platformId });
    }

    const articleTabId = normalizePositiveInt(sender?.tab?.id) || normalizePositiveInt(msg?.articleTabId) || null;
    const articleWindowId =
      normalizePositiveInt(sender?.tab?.windowId) || normalizePositiveInt(msg?.articleWindowId) || null;

    try {
      const data = await openOrFocusGroupedChatTab({
        platformId,
        articleKey,
        platformUrl: resolvedUrl,
        articleTabId,
        articleWindowId,
      });
      return router.ok(data);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : String(error || `failed to open grouped chat tab: ${platformId}`);
      return router.err(message, {
        code: 'CHATWITH_OPEN_OR_FOCUS_GROUPED_TAB_FAILED',
        platformId,
        articleKey,
        url: resolvedUrl,
      });
    }
  });
}
