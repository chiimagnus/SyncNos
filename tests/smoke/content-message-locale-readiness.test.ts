import { afterEach, describe, expect, it, vi } from 'vitest';

const openPanel = vi.hoisted(() => vi.fn(async () => {}));
const extractWebArticleFromCurrentPage = vi.hoisted(() => vi.fn(async () => ({ title: 'Article' })));

vi.mock('@services/comments/sidebar/article-comments-sidebar-controller', () => ({
  createArticleCommentsSidebarController: () => ({
    open: openPanel,
    dispose: vi.fn(),
  }),
}));

vi.mock('@collectors/web/article-extract/engine', () => ({
  extractWebArticleFromCurrentPage,
}));

import { CONTENT_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { registerInpageCommentsPanelContentHandlers } from '../../src/services/bootstrap/inpage-comments-panel-content-handlers';
import { registerWebArticleExtractContentHandlers } from '../../src/services/bootstrap/web-article-extract-content-handlers';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
}

function installRuntime() {
  const listeners: Array<(msg: any, sender: any, sendResponse: any) => unknown> = [];
  const addListener = vi.fn((listener: any) => {
    listeners.push(listener);
  });
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener,
        removeListener: vi.fn(),
      },
    },
  };
  return {
    addListener,
    emit(msg: any) {
      let response: any = null;
      let returned: unknown;
      for (const listener of listeners) {
        const next = listener(msg, {}, (value: any) => {
          response = value;
        });
        if (next !== undefined) returned = next;
      }
      return { returned, getResponse: () => response };
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('content message locale readiness', () => {
  it('keeps comments listener registered while panel open waits for locale', async () => {
    const locale = deferred<void>();
    const runtime = installRuntime();

    registerInpageCommentsPanelContentHandlers(null, {
      localeReady: locale.promise,
      createPanelApi: () => ({ attachHost: () => ({ dispose: () => {} }) }),
      domSource: {
        resolveComposerSelection: () => ({ selectionText: '', locator: null }),
        isTopFrame: () => true,
        readPageUrl: () => 'https://example.com/article',
      },
    });

    expect(runtime.addListener).toHaveBeenCalledTimes(1);
    const pending = runtime.emit({
      type: CONTENT_MESSAGE_TYPES.OPEN_INPAGE_COMMENTS_PANEL,
      payload: { tabId: 7 },
    });
    expect(pending.returned).toBe(true);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(openPanel).not.toHaveBeenCalled();

    locale.resolve();
    await waitFor(() => pending.getResponse()?.ok === true);
    expect(openPanel).toHaveBeenCalledTimes(1);
    expect(pending.getResponse()).toEqual({ ok: true });
  });

  it('does not gate article extraction on locale readiness', async () => {
    const locale = deferred<void>();
    const runtime = installRuntime();

    registerWebArticleExtractContentHandlers();
    expect(runtime.addListener).toHaveBeenCalledTimes(1);

    const pending = runtime.emit({
      type: CONTENT_MESSAGE_TYPES.EXTRACT_WEB_ARTICLE,
      payload: {},
    });
    expect(pending.returned).toBe(true);
    await waitFor(() => pending.getResponse()?.ok === true);

    expect(extractWebArticleFromCurrentPage).toHaveBeenCalledTimes(1);
    expect(pending.getResponse()?.ok).toBe(true);
    expect(locale.promise).toBeInstanceOf(Promise);
  });
});
