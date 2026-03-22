import { ARTICLE_MESSAGE_TYPES, COMMENTS_MESSAGE_TYPES, CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';
import { getInpageCommentsPanelApi } from '@ui/inpage/inpage-comments-panel-shadow';

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

export type InpageCommentsPanelController = {
  open: (input?: { tabId?: number | null; selectionText?: string | null; focusComposer?: boolean; ensureArticle?: boolean }) => Promise<void>;
};

export function createInpageCommentsPanelController(runtime: RuntimeClient | null): InpageCommentsPanelController {
  const rt = runtime;
  const sidebarSession = createCommentSidebarSession(getInpageCommentsPanelApi());

  let activeCanonicalUrl = '';
  let activeConversationId: number | null = null;
  let lastTabId: number | null = null;

  async function refreshCommentsList() {
    const canonicalUrl = normalizeHttpUrl(activeCanonicalUrl) || normalizeHttpUrl(location.href);
    if (!canonicalUrl) {
      sidebarSession.setComments([]);
      return;
    }
    if (!rt?.send) {
      sidebarSession.setComments([]);
      return;
    }
    const res = await rt.send(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, { canonicalUrl });
    if (!res?.ok) {
      sidebarSession.setComments([]);
      return;
    }
    const items = Array.isArray(res?.data) ? res.data : [];
    sidebarSession.setComments(
      items.map((c: any) => ({
        id: Number(c?.id),
        parentId: c?.parentId != null ? Number(c.parentId) : null,
        authorName: 'You',
        createdAt: Number(c?.createdAt) || null,
        quoteText: String(c?.quoteText || ''),
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
    sidebarSession.setHandlers({
      onSave: async (text) => {
        if (!rt?.send) return;
        let canonicalUrl = normalizeHttpUrl(activeCanonicalUrl) || normalizeHttpUrl(location.href);
        if (!canonicalUrl) return;
        const quoteText = sidebarSession.getSnapshot().quoteText;

        if (!activeConversationId) {
          const resolved = await resolveOrCaptureArticle(lastTabId);
          canonicalUrl = normalizeHttpUrl(resolved.canonicalUrl) || canonicalUrl;
          activeCanonicalUrl = canonicalUrl;
          activeConversationId = resolved.conversationId;
          if (canonicalUrl && activeConversationId) {
            await rt.send(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, {
              canonicalUrl,
              conversationId: activeConversationId,
            } as any);
          }
        }

        const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
          canonicalUrl,
          conversationId: activeConversationId,
          quoteText,
          commentText: text,
        } as any);
        if (res?.ok) await refreshCommentsList();
      },
      onReply: async (parentId, text) => {
        if (!rt?.send) return;
        let canonicalUrl = normalizeHttpUrl(activeCanonicalUrl) || normalizeHttpUrl(location.href);
        if (!canonicalUrl) return;

        if (!activeConversationId) {
          const resolved = await resolveOrCaptureArticle(lastTabId);
          canonicalUrl = normalizeHttpUrl(resolved.canonicalUrl) || canonicalUrl;
          activeCanonicalUrl = canonicalUrl;
          activeConversationId = resolved.conversationId;
          if (canonicalUrl && activeConversationId) {
            await rt.send(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, {
              canonicalUrl,
              conversationId: activeConversationId,
            } as any);
          }
        }

        const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
          canonicalUrl,
          conversationId: activeConversationId,
          parentId: Number(parentId),
          quoteText: '',
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

  async function open(input?: { tabId?: number | null; selectionText?: string | null; focusComposer?: boolean; ensureArticle?: boolean }) {
    // Only handle on top frame to avoid duplicate panels.
    try {
      if (globalThis.top && globalThis.top !== globalThis.self) return;
    } catch (_e) {
      // ignore
    }

    lastTabId = normalizeConversationId(input?.tabId) || lastTabId;
    const quoteText = pickQuoteFromSelection(input?.selectionText);
    sidebarSession.setQuoteText(quoteText);
    sidebarSession.requestOpen({ focusComposer: input?.focusComposer === true, source: 'inpage' });

    const ensureArticle = input?.ensureArticle !== false;
    sidebarSession.setBusy(true);
    try {
      if (ensureArticle) {
        const resolved = await resolveOrCaptureArticle(lastTabId);
        activeCanonicalUrl = resolved.canonicalUrl;
        activeConversationId = resolved.conversationId;
        if (activeCanonicalUrl && activeConversationId && rt?.send) {
          await rt.send(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, {
            canonicalUrl: activeCanonicalUrl,
            conversationId: activeConversationId,
          } as any);
        }
      } else {
        activeCanonicalUrl = normalizeHttpUrl(location.href);
        activeConversationId = null;
      }
      await refreshCommentsList();
    } finally {
      sidebarSession.setBusy(false);
    }
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
        tabId: normalizeConversationId(msg?.payload?.tabId) || null,
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
