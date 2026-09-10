import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { mountThreadedCommentsPanel } from '@ui/comments';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });

  (dom.window.HTMLElement.prototype as any).attachEvent ||= () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent ||= () => {};
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).getComputedStyle;
}

async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushReactScheduler() {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

function seedOneRootComment(session: ReturnType<typeof createCommentSidebarSession>) {
  session.updateHost({
    comments: [
      {
        id: 1,
        parentId: null,
        conversationId: 21,
        canonicalUrl: 'https://example.com/article',
        authorName: 'You',
        createdAt: 1,
        updatedAt: 1,
        quoteText: 'Quote',
        commentText: 'Root',
        locator: null,
      },
    ],
  });
}

async function exerciseReplyAndDelete(shadow: ShadowRoot, expectedRootId: number) {
  const comment = shadow.querySelector(
    `.webclipper-inpage-comments-panel__thread[data-thread-root-id='${expectedRootId}'] .webclipper-inpage-comments-panel__comment`,
  ) as HTMLElement | null;
  expect(comment).toBeTruthy();
  comment!.click();
  await flushTasks();

  const replyTextarea = shadow.querySelector(
    '.webclipper-inpage-comments-panel__reply-textarea',
  ) as HTMLTextAreaElement | null;
  expect(replyTextarea).toBeTruthy();
  replyTextarea!.value = 'hello reply';
  replyTextarea!.dispatchEvent(new window.Event('input', { bubbles: true }));

  const replySend = replyTextarea!.parentElement?.querySelector(
    '.webclipper-inpage-comments-panel__send',
  ) as HTMLButtonElement | null;
  expect(replySend).toBeTruthy();
  expect(replySend!.disabled).toBe(false);
  replySend!.click();
  await flushTasks();

  const overflowTrigger = shadow.querySelector(
    `.webclipper-inpage-comments-panel__thread[data-thread-root-id='${expectedRootId}'] .webclipper-inpage-comments-panel__comment .webclipper-inpage-comments-panel__overflow-trigger`,
  ) as HTMLButtonElement | null;
  expect(overflowTrigger).toBeTruthy();
  overflowTrigger!.click();
  await flushTasks();

  let deleteButton = shadow.querySelector(
    `button[data-webclipper-comment-delete-id='${expectedRootId}']`,
  ) as HTMLButtonElement | null;
  expect(deleteButton).toBeTruthy();
  deleteButton!.click();
  await flushTasks();
  deleteButton = shadow.querySelector(
    `button[data-webclipper-comment-delete-id='${expectedRootId}']`,
  ) as HTMLButtonElement | null;
  expect(deleteButton).toBeTruthy();
  deleteButton!.click();
  await flushTasks();
}

describe('comment sidebar session handlers binding', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('binds reply/delete handlers when panel attaches with preloaded comments and handlers', async () => {
    const session = createCommentSidebarSession();
    const onReply = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    session.updateHost({ actionCallbacks: { onReply, onDelete } });
    seedOneRootComment(session);
    session.requestOpen();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    const panelLease = session.attachPanel(mounted.api as any);
    await flushReactScheduler();

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel?.shadowRoot).toBeTruthy();
    await exerciseReplyAndDelete(panel!.shadowRoot!, 1);

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(1, 'hello reply');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(1);
    panelLease.dispose();
    mounted.cleanup();
  });

  it('rebinds reply/delete handlers when handlers are set after comments already rendered', async () => {
    const session = createCommentSidebarSession();
    seedOneRootComment(session);
    session.requestOpen();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    const panelLease = session.attachPanel(mounted.api as any);

    const onReply = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    session.updateHost({ actionCallbacks: { onReply, onDelete } });
    await flushReactScheduler();

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel?.shadowRoot).toBeTruthy();
    await exerciseReplyAndDelete(panel!.shadowRoot!, 1);

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(1, 'hello reply');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(1);
    panelLease.dispose();
    mounted.cleanup();
  });

  it('detaches the mounted panel bridge during cleanup', async () => {
    const session = createCommentSidebarSession();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    const panelLease = session.attachPanel(mounted.api as any);
    session.requestOpen({ focusComposer: true });

    mounted.cleanup();
    mounted.cleanup();
    session.requestClose();
    session.updateHost({ busy: true });
    await flushTasks();

    expect(host.querySelector('webclipper-threaded-comments-panel')).toBeNull();
    panelLease.dispose();
    session.dispose();
  });
});
