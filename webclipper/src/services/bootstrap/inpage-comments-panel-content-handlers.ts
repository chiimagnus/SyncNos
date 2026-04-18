import { CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';
import { createArticleCommentsSidebarController } from '@services/comments/sidebar/article-comments-sidebar-controller';
import { createArticleCommentsSidebarInpageAdapter } from '@services/comments/sidebar/article-comments-sidebar-inpage-adapter';
import { buildArticleCommentLocatorFromRange } from '@services/comments/locator';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { getInpageCommentsPanelApi } from '@ui/inpage/inpage-comments-panel-shadow';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function isSelectionWithinLocatorRoot(selection: Selection | null, locatorRoot: Element | null): boolean {
  if (!selection || !locatorRoot) return false;
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) return false;
  try {
    return locatorRoot.contains(anchorNode) && locatorRoot.contains(focusNode);
  } catch (_e) {
    return false;
  }
}

function pickQuoteFromSelection(): string {
  try {
    const selection = globalThis.getSelection?.();
    const locatorRoot = document.body || document.documentElement;
    if (!isSelectionWithinLocatorRoot(selection || null, locatorRoot)) return '';
    const text = selection ? String(selection.toString() || '') : '';
    return text.trim();
  } catch (_e) {
    return '';
  }
}

function debugSelection(event: string, payload: Record<string, unknown>) {
  const anyGlobal = globalThis as any;
  const enabled =
    anyGlobal.__SYNCNOS_DEBUG_COMMENTS_SELECTION__ === true ||
    (() => {
      try {
        return String(anyGlobal.localStorage?.getItem?.('__SYNCNOS_DEBUG_COMMENTS_SELECTION__') || '') === '1';
      } catch (_e) {
        return false;
      }
    })();
  if (!enabled) return;
  try {
    console.log('[CommentsSelection][inpage]', event, payload);
  } catch (_e) {
    // ignore
  }
}

function pickLocatorFromSelection(): any | null {
  try {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount <= 0) return null;
    const locatorRoot = document.body || document.documentElement;
    if (!isSelectionWithinLocatorRoot(selection, locatorRoot)) return null;
    const range = selection.getRangeAt(0);
    const text = String(selection.toString() || '').trim();
    if (!text) return null;
    return buildArticleCommentLocatorFromRange({
      env: 'inpage',
      root: locatorRoot,
      range,
    });
  } catch (_e) {
    return null;
  }
}

function resolveInpageSelectionPayload(): {
  selectionText: string;
  locator: any | null;
} {
  const selectionText = pickQuoteFromSelection();
  if (!selectionText) {
    debugSelection('resolve_selection', { ok: false, reason: 'empty_text' });
    return { selectionText: '', locator: null };
  }
  const locator = pickLocatorFromSelection();
  debugSelection('resolve_selection', {
    ok: true,
    selectionTextLen: selectionText.length,
    locatorOk: Boolean(locator),
  });
  return {
    selectionText,
    locator,
  };
}

export type InpageCommentsPanelController = {
  open: (input?: { tabId?: number | null; focusComposer?: boolean; ensureArticle?: boolean }) => Promise<void>;
};

export function createInpageCommentsPanelController(runtime: RuntimeClient | null): InpageCommentsPanelController {
  const sidebarSession = createCommentSidebarSession(getInpageCommentsPanelApi(runtime));
  const controller = createArticleCommentsSidebarController({
    session: sidebarSession,
    adapter: createArticleCommentsSidebarInpageAdapter(runtime),
    resolveComposerSelection: () => resolveInpageSelectionPayload(),
  });

  let lastTabId: number | null = null;

  async function open(input?: { tabId?: number | null; focusComposer?: boolean; ensureArticle?: boolean }) {
    // Only handle on top frame to avoid duplicate panels.
    try {
      if (globalThis.top && globalThis.top !== globalThis.self) return;
    } catch (_e) {
      // ignore
    }

    lastTabId = normalizePositiveInt(input?.tabId) || lastTabId;
    const ensureArticle = input?.ensureArticle !== false;

    await controller.open({
      focusComposer: input?.focusComposer === true,
      source: 'inpage',
      ensureContext: true,
      ensureContextInput: {
        tabId: lastTabId,
        canonicalUrlFallback: canonicalizeArticleUrl(location.href),
        ensureArticle,
      },
    });
  }

  return { open };
}

export function registerInpageCommentsPanelContentHandlers(runtime: RuntimeClient | null) {
  const onMessage = (globalThis as any).chrome?.runtime?.onMessage ?? (globalThis as any).browser?.runtime?.onMessage;
  if (!onMessage?.addListener) return { controller: createInpageCommentsPanelController(runtime), cleanup: () => {} };

  const controller = createInpageCommentsPanelController(runtime);

  const listener = (msg: any, _sender: any, sendResponse: (value: any) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type !== CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL) return undefined;

    void controller
      .open({
        tabId: normalizePositiveInt(msg?.payload?.tabId) || null,
        focusComposer: true,
        ensureArticle: true,
      })
      .finally(() => {
        sendResponse?.({ ok: true });
      });

    return true;
  };

  onMessage.addListener(listener);

  const cleanup = () => {
    try {
      onMessage.removeListener?.(listener);
    } catch (_e) {
      // ignore
    }
  };

  return { controller, cleanup };
}
