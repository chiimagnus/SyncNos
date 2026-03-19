import { t } from '../../i18n';
import { tabsQuery, tabsSendMessage } from '../webext/tabs';
import { CONTENT_MESSAGE_TYPES, CURRENT_PAGE_MESSAGE_TYPES, UI_MESSAGE_TYPES } from './message-contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any, sender?: any) => Promise<any> | any) => void;
};

export function registerUiMessageHandlers(router: AnyRouter) {
  router.register(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL, async (msg: any, sender: any) => {
    const tabId = Number(sender?.tab?.id);
    if (!Number.isFinite(tabId) || tabId <= 0) {
      return router.err('current tab is unavailable', { code: 'OPEN_INPAGE_COMMENTS_PANEL_UNAVAILABLE' });
    }

    try {
      await tabsSendMessage(tabId, {
        type: CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL,
        payload: {
          tabId,
          selectionText: String((msg as any)?.selectionText || ''),
          source: 'doubleclick',
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
    const activeTab = await getActiveTab();
    if (!activeTab.ok) return router.ok(activeTab.state);

    const relayed = await relayToActiveTab(activeTab.tab.id, CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE);
    if (!relayed.ok) return router.ok(relayed.state);

    return router.ok(relayed.data);
  });

  router.register(UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE, async () => {
    const activeTab = await getActiveTab();
    if (!activeTab.ok) {
      return router.err(activeTab.state.reason || t('currentPageCannotBeCaptured'), {
        code: 'CAPTURE_UNAVAILABLE',
        state: activeTab.state,
      });
    }

    const relayed = await relayToActiveTab(activeTab.tab.id, CURRENT_PAGE_MESSAGE_TYPES.CAPTURE);
    if (!relayed.ok) {
      return router.err(relayed.message, {
        code: relayed.code,
        state: relayed.state,
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
    available: false,
    kind: 'unsupported',
    label: t('unavailable'),
    collectorId: null,
    reason,
  };
}

async function getActiveTab() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
  const tabId = Number(tab?.id);

  if (!tab || !Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false as const, state: unsupportedState(t('activeTabNotFound')) };
  }

  if (!isHttpUrl(tab.url)) {
    return { ok: false as const, state: unsupportedState(t('currentPageCannotBeCaptured')) };
  }

  return { ok: true as const, tab: { ...tab, id: tabId } };
}

async function relayToActiveTab(tabId: number, type: string) {
  try {
    const response = await tabsSendMessage(tabId, { type });
    if (!response || typeof response !== 'object') {
      return {
        ok: false as const,
        code: 'CAPTURE_UNAVAILABLE',
        message: t('currentPageCannotBeCaptured'),
        state: unsupportedState(t('currentPageCannotBeCaptured')),
      };
    }

    const apiResponse = response as { ok?: boolean; data?: unknown; error?: { message?: unknown; extra?: unknown } | null };
    if (apiResponse.ok) {
      return { ok: true as const, data: apiResponse.data };
    }

    const message = String(apiResponse.error?.message || t('currentPageCannotBeCaptured'));
    return {
      ok: false as const,
      code: 'CAPTURE_FAILED',
      message,
      state: unsupportedState(message),
    };
  } catch (_error) {
    return {
      ok: false as const,
      code: 'CAPTURE_UNAVAILABLE',
      message: t('currentPageCannotBeCaptured'),
      state: unsupportedState(t('currentPageCannotBeCaptured')),
    };
  }
}
