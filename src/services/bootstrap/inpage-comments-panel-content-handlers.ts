import { CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';
import { createArticleCommentsSidebarController } from '@services/comments/sidebar/article-comments-sidebar-controller';
import { createArticleCommentsSidebarInpageAdapter } from '@services/comments/sidebar/article-comments-sidebar-inpage-adapter';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import type { CommentSidebarPanelApi } from '@services/comments/sidebar/comment-sidebar-contract';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

export type InpageCommentsDomSource = {
  resolveComposerSelection: () => { selectionText: string; locator: unknown | null };
  isTopFrame: () => boolean;
  readPageUrl: () => string;
};

export type InpageCommentsPanelController = {
  open: (input?: { tabId?: number | null; focusComposer?: boolean; ensureArticle?: boolean }) => Promise<void>;
  dispose: () => void;
};

export type InpageCommentsPanelDeps = {
  localeReady?: Promise<unknown>;
  domSource: InpageCommentsDomSource;
  // Injected from the entrypoint (UI layer) so that `services` never imports `ui`
  // directly, preserving the one-way layering rule in AGENTS.md.
  createPanelApi: (runtime: RuntimeClient | null) => CommentSidebarPanelApi;
};

export function createInpageCommentsPanelController(
  runtime: RuntimeClient | null,
  deps: InpageCommentsPanelDeps,
): InpageCommentsPanelController {
  const sidebarSession = createCommentSidebarSession(deps.createPanelApi(runtime));
  const controller = createArticleCommentsSidebarController({
    session: sidebarSession,
    adapter: createArticleCommentsSidebarInpageAdapter(runtime),
    resolveComposerSelection: deps.domSource.resolveComposerSelection,
  });

  let lastTabId: number | null = null;
  let disposed = false;

  async function open(input?: { tabId?: number | null; focusComposer?: boolean; ensureArticle?: boolean }) {
    if (disposed) return;
    // Only handle on top frame to avoid duplicate panels.
    if (!deps.domSource.isTopFrame()) return;

    lastTabId = normalizePositiveInt(input?.tabId) || lastTabId;
    const ensureArticle = input?.ensureArticle !== false;

    await controller.open({
      focusComposer: input?.focusComposer === true,
      source: 'inpage',
      ensureContext: true,
      ensureContextInput: {
        tabId: lastTabId,
        canonicalUrlFallback: canonicalizeArticleUrl(deps.domSource.readPageUrl()),
        ensureArticle,
      },
    });
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.dispose();
    sidebarSession.dispose();
  };

  return { open, dispose };
}

export function registerInpageCommentsPanelContentHandlers(
  runtime: RuntimeClient | null,
  deps: InpageCommentsPanelDeps,
) {
  const onMessage = (globalThis as any).chrome?.runtime?.onMessage ?? (globalThis as any).browser?.runtime?.onMessage;
  if (!onMessage?.addListener) {
    const controller = createInpageCommentsPanelController(runtime, deps);
    return { controller, cleanup: () => controller.dispose() };
  }

  const controller = createInpageCommentsPanelController(runtime, deps);

  const listener = (msg: any, _sender: any, sendResponse: (value: any) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type !== CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL) return undefined;

    void Promise.resolve(deps.localeReady)
      .catch(() => undefined)
      .then(() =>
        controller.open({
          tabId: normalizePositiveInt(msg?.payload?.tabId) || null,
          focusComposer: true,
          ensureArticle: true,
        }),
      )
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
    controller.dispose();
  };

  return { controller, cleanup };
}
