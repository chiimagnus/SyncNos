import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      articleCommentsHeading: 'Comments',
      closeCommentsSidebar: 'Collapse comments sidebar',
      detailHeaderChatWithMenuLabel: 'Chat with...',
      detailHeaderChatWithMenuAria: 'Chat with',
      actionFailedFallback: 'Action failed.',
      tooltipCommentSendDetailed: 'Send',
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

describe('Threaded comments panel header chatwith stability', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('does not re-attach header chatwith root while typing', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const resolveSingleActionLabel = vi.fn(async () => 'Chat with...');
    const resolveActions = vi.fn(async () => []);

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: true,
      chatWith: {
        resolveActions,
        resolveSingleActionLabel,
      },
    });

    await flushReactScheduler();

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    const shadow = panel?.shadowRoot;
    expect(shadow).toBeTruthy();

    const textarea = shadow?.querySelector(
      'textarea.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();

    textarea!.value = 'a';
    textarea!.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushReactScheduler();
    textarea!.value = 'ab';
    textarea!.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushReactScheduler();
    textarea!.value = 'abc';
    textarea!.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushReactScheduler();

    expect(resolveSingleActionLabel).toHaveBeenCalledTimes(1);
    expect(resolveActions).toHaveBeenCalledTimes(0);

    mounted.cleanup();
  });
});
