import { t } from '@i18n';
import { tabsQuery, tabsSendMessage } from '@platform/webext/tabs';
import {
  CONTENT_MESSAGE_TYPES,
  CURRENT_PAGE_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
} from '@platform/messaging/message-contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any, sender?: any) => Promise<any> | any) => void;
};

type UiMessageHandlersOptions = {
  ensureLocaleReady: () => Promise<unknown>;
};

export function registerUiMessageHandlers(router: AnyRouter, options: UiMessageHandlersOptions) {
  const ensureLocaleReady = options.ensureLocaleReady;
  const ensureFallbackLocaleReady = async () => {
    await ensureLocaleReady().catch(() => undefined);
  };
  router.register(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL, async (msg: any, sender: any) => {
    const explicitTabId = Number((msg as any)?.tabId);
    const senderTabId = Number(sender?.tab?.id);
    let tabId =
      Number.isFinite(explicitTabId) && explicitTabId > 0
        ? explicitTabId
        : Number.isFinite(senderTabId) && senderTabId > 0
          ? senderTabId
          : 0;

    if (!Number.isFinite(tabId) || tabId <= 0) {
      const active = await getActiveTabRaw();
      if (active.kind === 'tab') tabId = active.tab.id;
    }

    if (!Number.isFinite(tabId) || tabId <= 0) {
      return router.err('current tab is unavailable', { code: 'OPEN_INPAGE_COMMENTS_PANEL_UNAVAILABLE' });
    }

    try {
      await tabsSendMessage(tabId, {
        type: CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL,
        payload: {
          tabId,
          source: String((msg as any)?.source || 'popup'),
        },
      });
      return router.ok({ opened: true });
    } catch (e) {
      const message = (e as any)?.message ?? String(e ?? 'open inpage comments panel failed');
      return router.err(message, { code: 'OPEN_INPAGE_COMMENTS_PANEL_FAILED' });
    }
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

  router.register(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, async () => {
    const activeTab = await getActiveTabRaw();
    if (activeTab.kind !== 'tab') {
      await ensureFallbackLocaleReady();
      return router.ok(
        unsupportedState(activeTab.kind === 'missing' ? t('activeTabNotFound') : t('currentPageCannotBeCaptured')),
      );
    }

    const relayed = await relayToActiveTab(activeTab.tab.id, CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE);
    if (!relayed.ok) {
      if (relayed.message) return router.err(relayed.message, { code: relayed.code });
      await ensureFallbackLocaleReady();
      return router.err(t('currentPageCannotBeCaptured'), { code: relayed.code });
    }

    return router.ok(relayed.data);
  });

  router.register(UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE, async (msg: any) => {
    const activeTab = await getActiveTabRaw();
    if (activeTab.kind !== 'tab') {
      await ensureFallbackLocaleReady();
      const state = unsupportedState(
        activeTab.kind === 'missing' ? t('activeTabNotFound') : t('currentPageCannotBeCaptured'),
      );
      return router.err(state.reason || t('currentPageCannotBeCaptured'), {
        code: 'CAPTURE_UNAVAILABLE',
        state,
      });
    }

    const relayed = await relayToActiveTab(
      activeTab.tab.id,
      CURRENT_PAGE_MESSAGE_TYPES.CAPTURE,
      msg?.source === 'shortcut' ? { source: 'shortcut' } : undefined,
    );
    if (!relayed.ok) {
      if (relayed.message) {
        return router.err(relayed.message, {
          code: relayed.code,
        });
      }
      await ensureFallbackLocaleReady();
      return router.err(t('currentPageCannotBeCaptured'), {
        code: relayed.code,
      });
    }

    return router.ok(relayed.data);
  });
}

function isHttpUrl(raw: unknown) {
  const url = String(raw || '').trim();
  return /^https?:\/\//i.test(url);
}

function unsupportedState(reason: string) {
  return {
    readiness: 'unsupported',
    kind: 'unsupported',
    label: t('unavailable'),
    collectorId: null,
    reason,
  };
}

async function getActiveTabRaw() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
  const tabId = Number(tab?.id);

  if (!tab || !Number.isFinite(tabId) || tabId <= 0) {
    return { kind: 'missing' as const };
  }

  if (!isHttpUrl(tab.url)) {
    return { kind: 'unsupported-url' as const };
  }

  return { kind: 'tab' as const, tab: { ...tab, id: tabId } };
}

async function relayToActiveTab(tabId: number, type: string, payload?: Record<string, unknown>) {
  try {
    const response = await tabsSendMessage(tabId, payload ? { type, payload } : { type });
    if (!response || typeof response !== 'object') {
      return {
        ok: false as const,
        code: 'CAPTURE_UNAVAILABLE',
        message: '',
      };
    }

    const apiResponse = response as {
      ok?: boolean;
      data?: unknown;
      error?: { message?: unknown; extra?: unknown } | null;
    };
    if (apiResponse.ok) {
      return { ok: true as const, data: apiResponse.data };
    }

    const message = String(apiResponse.error?.message || '').trim();
    return {
      ok: false as const,
      code: 'CAPTURE_FAILED',
      message,
    };
  } catch (_error) {
    return {
      ok: false as const,
      code: 'CAPTURE_UNAVAILABLE',
      message: '',
    };
  }
}
