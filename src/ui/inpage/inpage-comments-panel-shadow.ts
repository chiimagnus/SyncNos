import {
  createThreadedCommentChatWithConfig,
  mountThreadedCommentsPanel,
  type ThreadedCommentsPanelChatWithAction,
  type ThreadedCommentsPanelCommentChatWithContext,
} from '@ui/comments';
import type { CommentSidebarItem, CommentSidebarPanelApi } from '@services/comments/sidebar/comment-sidebar-contract';
import { createInpageCommentRootSource } from '@ui/comments/inpage-comment-root-source';
import { toDisplayCommentQuote } from '@services/comments/locator/comment-quote-policy';
import type { InpageCommentsDomSource } from '@services/bootstrap/inpage-comments-panel-content-handlers';
import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import {
  CORE_MESSAGE_TYPES,
  ARTICLE_MESSAGE_TYPES,
  CHATWITH_MESSAGE_TYPES,
} from '@services/protocols/message-contracts';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import type { ChatWithOpenPlatformPort } from '@services/integrations/chatwith/chatwith-open-port';
import {
  resolveChatWithCommentsHeaderActions,
  resolveSingleEnabledChatWithActionLabel,
} from '@services/integrations/chatwith/chatwith-comments-header-actions';
import { defaultDetailHeaderActionPort, type DetailHeaderAction } from '@services/integrations/detail-header-actions';

export type InpageCommentItem = CommentSidebarItem;
export type InpageCommentsPanelApi = CommentSidebarPanelApi;

const PANEL_ID = 'webclipper-inpage-comments-panel';

let singleton: { el: HTMLElement; api: CommentSidebarPanelApi } | null = null;
let runtimeClient: RuntimeClient | null = null;

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function openUrlFallback(url: string): boolean {
  const target = safeString(url);
  if (!target || !/^https?:\/\//i.test(target)) return false;
  try {
    globalThis.window?.open(target, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_e) {
    return false;
  }
}

function createInpageChatWithOpenPort(): ChatWithOpenPlatformPort {
  return {
    openPlatform: async (platformId, fallbackUrl) => {
      const normalizedPlatformId = safeString(platformId).toLowerCase();
      const normalizedFallbackUrl = safeString(fallbackUrl);
      if (!normalizedPlatformId) return false;

      const rt = runtimeClient;
      if (!rt?.send) {
        return openUrlFallback(normalizedFallbackUrl);
      }

      const response = await rt.send(CHATWITH_MESSAGE_TYPES.OPEN_PLATFORM_TAB, {
        platformId: normalizedPlatformId,
        fallbackUrl: normalizedFallbackUrl,
      });
      if (response?.ok) return true;

      const message = safeString(response?.error?.message) || `Failed to open platform: ${normalizedPlatformId}`;
      throw new Error(message);
    },
  };
}

function buildConversationFromResolved(input: {
  conversationId: number;
  url: string;
  title: string;
  author: string;
  publishedAt: string;
}): Conversation {
  const canonicalUrl = canonicalizeArticleUrl(input.url) || canonicalizeArticleUrl(globalThis.location?.href);
  const conversationKey = canonicalUrl ? `article:${canonicalUrl}` : `article:${input.conversationId}`;
  return {
    id: Number(input.conversationId),
    sourceType: 'article',
    source: 'web',
    conversationKey,
    url: canonicalUrl || undefined,
    title: safeString(input.title) || canonicalUrl || 'Article',
    author: safeString(input.author) || undefined,
    publishedAt: safeString(input.publishedAt) || undefined,
  };
}

async function resolveInpageChatWithActions(): Promise<ThreadedCommentsPanelChatWithAction[]> {
  const rt = runtimeClient;
  if (!rt?.send) {
    throw new Error('Runtime is unavailable in this page context');
  }

  const resolved = await rt.send(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, {});
  if (!resolved?.ok) {
    throw new Error(safeString(resolved?.error?.message) || 'Failed to resolve current page article');
  }

  const conversationId = normalizePositiveInt(resolved?.data?.conversationId);
  if (!conversationId) {
    throw new Error('No article conversation is available for this page');
  }

  const detailRes = await rt.send(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, { conversationId });
  if (!detailRes?.ok) {
    throw new Error(safeString(detailRes?.error?.message) || 'Failed to load conversation detail');
  }
  const detail = detailRes.data as ConversationDetail | null;
  if (!detail || !Array.isArray(detail.messages) || !detail.messages.length) {
    throw new Error('Conversation detail is not ready yet');
  }

  const conversation = buildConversationFromResolved({
    conversationId,
    url: resolved?.data?.url,
    title: resolved?.data?.title,
    author: resolved?.data?.author,
    publishedAt: resolved?.data?.publishedAt,
  });

  const actions: DetailHeaderAction[] = await resolveChatWithCommentsHeaderActions({
    conversation,
    detail,
    port: defaultDetailHeaderActionPort,
    openPort: createInpageChatWithOpenPort(),
  });

  const mapped: ThreadedCommentsPanelChatWithAction[] = [];
  for (const action of actions) {
    const id = safeString((action as any)?.id);
    const label = safeString((action as any)?.label);
    const onTrigger = (action as any)?.onTrigger;
    if (!id || !label || typeof onTrigger !== 'function') continue;
    mapped.push({
      id,
      label,
      disabled: Boolean((action as any)?.disabled),
      onTrigger: () => onTrigger(),
    });
  }
  return mapped;
}

async function resolveInpageCommentChatWithContext(): Promise<ThreadedCommentsPanelCommentChatWithContext> {
  const rt = runtimeClient;
  if (!rt?.send) {
    throw new Error('Runtime is unavailable in this page context');
  }

  const resolved = await rt.send(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, {});
  if (!resolved?.ok) {
    throw new Error(safeString(resolved?.error?.message) || 'Failed to resolve current page article');
  }

  return {
    articleTitle: safeString(resolved?.data?.title),
    canonicalUrl: canonicalizeArticleUrl(resolved?.data?.url) || canonicalizeArticleUrl(globalThis.location?.href),
  };
}

const inpageCommentChatWithConfig = createThreadedCommentChatWithConfig({
  resolveContext: resolveInpageCommentChatWithContext,
  resolveOpenPort: () => createInpageChatWithOpenPort(),
});

function isCommentsSelectionDebugEnabled(): boolean {
  const anyGlobal = globalThis as any;
  if (anyGlobal.__SYNCNOS_DEBUG_COMMENTS_SELECTION__ === true) return true;
  try {
    const storage = anyGlobal.window?.localStorage;
    return String(storage?.getItem?.('__SYNCNOS_DEBUG_COMMENTS_SELECTION__') || '') === '1';
  } catch (_e) {
    return false;
  }
}

function debugInpagePanel(event: string, payload: Record<string, unknown>) {
  if (!isCommentsSelectionDebugEnabled()) return;
  try {
    console.log('[CommentsSelection][inpage-panel]', event, payload);
  } catch (_e) {
    // ignore
  }
}

function ensurePanel(): { el: HTMLElement; api: CommentSidebarPanelApi } {
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing && (existing as any).__webclipperPanelApi) {
    singleton = { el: existing, api: (existing as any).__webclipperPanelApi as CommentSidebarPanelApi };
    debugInpagePanel('ensure_existing_panel', { ok: true });
    return singleton;
  }

  const host = document.documentElement;
  const rootSource = createInpageCommentRootSource({
    document,
    getPanelRoot: () => singleton?.el || null,
  });
  const { el, api } = mountThreadedCommentsPanel(host, {
    overlay: true,
    dockPage: true,
    initiallyOpen: false,
    variant: 'sidebar',
    surface: 'inpage',
    surfaceBg: 'var(--bg-card)',
    showHeader: true,
    showCollapseButton: true,
    locatorEnv: 'inpage',
    getLocatorSurfaceRoots: () => rootSource.capture(document.getSelection()),
    getLocatorRoots: (locator) => rootSource.locate(locator),
    chatWith: {
      resolveActions: resolveInpageChatWithActions,
      resolveSingleActionLabel: resolveSingleEnabledChatWithActionLabel,
    },
    commentChatWith: inpageCommentChatWithConfig,
  });
  el.id = PANEL_ID;

  (el as any).__webclipperPanelApi = api;
  singleton = { el, api };
  debugInpagePanel('ensure_new_panel', {
    ok: true,
    viewportWidth: Number(globalThis.innerWidth || 0) || 0,
  });
  return singleton;
}

const apiRef: InpageCommentsPanelApi = {
  attachHost(host) {
    debugInpagePanel('attach_host', {});
    return ensurePanel().api.attachHost(host);
  },
};

export function createInpageCommentsDomSource(input: {
  window: Window;
  document: Document;
  getPanelRoot?: () => Element | null;
}): InpageCommentsDomSource {
  const rootSource = createInpageCommentRootSource({
    document: input.document,
    getPanelRoot: input.getPanelRoot,
  });

  return {
    resolveComposerSelection() {
      try {
        const selection = input.document.getSelection();
        const roots = rootSource.capture(selection);
        if (!selection || selection.rangeCount !== 1 || !roots) return { selectionText: '', locator: null };
        const range = selection.getRangeAt(0);
        const selectionText = toDisplayCommentQuote(range.toString());
        if (!selectionText) return { selectionText: '', locator: null };
        const locator = rootSource.captureAnchor(selection);
        return { selectionText, locator };
      } catch (_error) {
        return { selectionText: '', locator: null };
      }
    },
    isTopFrame() {
      try {
        return input.window.top === input.window.self;
      } catch (_error) {
        return false;
      }
    },
    readPageUrl() {
      return String(input.window.location?.href || '');
    },
  };
}

export function getInpageCommentsPanelApi(runtime?: RuntimeClient | null): InpageCommentsPanelApi {
  if (runtime && typeof runtime.send === 'function') {
    runtimeClient = runtime;
  }
  return apiRef;
}
