import { CHATWITH_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { tabsCreate } from '@platform/webext/tabs';
import { loadChatWithSettings } from '@services/integrations/chatwith/chatwith-settings';

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

export function registerChatWithBackgroundHandlers(router: AnyRouter) {
  router.register(CHATWITH_MESSAGE_TYPES.OPEN_PLATFORM_TAB, async (msg, sender) => {
    const platformId = normalizePlatformId(msg?.platformId);
    if (!platformId) {
      return router.err('invalid platformId', { code: 'CHATWITH_PLATFORM_ID_REQUIRED' });
    }

    const settings = await loadChatWithSettings();
    const platforms = Array.isArray(settings?.platforms) ? settings.platforms : [];
    const platform = platforms.find((item) => normalizePlatformId(item?.id) === platformId) || null;
    if (!platform || !platform.enabled) {
      return router.err(`platform is not enabled: ${platformId}`, {
        code: 'CHATWITH_PLATFORM_NOT_ENABLED',
        platformId,
      });
    }

    const resolvedUrl = normalizeHttpUrl(platform.url) || normalizeHttpUrl(msg?.fallbackUrl);
    if (!resolvedUrl) {
      return router.err(`invalid platform url: ${platformId}`, {
        code: 'CHATWITH_INVALID_PLATFORM_URL',
        platformId,
      });
    }

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
}
