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

function seedOneRootComment(session: ReturnType<typeof createCommentSidebarSession>) {
  session.setComments([
    {
      id: 1,
      parentId: null,
      authorName: 'You',
      createdAt: 1,
      quoteText: 'Quote',
      commentText: 'Root',
      locator: null,
    },
  ]);
}

async function exerciseReplyAndDelete(shadow: ShadowRoot, expectedRootId: number) {
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

  const deleteButton = shadow.querySelector(
    `button[data-webclipper-comment-delete-id='${expectedRootId}']`,
  ) as HTMLButtonElement | null;
  expect(deleteButton).toBeTruthy();
  deleteButton!.click();
  deleteButton!.click();
  await flushTasks();
}

describe('comment sidebar session handlers binding', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    cleanupDom();
  });

  it('binds reply/delete handlers when panel attaches with preloaded comments and handlers', async () => {
    const session = createCommentSidebarSession();
    const onReply = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    session.setHandlers({ onReply, onDelete });
    seedOneRootComment(session);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    session.attachPanel(mounted.api as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel?.shadowRoot).toBeTruthy();
    await exerciseReplyAndDelete(panel!.shadowRoot!, 1);

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(1, 'hello reply');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(1);
    mounted.cleanup();
  });

  it('rebinds reply/delete handlers when handlers are set after comments already rendered', async () => {
    const session = createCommentSidebarSession();
    seedOneRootComment(session);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    session.attachPanel(mounted.api as any);

    const onReply = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    session.setHandlers({ onReply, onDelete });

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel?.shadowRoot).toBeTruthy();
    await exerciseReplyAndDelete(panel!.shadowRoot!, 1);

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(1, 'hello reply');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(1);
    mounted.cleanup();
  });
});
