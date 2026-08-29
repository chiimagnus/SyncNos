import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const uiMocks = vi.hoisted(() => ({
  render: vi.fn(),
  cleanup: vi.fn(),
}));
const revisionMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  ready: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (listener: (scopes: readonly string[]) => void) => revisionMocks.subscribe(listener),
  whenDataRevisionObserverReady: () => revisionMocks.ready(),
  requestDataRevisionRetry: (scopes: readonly string[]) => revisionMocks.retry(scopes),
}));

import { createItemMentionController } from '../../src/services/integrations/item-mention/content/mention-controller';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function candidate(id: number, title = `Candidate ${id}`) {
  return {
    conversationId: id,
    title,
    source: 'chatgpt',
    domain: 'chatgpt.com',
    url: '',
    sourceType: 'chat',
    lastCapturedAt: id,
  };
}

function latestRender() {
  return uiMocks.render.mock.calls.at(-1)?.[0];
}

async function runDebounce() {
  await flushMicrotasks();
  vi.advanceTimersByTime(200);
  await flushMicrotasks();
}

let dom: JSDOM | null = null;
let revisionListener: ((scopes: readonly string[]) => void) | null = null;
let revisionUnsubscribe: ReturnType<typeof vi.fn>;

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
  revisionListener = null;
  revisionUnsubscribe = vi.fn();
  revisionMocks.subscribe.mockReset();
  revisionMocks.subscribe.mockImplementation((listener: (scopes: readonly string[]) => void) => {
    revisionListener = listener;
    return revisionUnsubscribe;
  });
  revisionMocks.ready.mockReset();
  revisionMocks.ready.mockResolvedValue({ baselineAvailable: true });
  revisionMocks.retry.mockReset();

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

    // Observer readiness settles before the debounce may start the first business read.
    await flushMicrotasks();
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

    await flushMicrotasks();
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

    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    await flushMicrotasks();

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();

    expect(el.textContent).toBe('MD');

    active?.stop?.();
  });

  it('subscribes before the first search, waits for degraded readiness, and cancels a closed activation', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    revisionMocks.ready.mockReturnValue(readiness.promise);
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: true, data: { candidates: [candidate(1)] }, error: null };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = String.fromCharCode(36);
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));

    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, expect.anything());
    vi.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(send).not.toHaveBeenCalledWith(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, expect.anything());

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(latestRender()?.open).toBe(false);

    readiness.resolve({ baselineAvailable: false });
    await flushMicrotasks();
    revisionListener?.(['conversations']);
    vi.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(send).not.toHaveBeenCalledWith(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, expect.anything());

    active?.stop?.();
  });

  it('coalesces query changes and conversations revisions during an in-flight search to one latest trailing search', async () => {
    const firstSearch = deferred<any>();
    let searchCall = 0;
    const send = vi.fn(async (type: string, payload?: any) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        searchCall += 1;
        if (searchCall === 1) return firstSearch.promise;
        return { ok: true, data: { candidates: [candidate(2, `latest:${payload?.query}`)] }, error: null };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$a';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();
    expect(searchCall).toBe(1);

    el.textContent = '$ab';
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    revisionListener?.(['conversations']);
    revisionListener?.(['conversations']);
    vi.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(searchCall).toBe(1);

    firstSearch.resolve({ ok: true, data: { candidates: [candidate(99, 'stale')] }, error: null });
    await flushMicrotasks();
    await runDebounce();

    expect(searchCall).toBe(2);
    expect(send).toHaveBeenLastCalledWith(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, {
      query: 'ab',
      limit: 20,
    });
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'latest:ab' })]);
    expect(revisionMocks.retry).not.toHaveBeenCalled();

    active?.stop?.();
  });

  it('preserves same-query last-good candidates on reject, requests replay, then accepts replay success and authoritative empty', async () => {
    let searchCall = 0;
    const send = vi.fn(async (type: string) => {
      if (type !== ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
      }
      searchCall += 1;
      if (searchCall === 1) return { ok: true, data: { candidates: [candidate(1, 'ready')] }, error: null };
      if (searchCall === 2) throw new Error('candidate search unavailable');
      if (searchCall === 3) return { ok: true, data: { candidates: [candidate(2, 'replayed')] }, error: null };
      return { ok: true, data: { candidates: [] }, error: null };
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$a';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'ready' })]);
    revisionMocks.retry.mockClear();

    revisionListener?.(['conversations']);
    await runDebounce();
    expect(searchCall).toBe(2);
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'ready' })]);
    expect(revisionMocks.retry).toHaveBeenCalledWith(['conversations']);

    revisionMocks.retry.mockClear();
    revisionListener?.(['conversations']);
    await runDebounce();
    expect(searchCall).toBe(3);
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'replayed' })]);
    expect(revisionMocks.retry).not.toHaveBeenCalled();

    revisionListener?.(['conversations']);
    await runDebounce();
    expect(searchCall).toBe(4);
    expect(latestRender()?.items).toEqual([]);
    expect(revisionMocks.retry).not.toHaveBeenCalled();

    active?.stop?.();
  });

  it('clears old-query candidates before a failing new-query search', async () => {
    let searchCall = 0;
    const send = vi.fn(async (type: string) => {
      if (type !== ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
      }
      searchCall += 1;
      if (searchCall === 1) return { ok: true, data: { candidates: [candidate(1, 'old query')] }, error: null };
      throw new Error('new query failed');
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$a';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'old query' })]);

    el.textContent = '$ab';
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    expect(latestRender()?.items).toEqual([]);
    await runDebounce();

    expect(searchCall).toBe(2);
    expect(latestRender()?.items).toEqual([]);
    expect(revisionMocks.retry).toHaveBeenCalledWith(['conversations']);

    active?.stop?.();
  });

  it('drops late resolve and reject from closed activations without retrying or reopening closedText', async () => {
    const oldResolve = deferred<any>();
    const oldReject = deferred<any>();
    let searchCall = 0;
    const send = vi.fn(async (type: string) => {
      if (type !== ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
      }
      searchCall += 1;
      if (searchCall === 1) return oldResolve.promise;
      if (searchCall === 2) return { ok: true, data: { candidates: [candidate(2, 'current')] }, error: null };
      return oldReject.promise;
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$a';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();
    expect(searchCall).toBe(1);
    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    revisionMocks.retry.mockClear();
    revisionListener?.(['conversations']);

    el.textContent = '$ab';
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();
    expect(searchCall).toBe(2);
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'current' })]);

    oldResolve.resolve({ ok: true, data: { candidates: [candidate(99, 'late old')] }, error: null });
    await flushMicrotasks();
    expect(latestRender()?.items).toEqual([expect.objectContaining({ title: 'current' })]);

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    el.textContent = '$abc';
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();
    expect(searchCall).toBe(3);
    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    oldReject.reject(new Error('late closed failure'));
    try {
      await oldReject.promise;
    } catch (_error) {}
    await flushMicrotasks();
    revisionListener?.(['conversations']);
    vi.advanceTimersByTime(500);
    await flushMicrotasks();

    expect(revisionMocks.retry).not.toHaveBeenCalled();
    expect(latestRender()?.open).toBe(false);
    expect(searchCall).toBe(3);

    active?.stop?.();
  });

  it('resumes the current mention activation when BUILD resolves with empty markdown', async () => {
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: true, data: { candidates: [candidate(1)] }, error: null };
      }
      if (type === ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT) {
        return { ok: true, data: { conversationId: 1, markdown: '' }, error: null };
      }
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$a';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(el.textContent).toBe('$a');
    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(2);
    expect(latestRender()?.open).toBe(true);

    active?.stop?.();
  });

  it('resumes the current mention activation when the editor identity changes during BUILD', async () => {
    const build = deferred<any>();
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: true, data: { candidates: [candidate(1)] }, error: null };
      }
      if (type === ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT) return build.promise;
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const oldEditor = document.querySelector('#prompt-textarea') as HTMLElement;
    (oldEditor as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    oldEditor.textContent = '$a';
    (oldEditor as any).focus?.();
    setCaretToEnd(oldEditor);
    oldEditor.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();

    oldEditor.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    const replacement = document.createElement('div');
    replacement.id = 'prompt-textarea';
    replacement.setAttribute('role', 'textbox');
    replacement.setAttribute('contenteditable', 'true');
    (replacement as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    replacement.textContent = '$a';
    oldEditor.replaceWith(replacement);
    (replacement as any).focus?.();
    setCaretToEnd(replacement);

    build.resolve({ ok: true, data: { conversationId: 1, markdown: 'MD' }, error: null });
    await build.promise;
    await flushMicrotasks();
    await flushMicrotasks();

    expect(replacement.textContent).toBe('$a');
    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(2);
    expect(latestRender()?.open).toBe(true);

    active?.stop?.();
  });

  it('unsubscribes immediately on pick and stop while keeping BUILD_MENTION_INSERT_TEXT one-shot', async () => {
    const build = deferred<any>();
    const send = vi.fn(async (type: string) => {
      if (type === ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES) {
        return { ok: true, data: { candidates: [candidate(1)] }, error: null };
      }
      if (type === ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT) return build.promise;
      return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
    });
    const active = createItemMentionController({
      runtime: { send, onInvalidated: () => () => {}, isInvalidContextError: () => false },
      ui: uiMocks,
    }).start();
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    el.textContent = '$a';
    (el as any).focus?.();
    setCaretToEnd(el);
    el.dispatchEvent(new dom!.window.Event('input', { bubbles: true }));
    await runDebounce();

    el.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, { conversationId: 1 });
    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(1);

    el.dispatchEvent(new dom!.window.KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    await flushMicrotasks();
    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(1);

    build.resolve({ ok: true, data: { conversationId: 1, markdown: 'MD' }, error: null });
    await build.promise;
    await flushMicrotasks();
    await flushMicrotasks();
    expect(el.textContent).toBe('MD');
    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(1);

    active?.stop?.();
    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
