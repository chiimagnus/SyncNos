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

async function flushPromises() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

describe('Threaded comments panel comment chatwith', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    cleanupDom();
  });

  it('renders chatwith trigger for root comments only', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => []),
      },
    });

    mounted.api.setComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' },
      { id: 2, parentId: 1, createdAt: 1100, commentText: 'reply comment' },
    ]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    const shadow = panel?.shadowRoot;
    expect(shadow).toBeTruthy();

    const triggers = Array.from(
      shadow!.querySelectorAll('.webclipper-inpage-comments-panel__comment-chatwith-trigger'),
    ) as HTMLButtonElement[];
    expect(triggers.length).toBe(1);

    const replyRow = shadow!.querySelector('.webclipper-inpage-comments-panel__reply') as HTMLElement | null;
    expect(replyRow?.querySelector('.webclipper-inpage-comments-panel__comment-chatwith-trigger')).toBeFalsy();

    mounted.cleanup();
  });

  it('disables trigger when root comment text is empty', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => []),
      },
    });

    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: '   ' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    const shadow = panel?.shadowRoot;
    const trigger = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__comment-chatwith-trigger',
    ) as HTMLButtonElement | null;

    expect(trigger).toBeTruthy();
    expect(trigger?.disabled).toBe(true);

    mounted.cleanup();
  });

  it('runs single action immediately on trigger click', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onTrigger = vi.fn(async () => {});

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => [
          {
            id: 'chatgpt',
            label: 'Chat with ChatGPT',
            onTrigger,
          },
        ]),
      },
    });

    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    const shadow = panel?.shadowRoot;
    const trigger = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__comment-chatwith-trigger',
    ) as HTMLButtonElement | null;

    expect(trigger).toBeTruthy();
    trigger?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(onTrigger).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('opens multi-action menu and closes with Escape', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const actionA = vi.fn(async () => {});
    const actionB = vi.fn(async () => {});

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => [
          { id: 'chatgpt', label: 'Chat with ChatGPT', onTrigger: actionA },
          { id: 'claude', label: 'Chat with Claude', onTrigger: actionB },
        ]),
      },
    });

    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    const shadow = panel?.shadowRoot;
    const trigger = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__comment-chatwith-trigger',
    ) as HTMLButtonElement | null;

    trigger?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    const menu = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__comment-chatwith-menu',
    ) as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(menu?.hidden).toBe(false);

    shadow?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushPromises();

    expect(menu?.hidden).toBe(true);

    mounted.cleanup();
  });

  it('disables comment chatwith while panel is busy', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      commentChatWith: {
        resolveActions: vi.fn(async () => []),
      },
    });

    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root comment' }]);
    mounted.api.setBusy(true);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    const shadow = panel?.shadowRoot;
    const trigger = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__comment-chatwith-trigger',
    ) as HTMLButtonElement | null;

    expect(trigger?.disabled).toBe(true);

    mounted.cleanup();
  });
});
