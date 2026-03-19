import { ARTICLE_MESSAGE_TYPES, COMMENTS_MESSAGE_TYPES, CONTENT_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import { getInpageCommentsPanelApi } from '../ui/inpage/inpage-comments-panel-shadow';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeHttpUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function normalizeConversationId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function pickQuoteFromSelection(fallback: string): string {
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

export function registerInpageCommentsPanelContentHandlers(runtime: RuntimeClient | null) {
  const rt = runtime;
  const onMessage = (globalThis as any).chrome?.runtime?.onMessage ?? (globalThis as any).browser?.runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const api = getInpageCommentsPanelApi();

  let activeCanonicalUrl = '';
  let activeConversationId: number | null = null;
  let activeQuoteText = '';

  async function refreshCommentsList() {
    const canonicalUrl = normalizeHttpUrl(activeCanonicalUrl) || normalizeHttpUrl(location.href);
    if (!canonicalUrl) {
      api.setComments([]);
      return;
    }
    if (!rt?.send) {
      api.setComments([]);
      return;
    }
    const res = await rt.send(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, { canonicalUrl });
    if (!res?.ok) {
      api.setComments([]);
      return;
    }
    const items = Array.isArray(res?.data) ? res.data : [];
    api.setComments(
      items.map((c: any) => ({
        id: Number(c?.id),
        authorName: 'You',
        createdAt: Number(c?.createdAt) || null,
        commentText: String(c?.commentText || ''),
      })),
    );
  }

  async function resolveOrCaptureArticle(tabId: number | null) {
    if (!rt?.send) return { canonicalUrl: normalizeHttpUrl(location.href), conversationId: null };
    const res = await rt.send(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, {
      ...(tabId ? { tabId } : null),
    } as any);
    if (!res?.ok) return { canonicalUrl: normalizeHttpUrl(location.href), conversationId: null };
    return {
      canonicalUrl: normalizeHttpUrl(res?.data?.url) || normalizeHttpUrl(location.href),
      conversationId: normalizeConversationId(res?.data?.conversationId),
    };
  }

  function bindPanelHandlers() {
    api.setHandlers({
      onSave: async (text) => {
        const canonicalUrl = normalizeHttpUrl(activeCanonicalUrl) || normalizeHttpUrl(location.href);
        if (!canonicalUrl) return;
        if (!rt?.send) return;
        const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
          canonicalUrl,
          conversationId: activeConversationId,
          quoteText: activeQuoteText,
          commentText: text,
        } as any);
        if (res?.ok) await refreshCommentsList();
      },
      onDelete: async (id) => {
        if (!rt?.send) return;
        const res = await rt.send(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, { id } as any);
        if (res?.ok) await refreshCommentsList();
      },
    });
  }

  bindPanelHandlers();

  const listener = (msg: any, _sender: any, sendResponse: (value: any) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type !== CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL) return undefined;

    // Only handle on top frame to avoid duplicate panels.
    try {
      if (globalThis.top && globalThis.top !== globalThis.self) {
        sendResponse?.({ ok: true });
        return true;
      }
    } catch (_e) {
      // ignore
    }

    const tabId = normalizeConversationId(msg?.payload?.tabId) || null;
    const quoteText = pickQuoteFromSelection(msg?.payload?.selectionText);
    activeQuoteText = quoteText;
    api.setQuoteText(quoteText);
    api.open({ focusEditor: true });

    api.setBusy(true);

    Promise.resolve()
      .then(() => resolveOrCaptureArticle(tabId))
      .then(async ({ canonicalUrl, conversationId }) => {
        activeCanonicalUrl = canonicalUrl;
        activeConversationId = conversationId;
        if (canonicalUrl && conversationId && rt?.send) {
          await rt.send(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, {
            canonicalUrl,
            conversationId,
          } as any);
        }
        await refreshCommentsList();
      })
      .finally(() => {
        api.setBusy(false);
        sendResponse?.({ ok: true });
      });

    return true;
  };

  onMessage.addListener(listener);

  return () => {
    try {
      onMessage.removeListener?.(listener);
    } catch (_e) {
      // ignore
    }
  };
}

