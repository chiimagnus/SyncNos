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

function setCaretToEnd(el: HTMLElement) {
  const sel = globalThis.getSelection?.();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

let dom: JSDOM | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  uiMocks.render.mockReset();
  uiMocks.cleanup.mockReset();

  dom = new JSDOM(
    '<!doctype html><html><body><div role="textbox" data-content-editable-leaf="true" contenteditable="true"></div></body></html>',
    {
      url: 'https://www.notion.so/',
      pretendToBeVisual: true,
    },
  );
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'getSelection', { configurable: true, value: dom.window.getSelection.bind(dom.window) });

  const leaf = document.querySelector('div[role="textbox"]') as any;
  leaf.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
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

describe('item mention notionai controller', () => {
  it('replaces trigger segment on enter', async () => {
    const send = vi.fn(async (type: string, payload: any) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: true, data: { candidates: [{ conversationId: 1, title: 'A', source: 'web', domain: 'a.com', url: '', sourceType: 'chat', lastCapturedAt: 1 }] } };
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
    expect(active).toBeTruthy();

    const leaf = document.querySelector('div[role="textbox"]') as HTMLElement;
    leaf.textContent = '$ab';
    (leaf as any).focus?.();
    setCaretToEnd(leaf);
    leaf.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    leaf.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();

    expect(leaf.textContent).toBe('MD');
    active?.stop?.();
  });

  it('does not pick during IME composition', async () => {
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: true, data: { candidates: [{ conversationId: 1, title: 'A', source: 'web', domain: 'a.com', url: '', sourceType: 'chat', lastCapturedAt: 1 }] } };
      }
      if (type === ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT) {
        return { ok: true, data: { conversationId: 1, markdown: 'MD' } };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });

    const controller = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
    });
    const active = controller.start();

    const leaf = document.querySelector('div[role="textbox"]') as HTMLElement;
    leaf.textContent = '$ab';
    setCaretToEnd(leaf);
    leaf.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    leaf.dispatchEvent(new (dom!.window as any).CompositionEvent('compositionstart', { bubbles: true }));
    leaf.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();

    expect(leaf.textContent).toBe('$ab');
    expect(send).not.toHaveBeenCalledWith(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, expect.anything());

    active?.stop?.();
  });
});

