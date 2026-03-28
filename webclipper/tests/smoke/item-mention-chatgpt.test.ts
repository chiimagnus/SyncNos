import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const uiMocks = vi.hoisted(() => ({
  render: vi.fn(),
  cleanup: vi.fn(),
}));

import { createItemMentionController } from '../../src/services/integrations/item-mention/content/mention-controller';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
}

let dom: JSDOM | null = null;

function setCaretToEnd(el: HTMLElement) {
  const sel = globalThis.getSelection?.();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

beforeEach(() => {
  vi.useFakeTimers();
  uiMocks.render.mockReset();
  uiMocks.cleanup.mockReset();

  dom = new JSDOM(
    '<!doctype html><html><body><main><div id="prompt-textarea" role="textbox" contenteditable="true"></div></main></body></html>',
    {
      url: 'https://chatgpt.com/c/123',
      pretendToBeVisual: true,
    },
  );
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'getSelection', {
    configurable: true,
    value: dom.window.getSelection.bind(dom.window),
  });
});

afterEach(() => {
  vi.useRealTimers();
  dom = null;
  // @ts-expect-error cleanup
  delete (globalThis as any).window;
  // @ts-expect-error cleanup
  delete (globalThis as any).document;
  // @ts-expect-error cleanup
  delete (globalThis as any).location;
});

describe('item mention chatgpt controller', () => {
  it('opens on $ and searches candidates', async () => {
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return {
          ok: true,
          data: {
            candidates: [
              {
                conversationId: 1,
                title: 'T',
                source: 'chatgpt',
                domain: 'x',
                url: '',
                sourceType: 'chat',
                lastCapturedAt: 1,
              },
            ],
          },
          error: null,
        };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });

    const controller = createItemMentionController({
      runtime: {
        send,
        onInvalidated: () => () => {},
        isInvalidContextError: () => false,
      },
      ui: uiMocks,
    });
    const active = controller.start();
    expect(active).toBeTruthy();

    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    // Make it "visible" for the adapter.
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    // Debounced search.
    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, { query: '', limit: 20 });
    expect(uiMocks.render).toHaveBeenCalled();

    active?.stop?.();
  });

  it('handles keyboard navigation and esc close without deleting text', async () => {
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return {
          ok: true,
          data: {
            candidates: [
              {
                conversationId: 1,
                title: 'A',
                source: 'chatgpt',
                domain: 'a.com',
                url: '',
                sourceType: 'chat',
                lastCapturedAt: 1,
              },
              {
                conversationId: 2,
                title: 'B',
                source: 'chatgpt',
                domain: 'b.com',
                url: '',
                sourceType: 'chat',
                lastCapturedAt: 2,
              },
            ],
          },
          error: null,
        };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });

    const controller = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    });
    const active = controller.start();

    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    const last = uiMocks.render.mock.calls[uiMocks.render.mock.calls.length - 1]?.[0];
    expect(last?.highlightIndex).toBe(1);

    el.textContent = '$ab';
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(el.textContent).toBe('$ab');

    active?.stop?.();
  });

  it('replaces trigger segment on enter', async () => {
    const send = vi.fn(async (type: string, payload: any) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return {
          ok: true,
          data: {
            candidates: [
              {
                conversationId: 1,
                title: 'A',
                source: 'chatgpt',
                domain: 'a.com',
                url: '',
                sourceType: 'chat',
                lastCapturedAt: 1,
              },
            ],
          },
        };
      }
      if (type === ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT) {
        if (payload?.conversationId !== 1) return { ok: false, data: null, error: { message: 'bad id', extra: null } };
        return { ok: true, data: { conversationId: 1, markdown: 'MD' } };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });

    const controller = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    });
    const active = controller.start();

    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$ab';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();

    expect(el.textContent).toBe('MD');

    active?.stop?.();
  });
});
