import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const uiMocks = vi.hoisted(() => ({
  render: vi.fn(),
  cleanup: vi.fn(),
}));

vi.mock('@ui/inpage/inpage-item-mention-shadow', () => ({
  inpageItemMentionApi: {
    render: uiMocks.render,
    cleanup: uiMocks.cleanup,
  },
}));

import { createItemMentionController } from '../../src/services/integrations/item-mention/content/mention-controller';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
}

let dom: JSDOM | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  uiMocks.render.mockReset();
  uiMocks.cleanup.mockReset();

  dom = new JSDOM('<!doctype html><html><body><main><textarea></textarea></main></body></html>', {
    url: 'https://chatgpt.com/c/123',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', {
    configurable: true,
    value: (dom.window as any).HTMLTextAreaElement,
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
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
    });
    const active = controller.start();
    expect(active).toBeTruthy();

    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = '$';
    ta.focus();
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

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
    });
    const active = controller.start();

    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = '$';
    ta.focus();
    ta.setSelectionRange(1, 1);
    ta.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    ta.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    const last = uiMocks.render.mock.calls[uiMocks.render.mock.calls.length - 1]?.[0];
    expect(last?.highlightIndex).toBe(1);

    ta.value = '$ab';
    ta.setSelectionRange(3, 3);
    ta.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    ta.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(ta.value).toBe('$ab');

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
    });
    const active = controller.start();

    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = '$ab';
    ta.focus();
    ta.setSelectionRange(3, 3);
    ta.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    ta.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();

    expect(ta.value).toBe('MD');

    active?.stop?.();
  });
});
