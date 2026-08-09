import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      detailHeaderChatWithMenuLabel: 'Chat with...',
      detailHeaderChatWithMenuAria: 'Chat with',
      actionFailedFallback: 'Action failed.',
    };
    return labels[key] || key;
  },
}));

import { mountThreadedCommentsPanel } from '@ui/comments';
import { getCommentSidebarPanelTestDriver } from '../helpers/comment-sidebar-panel-driver';

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

async function flushReactScheduler() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

function rootOverflow(shadow: ShadowRoot): HTMLButtonElement {
  const trigger = shadow.querySelector(
    '.webclipper-inpage-comments-panel__comment .webclipper-inpage-comments-panel__overflow-trigger',
  ) as HTMLButtonElement | null;
  expect(trigger).toBeTruthy();
  return trigger!;
}

function visibleRootMenu(shadow: ShadowRoot): HTMLElement {
  const menu = shadow.querySelector(
    '.webclipper-inpage-comments-panel__comment .webclipper-inpage-comments-panel__overflow-menu',
  ) as HTMLElement | null;
  expect(menu).toBeTruthy();
  expect(menu?.hidden).toBe(false);
  return menu!;
}

describe('Threaded comments panel optional comment actions', () => {
  beforeEach(setupDom);
  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('keeps Chat with AI actions on root overflow while replies expose their own overflow', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => [{ id: 'chatgpt', label: 'Chat with ChatGPT', onTrigger: vi.fn() }]),
      },
    });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' },
      { id: 2, parentId: 1, createdAt: 1100, commentText: 'reply comment' },
    ]);

    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    expect(shadow.querySelectorAll('.webclipper-inpage-comments-panel__overflow-trigger')).toHaveLength(2);

    rootOverflow(shadow).click();
    await flushReactScheduler();
    const rootMenu = visibleRootMenu(shadow);
    expect(rootMenu.textContent).toContain('Chat with ChatGPT');
    expect(rootMenu.textContent).toContain('Delete');

    const reply = shadow.querySelector('.webclipper-inpage-comments-panel__reply') as HTMLElement;
    const replyTrigger = reply.querySelector(
      '.webclipper-inpage-comments-panel__overflow-trigger',
    ) as HTMLButtonElement;
    replyTrigger.click();
    await flushReactScheduler();
    const replyMenu = reply.querySelector('.webclipper-inpage-comments-panel__overflow-menu') as HTMLElement;
    expect(replyMenu.hidden).toBe(false);
    expect(replyMenu.textContent).toContain('Delete');
    expect(replyMenu.textContent).not.toContain('Chat with ChatGPT');

    mounted.cleanup();
  });

  it('keeps the root overflow available for delete when no optional AI action exists', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: { resolveActions: vi.fn(async () => []) },
    });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: '   ' },
    ]);

    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    const trigger = rootOverflow(shadow);
    expect(trigger.disabled).toBe(false);
    trigger.click();
    await flushReactScheduler();
    expect(visibleRootMenu(shadow).textContent).toContain('Delete');

    mounted.cleanup();
  });

  it('renders a single optional action in the menu and runs it explicitly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onTrigger = vi.fn(async () => {});
    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => [{ id: 'chatgpt', label: 'Chat with ChatGPT', onTrigger }]),
      },
    });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' },
    ]);

    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    rootOverflow(shadow).click();
    await flushReactScheduler();
    const action = Array.from(visibleRootMenu(shadow).querySelectorAll('button')).find(
      (button) => button.textContent === 'Chat with ChatGPT',
    ) as HTMLButtonElement | undefined;
    expect(action).toBeTruthy();
    action!.click();
    await flushReactScheduler();
    expect(onTrigger).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('opens a multi-action menu and ignores Escape', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => [
          { id: 'chatgpt', label: 'Chat with ChatGPT', onTrigger: vi.fn() },
          { id: 'gemini', label: 'Chat with Gemini', onTrigger: vi.fn() },
        ]),
      },
    });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' },
    ]);

    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    rootOverflow(shadow).click();
    await flushReactScheduler();
    const menu = visibleRootMenu(shadow);
    expect(menu.textContent).toContain('Chat with ChatGPT');
    expect(menu.textContent).toContain('Chat with Gemini');

    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (shadow.querySelector('.webclipper-inpage-comments-panel__surface') as HTMLElement).dispatchEvent(escape);
    await flushReactScheduler();
    expect(escape.defaultPrevented).toBe(false);
    expect(menu.hidden).toBe(false);

    mounted.cleanup();
  });

  it('disables overflow triggers while the panel is busy', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: { resolveActions: vi.fn(async () => []) },
    });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' },
    ]);
    getCommentSidebarPanelTestDriver(mounted.api).updateBusy(true);

    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    expect(rootOverflow(shadow).disabled).toBe(true);
    mounted.cleanup();
  });
});
