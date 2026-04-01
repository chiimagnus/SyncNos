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

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function pickQuoteFromSelection(fallback: unknown): string {
  const fromPayload = safeString(fallback);
  if (fromPayload) return fromPayload;
  try {
    const selection = globalThis.getSelection?.();
    const text = selection ? String(selection.toString() || '') : '';
    return text.trim();
  } catch (_e) {
    return '';
  }
}

function pickLocatorFromSelection(): any | null {
  try {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount <= 0) return null;
    const range = selection.getRangeAt(0);
    const text = String(selection.toString() || '').trim();
    if (!text) return null;
    return buildArticleCommentLocatorFromRange({
      env: 'inpage',
      root: document.body || document.documentElement,
      range,
    });
  } catch (_e) {
    return null;
  }
}

export type InpageCommentsPanelController = {
  open: (input?: {
    tabId?: number | null;
    selectionText?: string | null;
    focusComposer?: boolean;
    ensureArticle?: boolean;
  }) => Promise<void>;
};

export function createInpageCommentsPanelController(runtime: RuntimeClient | null): InpageCommentsPanelController {
  const sidebarSession = createCommentSidebarSession(getInpageCommentsPanelApi(runtime));
  const controller = createArticleCommentsSidebarController({
    session: sidebarSession,
    adapter: createArticleCommentsSidebarInpageAdapter(runtime),
  });

  let lastTabId: number | null = null;

  async function open(input?: {
    tabId?: number | null;
    selectionText?: string | null;
    focusComposer?: boolean;
    ensureArticle?: boolean;
  }) {
    // Only handle on top frame to avoid duplicate panels.
    try {
      if (globalThis.top && globalThis.top !== globalThis.self) return;
    } catch (_e) {
      // ignore
    }

    lastTabId = normalizePositiveInt(input?.tabId) || lastTabId;
    const quoteText = pickQuoteFromSelection(input?.selectionText);
    const locator = quoteText ? pickLocatorFromSelection() : null;
    const ensureArticle = input?.ensureArticle !== false;

    await controller.open({
      selectionText: quoteText,
      locator,
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
        selectionText: msg?.payload?.selectionText,
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
