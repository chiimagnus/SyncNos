import {
  mountThreadedCommentsPanel,
  type ThreadedCommentItem,
  type ThreadedCommentsPanelChatWithAction,
} from '@ui/comments';
import type { CommentSidebarPanelApi } from '@services/comments/sidebar/comment-sidebar-contract';
import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { CORE_MESSAGE_TYPES, ARTICLE_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import {
  resolveChatWithDetailHeaderActions,
  resolveSingleEnabledChatWithActionLabel,
} from '@services/integrations/chatwith/chatwith-detail-header-actions';
import { defaultDetailHeaderActionPort, type DetailHeaderAction } from '@services/integrations/detail-header-actions';

export type InpageCommentItem = ThreadedCommentItem;
export type InpageCommentsPanelOpenInput = {
  focusComposer?: boolean;
};

export type InpageCommentsPanelApi = Omit<CommentSidebarPanelApi, 'open'> & {
  open: (input?: InpageCommentsPanelOpenInput) => void;
};

const PANEL_ID = 'webclipper-inpage-comments-panel';

let singleton: { el: HTMLElement; api: CommentSidebarPanelApi } | null = null;
let runtimeClient: RuntimeClient | null = null;

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function safeString(value: unknown): string {
  return String(value || '').trim();
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

  const actions: DetailHeaderAction[] = await resolveChatWithDetailHeaderActions({
    conversation,
    detail,
    port: defaultDetailHeaderActionPort,
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

function ensurePanel(): { el: HTMLElement; api: CommentSidebarPanelApi } {
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing && (existing as any).__webclipperPanelApi) {
    singleton = { el: existing, api: (existing as any).__webclipperPanelApi as CommentSidebarPanelApi };
    return singleton;
  }

  const host = document.documentElement;
  const { el, api } = mountThreadedCommentsPanel(host, {
    overlay: true,
    dockPage: true,
    initiallyOpen: false,
    variant: 'sidebar',
    surfaceBg: 'var(--bg-card)',
    showHeader: true,
    showCollapseButton: true,
    locatorEnv: 'inpage',
    getLocatorRoot: () => document.body || document.documentElement,
    chatWith: {
      resolveActions: resolveInpageChatWithActions,
      resolveSingleActionLabel: resolveSingleEnabledChatWithActionLabel,
    },
  });
  el.id = PANEL_ID;

  (el as any).__webclipperPanelApi = api;
  singleton = { el, api };
  return singleton;
}

const apiRef: InpageCommentsPanelApi = {
  open(input) {
    const { api } = ensurePanel();
    api.open({ focusComposer: input?.focusComposer === true });
  },
  close() {
    if (!singleton) return;
    singleton.api.close();
  },
  isOpen() {
    if (!singleton) return false;
    return singleton.api.isOpen();
  },
  setBusy(busy) {
    ensurePanel().api.setBusy(busy);
  },
  setQuoteText(text) {
    ensurePanel().api.setQuoteText(text);
  },
  setComments(items) {
    ensurePanel().api.setComments(items);
  },
  setHandlers(handlers) {
    ensurePanel().api.setHandlers(handlers as any);
  },
};

export function getInpageCommentsPanelApi(runtime?: RuntimeClient | null): InpageCommentsPanelApi {
  if (runtime && typeof runtime.send === 'function') {
    runtimeClient = runtime;
  }
  return apiRef;
}
