import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { buildChatgptGeneratedImageMessageKey } from '@services/shared/chatgpt-image-identity';
import { hasCacheableChatImageReference } from '@services/conversations/data/image-inline';
import { resolveCaptureIntegrity } from '@services/shared/capture-integrity';
import { resolveScrollRoot } from '@collectors/virtualized-chat/virtualized-chat-sweep';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createChatgptCollectorDef } from '../../src/collectors/chatgpt/chatgpt-collector.ts';
import chatgptMarkdown from '../../src/collectors/chatgpt/chatgpt-markdown.ts';

function setupChatgptDom(html: string, url: string) {
  return new JSDOM(`<body><main>${html}</main></body>`, { url });
}

function currentDom(
  options: {
    url?: string;
    turnKey?: string;
    ordinal?: number;
    userId?: string;
    assistantId?: string;
    assistantIds?: string;
    userText?: string;
    assistantContent?: string;
    expandedCot?: boolean;
    cotContent?: string;
    beforeTurn?: string;
  } = {},
) {
  const turnKey = options.turnKey ?? 'user-message-1';
  const ordinal = options.ordinal ?? 0;
  const userId = options.userId ?? 'user-message-1';
  const assistantId = options.assistantId ?? 'assistant-message-1';
  const assistantIds = options.assistantIds ?? `${assistantId} ${assistantId}`;
  const userText = options.userText ?? 'Current question';
  const expandedCot = options.expandedCot ?? false;
  const cotContent =
    options.cotContent ??
    '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>Reasoning <strong>step</strong>.</p></div>';
  const cot = `
    <div class="block-current-cot">
      <span hidden data-chatgpt-agent-turn-start></span>
      <div>
        <div class="group/activity-header">
          <button type="button" aria-expanded="${expandedCot ? 'true' : 'false'}"></button>
          <span>Thought for 1s</span>
        </div>
        ${expandedCot ? `<div class="current-cot-body">${cotContent}</div>` : ''}
      </div>
    </div>
  `;
  const assistantContent =
    options.assistantContent ??
    `<div data-chatgpt-selection-conversation-id="conversation-1" data-chatgpt-selection-message-id="${assistantId}">
      <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
        <p>Final <strong>answer</strong>.</p>
        <div data-markdown-copy="code-block">
          <div data-markdown-copy="exclude">typescript<button type="button">Copy</button></div>
          <div><code class="language-ts">const value = 1;</code></div>
        </div>
      </div>
    </div>`;

  const dom = setupChatgptDom(
    `
      ${options.beforeTurn ?? ''}
      <div data-turn-key="${turnKey}">
        <div data-content-search-turn-key="fallback-turn-${ordinal}">
          <div
            data-chatgpt-search-unit-key="fallback-turn-${ordinal}:0:user"
            data-chatgpt-search-message-ids="${userId}"
            data-is-intersecting="true"
          >
            <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${userText}</div></div>
          </div>
          <div
            data-chatgpt-search-unit-key="fallback-turn-${ordinal}:2:assistant"
            data-chatgpt-search-message-ids="${assistantIds}"
            data-is-intersecting="true"
          >
            ${cot}
            ${assistantContent}
          </div>
        </div>
      </div>
    `,
    options.url ?? 'https://chatgpt.com/c/conversation-1',
  );
  (dom.window as any).scrollTo = vi.fn();
  return dom;
}

function current2026Dom(
  options: {
    url?: string;
    turnKey?: string;
    userId?: string;
    userText?: string;
    assistantBlocks?: string;
    expandedCot?: boolean;
    activeStatus?: boolean;
  } = {},
) {
  const turnKey = options.turnKey ?? 'current-turn-2026';
  const userId = options.userId ?? 'current-user-2026';
  const userText = options.userText ?? 'Current 2026 question';
  const expandedCot = options.expandedCot ?? false;
  const cot = expandedCot
    ? `<div class="block-current-cot">
         <span hidden data-chatgpt-agent-turn-start></span>
         <div>
           <div><button type="button" aria-expanded="true"></button></div>
           <div class="current-cot-body">
             <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>Expanded reasoning.</p></div>
           </div>
         </div>
       </div>`
    : '';
  const assistantBlocks =
    options.assistantBlocks ??
    `<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>First final block.</p></div>
     <div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary"><p>Tool chrome should stay out.</p></div>
     <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>Second final block.</p></div>`;
  const activeStatus = options.activeStatus ? '<div role="status" aria-live="polite">Still generating</div>' : '';
  const dom = setupChatgptDom(
    `<div data-turn-key="${turnKey}">
       <div data-content-search-turn-key="fallback-turn-1">
         <div class="flex flex-col gap-1.5">
           <div
             data-chatgpt-search-unit-key="fallback-turn-1:0:user"
             data-chatgpt-search-message-ids="${userId}"
             data-is-intersecting="true"
           >
             <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${userText}</div></div>
           </div>
           ${cot}
           <div class="assistant-current-surface">${assistantBlocks}</div>
           ${activeStatus}
         </div>
       </div>
     </div>`,
    options.url ?? 'https://chatgpt.com/c/current-conversation-2026',
  );
  (dom.window as any).scrollTo = vi.fn();
  const turn = dom.window.document.querySelector(`[data-turn-key="${turnKey}"]`) as HTMLElement;
  (turn as any).getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400, left: 0, right: 800, width: 800 });
  return dom;
}

function articleTurnDom(options: { firstOrdinal?: number; assistantId?: string; includeOrdinal?: boolean } = {}) {
  const firstOrdinal = options.firstOrdinal ?? 0;
  const assistantId = options.assistantId ?? 'modern-assistant-1';
  const userOrdinal = options.includeOrdinal === false ? '' : ` data-testid="conversation-turn-${firstOrdinal}"`;
  const assistantOrdinal =
    options.includeOrdinal === false ? '' : ` data-testid="conversation-turn-${firstOrdinal + 1}"`;
  const dom = setupChatgptDom(
    `<article data-turn="user" data-turn-id="render-user-1"${userOrdinal}>
       <div data-message-author-role="user" data-message-id="modern-user-1">
         <div class="user-message-bubble-color"><div class="whitespace-pre-wrap">Modern question</div></div>
       </div>
     </article>
     <article data-turn="assistant" data-turn-id="render-assistant-1"${assistantOrdinal}>
       <div data-message-author-role="assistant"${assistantId ? ` data-message-id="${assistantId}"` : ''}>
         <div class="markdown prose"><p>Modern <strong>answer</strong>.</p></div>
         <button>Copy</button>
       </div>
     </article>`,
    'https://chatgpt.com/c/modern-conversation',
  );
  (dom.window as any).scrollTo = vi.fn();
  for (const message of Array.from(dom.window.document.querySelectorAll('[data-message-author-role]'))) {
    (message as any).getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, width: 500 });
  }
  return dom;
}

function simulatedVirtualHistory(initialTop = 0) {
  const dom = setupChatgptDom('', 'https://chatgpt.com/c/virtual-dom-incremental');
  (dom.window as any).scrollTo = vi.fn();
  const scroller = dom.window.document.createElement('div');
  scroller.style.overflowY = 'auto';
  dom.window.document.querySelector('main')!.appendChild(scroller);
  let top = initialTop;
  const all = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    id: `message-${index}`,
  }));
  const render = () => {
    const segment = top >= 150 ? all.slice(6) : top >= 75 ? all.slice(4) : all.slice(0, 4);
    scroller.innerHTML = segment
      .map(({ role, id }) => {
        const ordinal = all.findIndex((node) => node.id === id);
        return `<article data-turn="${role}" data-turn-id="turn-${ordinal}" data-testid="conversation-turn-${ordinal}">
          <div data-message-author-role="${role}" data-message-id="${id}">
            <div class="${role === 'user' ? 'whitespace-pre-wrap' : 'markdown prose'}"><p>${id} content</p></div>
          </div>
        </article>`;
      })
      .join('');
    for (const message of Array.from(scroller.querySelectorAll('[data-message-author-role]'))) {
      (message as any).getBoundingClientRect = () => ({
        top: 0,
        bottom: 100,
        height: 100,
        left: 0,
        right: 500,
        width: 500,
      });
    }
  };
  Object.defineProperties(scroller, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 300 },
    clientWidth: { value: 100 },
    scrollWidth: { value: 100 },
    scrollTop: {
      get: () => top,
      set(value: number) {
        top = Math.min(200, Math.max(0, Number(value) || 0));
        render();
      },
    },
  });
  render();
  return { dom, getTop: () => top };
}

function simulatedLazyChatgptHistory(
  totalTurns = 27,
  initiallyLoaded = 5,
  autoLoad = true,
  loadDelayMs = 5,
  needsTopReentry = false,
  ordinalOffset = 0,
  nativePreload = false,
  reflowDuringLoading = false,
) {
  const dom = setupChatgptDom('', 'https://chatgpt.com/c/lazy-hydrated-history');
  (dom.window as any).scrollTo = vi.fn();
  const scroller = dom.window.document.createElement('div');
  scroller.style.overflowY = 'auto';
  scroller.setAttribute('data-app-action-timeline-scroll', '');
  dom.window.document.querySelector('main')!.appendChild(scroller);
  let loaded = initiallyLoaded;
  let top = (loaded - 1) * 100;
  let topArrivals = 0;
  let canLoadMore = autoLoad;
  let clock = 0;
  let loadAt: number | null = null;
  let returnedToBottom = 0;
  let scrollMovesDuringLoad = 0;
  let visitedTop = false;
  let topReentryArmed = false;
  let edgeReentries = 0;
  let nativeTriggers = 0;
  let scrollWrites = 0;
  let layoutGrowth = 0;

  const render = () => {
    const start = totalTurns - loaded;
    const first = Math.max(0, Math.floor(top / 100) - 1);
    const last = Math.min(loaded - 1, Math.floor(top / 100) + 1);
    const turnsHtml = Array.from({ length: last - first + 1 }, (_, offset) => {
      const ordinal = first + offset;
      const actual = start + ordinal;
      const labelOrdinal = (nativePreload ? ordinal : actual) + ordinalOffset;
      return `<div data-turn-key="turn-${actual}">
        <div data-content-search-turn-key="fallback-turn-${labelOrdinal}">
          <div data-chatgpt-search-unit-key="fallback-turn-${labelOrdinal}:0:user"
            data-chatgpt-search-message-ids="user-${actual}" data-message-author-role="user">
            <div data-user-message-bubble><div class="whitespace-pre-wrap">Question ${actual}</div></div>
          </div>
          <div data-chatgpt-search-unit-key="fallback-turn-${labelOrdinal}:1:assistant"
            data-chatgpt-search-message-ids="assistant-${actual}" data-message-author-role="assistant">
            <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">Answer ${actual}</div>
          </div>
        </div>
      </div>`;
    }).join('');
    const loadingMarker =
      '<div class="flex items-center justify-center gap-2 py-4"><div role="status"><div data-loading-indicator=""><svg></svg></div></div></div>';
    scroller.innerHTML = nativePreload
      ? `<div data-chatgpt-conversation-selection-target="lazy-hydrated-history" data-rail-chat-transcript="true">${loaded < totalTurns ? loadingMarker : ''}${turnsHtml}</div>`
      : loadAt === null
        ? turnsHtml
        : `<div data-chatgpt-conversation-selection-target="lazy-hydrated-history" data-rail-chat-transcript="true">${loadingMarker}</div>${turnsHtml}`;
    if (nativePreload) {
      (scroller as any).getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, width: 100 });
      const marker = scroller.querySelector('[data-rail-chat-transcript] [role="status"]')?.parentElement;
      if (marker) {
        (marker as any).getBoundingClientRect = () => ({ top: -400, bottom: -344, height: 56, width: 100 });
      }
    }
    for (const element of Array.from(scroller.querySelectorAll('[data-chatgpt-search-unit-key]'))) {
      (element as any).getBoundingClientRect = () => ({
        top: 0,
        bottom: 100,
        height: 100,
        left: 0,
        right: 500,
        width: 500,
      });
    }
  };
  Object.defineProperties(scroller, {
    clientHeight: { value: 100 },
    scrollHeight: { get: () => loaded * 100 + layoutGrowth },
    clientWidth: { value: 100 },
    scrollWidth: { value: 100 },
    scrollTop: {
      get: () => top,
      set(value: number) {
        scrollWrites += 1;
        const previousTop = top;
        top = Math.min((loaded - 1) * 100, Math.max(0, Number(value) || 0));
        if (loadAt !== null && top !== previousTop && top < (loaded - 1) * 100) scrollMovesDuringLoad += 1;
        if (top <= 0) {
          if (canLoadMore && loaded < totalTurns && loadAt === null && (!needsTopReentry || topReentryArmed))
            loadAt = clock + loadDelayMs;
          topReentryArmed = false;
          visitedTop = true;
        } else if (visitedTop) {
          if (top >= (loaded - 1) * 100) returnedToBottom += 1;
          else {
            topReentryArmed = true;
            edgeReentries += 1;
          }
        }
        render();
      },
    },
  });
  render();
  return {
    dom,
    getLoaded: () => loaded,
    getTopArrivals: () => topArrivals,
    getBottomReturns: () => returnedToBottom,
    getMovesDuringLoad: () => scrollMovesDuringLoad,
    getEdgeReentries: () => edgeReentries,
    getNativeTriggers: () => nativeTriggers,
    getScrollWrites: () => scrollWrites,
    getTop: () => top,
    setTop: (position: number) => {
      scroller.scrollTop = position;
    },
    now: () => clock,
    sleep: async (ms: number) => {
      if (nativePreload && loadAt === null && canLoadMore && loaded < totalTurns) {
        const marker = scroller.querySelector('[data-rail-chat-transcript] [role="status"]')?.parentElement;
        if ((marker as HTMLElement | undefined)?.style.transform.startsWith('translateY(')) {
          nativeTriggers += 1;
          if (reflowDuringLoading) layoutGrowth += 250;
          loadAt = clock + loadDelayMs;
        }
      }
      clock += Math.max(1, ms);
      if (loadAt !== null && clock >= loadAt) {
        const previousLoaded = loaded;
        loaded = Math.min(totalTurns, loaded + 5);
        layoutGrowth = 0;
        top += (loaded - previousLoaded) * 100;
        topArrivals += 1;
        loadAt = null;
        render();
      }
    },
    enableMoreHistory: () => {
      canLoadMore = true;
      const previousLoaded = loaded;
      loaded = Math.min(totalTurns, loaded + 5);
      top += (loaded - previousLoaded) * 100;
      render();
    },
    atBottom: () => top >= (loaded - 1) * 100,
  };
}

function currentDef(dom: JSDOM) {
  return createChatgptCollectorDef(
    createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    }),
  ) as any;
}

async function prepare(def: any, options: any = {}) {
  return def.collector.prepareManualCapture({
    stableSamples: 1,
    pollMs: 0,
    sleep: async () => {},
    ...options,
  });
}

async function capturePrepared(def: any, options: any = {}) {
  const preparedCapture = await prepare(def, options);
  return preparedCapture ? def.collector.capture({ manual: true, preparedCapture }) : null;
}

describe('chatgpt current DOM', () => {
  it('scans newest-to-oldest only until the last saved message, and restores the original scroll', async () => {
    const test = simulatedVirtualHistory(0);
    const def = currentDef(test.dom);
    const prepared = await prepare(def, { savedTailMessageKey: 'message-5' });
    expect(prepared.metrics).toMatchObject({ stoppedAtKey: true, reachedBottom: true, reachedTop: false });
    expect(test.getTop()).toBe(0);
    expect(prepared.records.map((record: any) => record.key)).toEqual(['message-5', 'message-6', 'message-7']);
    const snapshot = await def.collector.capture({ manual: true, preparedCapture: prepared });
    expect(snapshot.messages.map((row: any) => row.messageKey)).toEqual(['message-5', 'message-6', 'message-7']);
    expect(snapshot.captureMeta.completeness).toBe('partial');
    const integrity = resolveCaptureIntegrity('chatgpt', snapshot);
    expect(integrity).toMatchObject({ ok: true, persistence: { mode: 'append' } });
    expect(
      integrity.snapshot.messages.every((row: any) => row.captureSequencePolicy === 'preserve-existing-tail'),
    ).toBe(true);
    expect(snapshot.captureMeta.metrics.stoppedAtKey).toBe(true);
  });

  it('harvests delayed lazy batches in one upward sweep without returning to the bottom', async () => {
    const test = simulatedLazyChatgptHistory(27, 5);
    const def = currentDef(test.dom);
    const prepared = await prepare(def, {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(test.getLoaded()).toBe(27);
    expect(test.getTopArrivals()).toBeGreaterThan(3);
    expect(test.getBottomReturns()).toBe(1);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(test.atBottom()).toBe(true);
    expect(prepared.records).toHaveLength(54);
    expect(prepared.records.map((record: any) => record.key)).toEqual(
      Array.from({ length: 27 }, (_, index) => [`user-${index}`, `assistant-${index}`]).flat(),
    );
    expect(prepared.metrics).toMatchObject({ reachedTop: true, reachedBottom: true });
  });

  it('preloads 27 native history turns without scrolling, then harvests the virtual DOM once', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    const prepared = await prepare(currentDef(test.dom), { now: test.now, sleep: test.sleep, pollMs: 1 });
    expect(test.getNativeTriggers()).toBe(5);
    expect(test.getLoaded()).toBe(27);
    expect(test.getTopArrivals()).toBe(5);
    expect(test.getBottomReturns()).toBe(1);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(test.atBottom()).toBe(true);
    expect(prepared.records.map((record: any) => record.key)).toEqual(
      Array.from({ length: 27 }, (_, index) => [`user-${index}`, `assistant-${index}`]).flat(),
    );
    expect(prepared.metrics).toMatchObject({ reachedTop: true, reachedBottom: true });
  });

  it('preloads a 120-turn native history before the single backward harvest', async () => {
    const test = simulatedLazyChatgptHistory(120, 5, true, 5, false, 0, true);
    const prepared = await prepare(currentDef(test.dom), { now: test.now, sleep: test.sleep, pollMs: 1 });
    expect(test.getNativeTriggers()).toBe(23);
    expect(test.getBottomReturns()).toBe(1);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(prepared.records).toHaveLength(240);
    expect(prepared.records[0]?.key).toBe('user-0');
    expect(prepared.records.at(-1)?.key).toBe('assistant-119');
    expect(prepared.metrics.reachedTop).toBe(true);
  }, 20_000);

  it('preloads and harvests 250 turns (500 messages) with stable identities and no duplicate records', async () => {
    const test = simulatedLazyChatgptHistory(250, 5, true, 5, false, 0, true);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(test.getNativeTriggers()).toBe(49);
    expect(test.getLoaded()).toBe(250);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(test.getBottomReturns()).toBe(1);
    expect(prepared.records).toHaveLength(500);
    expect(new Set(prepared.records.map((row: any) => row.key)).size).toBe(500);
    expect(prepared.records[0]?.key).toBe('user-0');
    expect(prepared.records.at(-1)?.key).toBe('assistant-249');
    expect(prepared.metrics).toMatchObject({ reachedTop: true, reachedBottom: true });
  }, 30_000);

  it('restores the rebased viewport after native history prepends above a middle-scroll position', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    test.setTop(200);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(test.getNativeTriggers()).toBe(5);
    expect(test.getLoaded()).toBe(27);
    expect(prepared.records).toHaveLength(54);
    expect(test.getTop()).toBe(2400);
    expect(test.atBottom()).toBe(false);
    expect(prepared.metrics.reachedTop).toBe(true);
  });

  it('invalidates stored history proof when a partial sweep cannot reach its old anchor', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, false, 5, false, 8);
    const snapshot = await capturePrepared(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(snapshot?.domHistoryVerified).toBe(false);
    expect(snapshot?.captureMeta?.completeness).toBe('partial');
    expect(snapshot?.captureMeta?.metrics?.stoppedAtKey).toBe(false);
  });

  it('preserves history verification when an incremental scan reaches its trusted tail anchor', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    const snapshot = await capturePrepared(currentDef(test.dom), {
      savedTailMessageKey: 'user-26',
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(snapshot?.captureMeta?.metrics?.stoppedAtKey).toBe(true);
    expect(snapshot).not.toHaveProperty('domHistoryVerified');
  });

  it('revokes history proof when the old anchor is reached but a visible message remains unresolved', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    const def = currentDef(test.dom);
    def.collector.__test.manualAdapter.readUnresolvedKeys = () => ['unresolved-message'];
    const snapshot = await capturePrepared(def, {
      savedTailMessageKey: 'user-26',
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
      stepTimeoutMs: 5,
      totalDeadlineMs: 100,
    });
    expect(snapshot?.captureMeta?.metrics).toMatchObject({ stoppedAtKey: true, reachedBottom: true });
    expect(snapshot?.captureMeta?.reasons).toContain('unresolved_turn');
    expect(snapshot?.domHistoryVerified).toBe(false);
  });

  it('keeps saved-tail capture incremental instead of preloading the old history', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    const prepared = await prepare(currentDef(test.dom), {
      savedTailMessageKey: 'user-26',
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(test.getNativeTriggers()).toBe(0);
    expect(test.getLoaded()).toBe(5);
    expect(prepared.metrics.stoppedAtKey).toBe(true);
    expect(prepared.records.map((record: any) => record.key)).toEqual(['user-26', 'assistant-26']);
  });

  it('falls back to partial-safe collection when the native loader stalls', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 2_000, false, 0, true);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      boundaryTimeoutMs: 20,
      totalDeadlineMs: 160,
    });
    expect(test.getNativeTriggers()).toBe(1);
    expect(test.getLoaded()).toBe(5);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(test.atBottom()).toBe(true);
    expect(prepared.completeness).toBe('partial');
    expect(prepared.reasons).toContain('top_not_reached');
    expect(prepared.metrics.steps).toBe(0);
    expect(test.getScrollWrites()).toBe(0);
    const sentinel = test.dom.window.document.querySelector('[data-rail-chat-transcript] [role="status"]')
      ?.parentElement as HTMLElement;
    expect(sentinel.style.transform).toBe('');
    expect(sentinel.style.opacity).toBe('');
    expect(sentinel.style.pointerEvents).toBe('');
  });

  it('does not mistake image/font reflow for a completed native history request', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 2_000, false, 0, true, true);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
      boundaryTimeoutMs: 30,
      totalDeadlineMs: 160,
    });
    expect(test.getNativeTriggers()).toBe(1);
    expect(test.getLoaded()).toBe(5);
    expect(test.getScrollWrites()).toBe(0);
    expect(prepared.metrics.steps).toBe(0);
    expect(prepared.completeness).toBe('partial');
    expect(prepared.reasons).toContain('boundary_stalled');
  });

  it('does not preload native history in a hidden ChatGPT tab', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    Object.defineProperty(test.dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    const prepared = await prepare(currentDef(test.dom), { now: test.now, sleep: test.sleep });
    expect(test.getNativeTriggers()).toBe(0);
    expect(test.getLoaded()).toBe(5);
    expect(prepared.completeness).toBe('partial');
    expect(prepared.records).toHaveLength(0);
  });

  it('discards a native preload after navigating to another conversation', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, false, 0, true);
    let navigated = false;
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: async (ms: number) => {
        await test.sleep(ms);
        if (!navigated) {
          test.dom.window.history.replaceState({}, '', '/c/different-conversation');
          navigated = true;
        }
      },
    });
    expect(navigated).toBe(true);
    expect(test.getNativeTriggers()).toBe(1);
    expect(prepared.identityVerified).toBe(false);
    expect(prepared.records).toHaveLength(0);
  });

  it('confirms a real structural top immediately without waiting or probing', async () => {
    const test = simulatedLazyChatgptHistory(5, 5, false);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 40,
    });
    expect(prepared.records).toHaveLength(10);
    expect(prepared.metrics).toMatchObject({ reachedTop: true, reachedBottom: true });
    expect(test.now()).toBeLessThan(200);
    expect(test.getEdgeReentries()).toBe(0);
    expect(test.getBottomReturns()).toBe(1);
  });

  it('returns partial immediately when the visible top is not the first turn and has no loader', async () => {
    const test = simulatedLazyChatgptHistory(5, 5, false, 5, false, 8);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 40,
      boundaryTimeoutMs: 120_000,
      totalDeadlineMs: 300_000,
    });
    expect(prepared.metrics.reachedTop).toBe(false);
    expect(prepared.reasons).toContain('top_not_reached');
    expect(prepared.reasons).not.toContain('boundary_stalled');
    expect(test.now()).toBeLessThan(200);
    expect(test.getBottomReturns()).toBe(1);
  });

  it('does not certify incomplete history after a single sweep hits its step budget', async () => {
    const test = simulatedLazyChatgptHistory(27, 5);
    const prepared = await prepare(currentDef(test.dom), {
      maxSteps: 2,
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(prepared.metrics.reachedTop).toBe(false);
    expect(prepared.reasons).toContain('step_budget_exhausted');
    expect(prepared.records.length).toBeLessThan(54);
    expect(test.atBottom()).toBe(true);
  });

  it('does not fabricate a complete history or re-enter the top when loading has no signal', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 5, true);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(test.getLoaded()).toBe(5);
    expect(test.getEdgeReentries()).toBe(0);
    expect(test.getBottomReturns()).toBe(1);
    expect(prepared.records).toHaveLength(10);
    expect(prepared.metrics.reachedTop).toBe(false);
    expect(prepared.reasons).toContain('top_not_reached');
  });

  it('does not move the scroller while older history is still loading, and reports a stalled load as incomplete', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 2_000);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
      boundaryTimeoutMs: 35,
      totalDeadlineMs: 160,
    });
    expect(test.getLoaded()).toBe(5);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(test.getBottomReturns()).toBe(1);
    expect(prepared.metrics.reachedTop).toBe(false);
    expect(prepared.reasons).toContain('boundary_stalled');
  });

  it('waits for genuinely slow history loading beyond the former 30-second boundary without scrolling', async () => {
    const test = simulatedLazyChatgptHistory(10, 5, true, 35_000);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 500,
      boundaryTimeoutMs: 120_000,
      totalDeadlineMs: 180_000,
    });
    expect(test.getLoaded()).toBe(10);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(test.getBottomReturns()).toBe(1);
    expect(prepared.records).toHaveLength(20);
    expect(prepared.metrics.reachedTop).toBe(true);
  });

  it('terminates an in-flight top-loading wait when the user navigates to another conversation', async () => {
    const test = simulatedLazyChatgptHistory(27, 5, true, 2_000);
    let changedRoute = false;
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: async (ms: number) => {
        await test.sleep(ms);
        if (!changedRoute && test.now() > 10) {
          test.dom.window.history.replaceState({}, '', '/c/unrelated-conversation');
          changedRoute = true;
        }
      },
      pollMs: 1,
      boundaryTimeoutMs: 35,
      totalDeadlineMs: 160,
    });
    expect(changedRoute).toBe(true);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(prepared.identityVerified).toBe(false);
    expect(prepared.records).toHaveLength(0);
  });

  it('collects a 120-turn simulated history without restarting from the bottom', async () => {
    const test = simulatedLazyChatgptHistory(120, 5);
    const prepared = await prepare(currentDef(test.dom), {
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(test.getLoaded()).toBe(120);
    expect(test.getTopArrivals()).toBeGreaterThanOrEqual(20);
    expect(test.getBottomReturns()).toBe(1);
    expect(test.getMovesDuringLoad()).toBe(0);
    expect(prepared.records).toHaveLength(240);
    expect(prepared.records.at(0)?.key).toBe('user-0');
    expect(prepared.records.at(-1)?.key).toBe('assistant-119');
    expect(prepared.metrics.reachedTop).toBe(true);
  }, 20_000);

  it('stops at a saved stable user key without any full-history completion marker', async () => {
    const test = simulatedLazyChatgptHistory(27, 5);
    const prepared = await prepare(currentDef(test.dom), {
      savedTailMessageKey: 'user-26',
      now: test.now,
      sleep: test.sleep,
      pollMs: 1,
    });
    expect(prepared.metrics.stoppedAtKey).toBe(true);
    expect(prepared.metrics.reachedTop).toBe(false);
    expect(prepared.records.map((record: any) => record.key)).toEqual(['user-26', 'assistant-26']);
    expect(test.getLoaded()).toBe(5);
    expect(test.getBottomReturns()).toBe(0);
  });

  it('falls back to the whole original sweep if the saved message was edited away', async () => {
    const test = simulatedVirtualHistory(200);
    const prepared = await prepare(currentDef(test.dom), { savedTailMessageKey: 'removed-original-assistant' });
    expect(prepared.metrics.stoppedAtKey).toBe(false);
    expect(prepared.records.map((record: any) => record.key)).toEqual(
      Array.from({ length: 8 }, (_, index) => `message-${index}`),
    );
    expect(test.getTop()).toBe(200);
    expect(prepared.reasons).not.toContain('order_conflict');
  });

  it('captures role-based data-turn-id articles using real message IDs, not transient turn IDs', async () => {
    const dom = articleTurnDom();
    const def = currentDef(dom);
    const snapshot = (await capturePrepared(def)) as any;
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.reasons).toContain('chatgpt_dom_history_unverified');
    expect(resolveCaptureIntegrity('chatgpt', snapshot)).toMatchObject({
      ok: true,
      persistence: { mode: 'append', diff: { removed: [] } },
    });
    expect(snapshot.messages.map((message: any) => [message.messageKey, message.role])).toEqual([
      ['modern-user-1', 'user'],
      ['modern-assistant-1', 'assistant'],
    ]);
    expect(snapshot.messages[0].contentMarkdown).toBe('Modern question');
    expect(snapshot.messages[1].contentMarkdown).toBe('Modern **answer**.');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Copy');
    dom.window.document.querySelector('[data-turn="user"]')?.setAttribute('data-turn-id', 'rerendered-user');
    dom.window.document.querySelector('[data-turn="assistant"]')?.setAttribute('data-turn-id', 'rerendered-assistant');
    expect(def.collector.__test.manualAdapter.readDescriptors().map((descriptor: any) => descriptor.key)).toEqual([
      'modern-user-1',
      'modern-assistant-1',
    ]);
  });

  it('ignores explicitly hidden sibling messages in modern articles', async () => {
    const dom = articleTurnDom();
    const assistantTurn = dom.window.document.querySelector('[data-turn="assistant"]')!;
    assistantTurn.insertAdjacentHTML(
      'beforeend',
      '<div hidden data-message-author-role="assistant" data-message-id="old-hidden-sibling">obsolete reply</div>',
    );
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'modern-user-1',
      'modern-assistant-1',
    ]);
  });

  it('does not declare a modern turn window complete when older ordinals may be missing', () => {
    const partial = currentDef(articleTurnDom({ firstOrdinal: 7 }));
    expect(partial.collector.__test.manualAdapter.readBoundaryState('top')).toBe('unverified');
    const unknown = currentDef(articleTurnDom({ includeOrdinal: false }));
    expect(unknown.collector.__test.manualAdapter.readBoundaryState('top')).toBe('unverified');
  });

  it('retains visible modern messages as a partial capture when history cannot reach the true top', async () => {
    const snapshot = (await capturePrepared(currentDef(articleTurnDom({ firstOrdinal: 7 })), {
      boundaryTimeoutMs: 5,
      stepTimeoutMs: 15,
      totalDeadlineMs: 200,
    })) as any;
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'modern-user-1',
      'modern-assistant-1',
    ]);
  });

  it('marks a visible modern assistant with no message ID as incomplete rather than deleting history', async () => {
    const snapshot = (await capturePrepared(currentDef(articleTurnDom({ assistantId: '' })))) as any;
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.reasons).toContain('unstable_identity');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual(['modern-user-1']);
  });

  it('finds the real scroll ancestor in an article layout without the old timeline-scroll attribute', () => {
    const dom = articleTurnDom();
    const main = dom.window.document.querySelector('main')!;
    const scrollRoot = dom.window.document.createElement('div');
    scrollRoot.style.overflowY = 'auto';
    Object.defineProperties(scrollRoot, { scrollHeight: { value: 900 }, clientHeight: { value: 200 } });
    while (main.firstChild) scrollRoot.appendChild(main.firstChild);
    main.appendChild(scrollRoot);
    const seed = currentDef(dom).collector.__test.manualAdapter.readScrollSeed();
    expect(seed).toBe(dom.window.document.querySelector('article'));
    expect(resolveScrollRoot({ document: dom.window.document, window: dom.window as any }, seed)).toBe(scrollRoot);
  });

  it('captures twelve separate article turns in order without inventing extra messages', async () => {
    const html = Array.from(
      { length: 12 },
      (_, index) =>
        `<article data-turn="user" data-turn-id="user-turn-${index}" data-testid="conversation-turn-${index * 2}">
        <div data-message-author-role="user" data-message-id="user-${index}">
          <div class="whitespace-pre-wrap">Question ${index}</div>
        </div>
      </article>
      <article data-turn="assistant" data-turn-id="assistant-turn-${index}" data-testid="conversation-turn-${index * 2 + 1}">
        <div data-message-author-role="assistant" data-message-id="assistant-${index}">
          <div class="markdown prose"><p>Answer ${index}</p></div>
        </div>
      </article>`,
    ).join('');
    const dom = setupChatgptDom(html, 'https://chatgpt.com/c/modern-conversation');
    (dom.window as any).scrollTo = vi.fn();
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.messages).toHaveLength(24);
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual(
      Array.from({ length: 12 }, (_, index) => [`user-${index}`, `assistant-${index}`]).flat(),
    );
    expect(snapshot.messages.at(-1)).toMatchObject({ role: 'assistant', contentMarkdown: 'Answer 11' });
  });

  it('keeps a generating article assistant unresolved until the completion status disappears', () => {
    const dom = articleTurnDom();
    const turn = dom.window.document.querySelector('[data-turn="assistant"]')!;
    turn.insertAdjacentHTML('beforeend', '<div role="status" aria-live="polite">Generating</div>');
    const def = currentDef(dom);
    expect(def.collector.__test.manualAdapter.readUnresolvedKeys()).toContain('modern-assistant-1');
    turn.querySelector('[role="status"]')?.remove();
    expect(def.collector.__test.manualAdapter.readUnresolvedKeys()).not.toContain('modern-assistant-1');
  });

  it('matches only the canonical ChatGPT hostname and keeps empty chat surfaces ready', () => {
    const canonical = currentDef(currentDom());
    expect(canonical.matches({ hostname: 'chatgpt.com' })).toBe(true);
    expect(canonical.matches({ hostname: 'www.chatgpt.com' })).toBe(false);
    expect(canonical.matches({ hostname: 'chat.openai.com' })).toBe(false);

    const empty = currentDef(setupChatgptDom('', 'https://chatgpt.com/'));
    expect(empty.collector.isCaptureAvailable()).toBe(true);

    const settings = currentDef(setupChatgptDom('', 'https://chatgpt.com/settings'));
    expect(settings.collector.isCaptureAvailable()).toBe(false);
  });

  it('prefers the grouped-turn reader if a DOM turn also carries a newer turn identifier', async () => {
    const dom = currentDom();
    const turn = dom.window.document.querySelector('[data-turn-key]')!;
    turn.setAttribute('data-turn-id', 'additional-id');
    turn.setAttribute('data-turn', 'user');
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'user-message-1',
      'assistant-message-1',
    ]);
  });

  it('captures 2026 turn-shell assistants when search units only identify the user', async () => {
    const dom = current2026Dom({ expandedCot: true });
    const def = currentDef(dom);
    const snapshot = (await capturePrepared(def)) as any;

    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'current-user-2026',
      'chatgpt_turn_current-turn-2026_assistant',
    ]);
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', contentMarkdown: 'Current 2026 question' });
    expect(snapshot.messages[1].role).toBe('assistant');
    expect(snapshot.messages[1].contentMarkdown).toContain('Expanded reasoning.');
    expect(snapshot.messages[1].contentMarkdown).toContain('First final block.');
    expect(snapshot.messages[1].contentMarkdown).toContain('Second final block.');
    expect(snapshot.messages[1].contentMarkdown.match(/Expanded reasoning\./g)).toHaveLength(1);
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Tool chrome should stay out.');
  });

  it('keeps a 2026 assistant turn unresolved until a final primary block exists', async () => {
    const dom = current2026Dom({
      assistantBlocks:
        '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary"><p>Thinking only.</p></div>',
    });
    const def = currentDef(dom);
    const descriptors = def.collector.__test.manualAdapter.readDescriptors();
    const assistant = descriptors.find((descriptor: any) => descriptor.role === 'assistant');

    expect(assistant).toMatchObject({
      key: 'chatgpt_turn_current-turn-2026_assistant',
      rendered: false,
      visible: true,
    });
    expect(def.collector.__test.manualAdapter.readUnresolvedKeys()).toContain(
      'chatgpt_turn_current-turn-2026_assistant',
    );
  });

  it('keeps partially rendered 2026 assistants unresolved while an aria-live status is active', () => {
    const def = currentDef(current2026Dom({ activeStatus: true }));
    const assistant = def.collector.__test.manualAdapter
      .readDescriptors()
      .find((descriptor: any) => descriptor.role === 'assistant');
    expect(assistant).toMatchObject({
      key: 'chatgpt_turn_current-turn-2026_assistant',
      rendered: false,
      visible: true,
    });
    expect(def.collector.__test.manualAdapter.readUnresolvedKeys()).toContain(
      'chatgpt_turn_current-turn-2026_assistant',
    );
  });

  it('captures current user/assistant units, expanded reasoning, and current code blocks', async () => {
    const dom = currentDom({
      expandedCot: true,
      cotContent: `
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
          <p>Reasoning <strong>step</strong>.</p>
        </div>
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">
          <p>Visible tool summary</p>
        </div>
      `,
    });
    const def = currentDef(dom);
    expect(def.collector.isCaptureAvailable()).toBe(true);

    const snapshot = (await capturePrepared(def)) as any;
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'user-message-1',
      'assistant-message-1',
    ]);
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', contentMarkdown: 'Current question' });
    expect(snapshot.messages[1].contentMarkdown).toContain('Reasoning **step**.');
    expect(snapshot.messages[1].contentMarkdown).toContain('Visible tool summary');
    expect(snapshot.messages[1].contentMarkdown).toContain('Final **answer**.');
    expect(snapshot.messages[1].contentMarkdown).toContain('```ts\nconst value = 1;\n```');
    expect(snapshot.messages[1].contentMarkdown).not.toContain('Copy');
  });

  it('keeps collapsed reasoning out and captures it when expanded after prepare', async () => {
    const dom = currentDom({ expandedCot: false });
    const def = currentDef(dom);
    const preparedCapture = await prepare(def);
    const before = preparedCapture.records.find((record: any) => record.key === 'assistant-message-1');
    expect(before.payload.contentMarkdown).not.toContain('Reasoning step.');

    const button = dom.window.document.querySelector('button[aria-expanded]') as HTMLButtonElement;
    button.setAttribute('aria-expanded', 'true');
    const body = dom.window.document.createElement('div');
    body.className = 'current-cot-body';
    body.innerHTML =
      '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>Reasoning after prepare.</p></div>';
    button.parentElement?.insertAdjacentElement('afterend', body);

    const snapshot = await def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages[1].contentMarkdown).toContain('Reasoning after prepare.');
    expect(snapshot.captureMeta).toMatchObject({ completeness: 'partial' });
    expect(snapshot.captureMeta.reasons).toContain('final_live_changed');
  });

  it('captures rich current assistant Markdown while removing source chrome and non-content icons', async () => {
    const dom = currentDom({
      assistantContent: `
        <div data-chatgpt-selection-conversation-id="conversation-1" data-chatgpt-selection-message-id="assistant-message-1">
          <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
            <h2>Heading</h2>
            <blockquote><p>Quote</p></blockquote>
            <ul><li>Item</li></ul>
            <p><strong>bold</strong> <em>italic</em> <a href="https://example.com">link</a></p>
            <p><a href="https://arxiv.org/abs/2312.10997"><img src="https://t0.gstatic.com/faviconV2?url=https%3A%2F%2Farxiv.org" />arXiv</a></p>
            <img src="https://chatgpt.com/images/ecosystem/apps/github/icon.png" />
            <img src="https://example.com/chart.png" />
          </div>
        </div>
      `,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('## Heading');
    expect(markdown).toContain('> Quote');
    expect(markdown).toContain('- Item');
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('*italic*');
    expect(markdown).toContain('[link](https://example.com)');
    expect(markdown).toContain('[arXiv](https://arxiv.org/abs/2312.10997)');
    expect(markdown).toContain('![](https://example.com/chart.png)');
    expect(markdown).not.toContain('gstatic.com/faviconV2');
    expect(markdown).not.toContain('chatgpt.com/images/ecosystem/apps/github/icon.png');
  });

  it('preserves the reading order of Intelligent UI cards, flows and tables', async () => {
    const dom = current2026Dom({
      assistantBlocks: `
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
          <h2>处理流程</h2>
          <div data-d-component="box" data-d-direction="col">
            <div data-d-component="box"><p>输入数据</p></div>
            <div data-d-component="row"><svg data-d-component="icon"><path d="M0 0"></path></svg></div>
            <div data-d-component="box"><p>转换为图表</p><span data-d-component="caption">保留数据含义</span></div>
            <div data-d-component="grid">
              <div data-d-component="grid-item"><div data-d-component="box"><p>模块甲</p><span>注释甲</span></div></div>
              <div data-d-component="grid-item"><div data-d-component="box"><p>模块乙</p><span>注释乙</span></div></div>
            </div>
          </div>
          <div data-d-component="table"><table><tr><th>项目</th><th>结果</th></tr><tr><td>A</td><td>通过</td></tr></table></div>
        </div>`,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('## 处理流程');
    expect(markdown).toMatch(/输入数据\n\n转换为图表/);
    expect(markdown).toMatch(/保留数据含义\n\n模块甲/);
    expect(markdown).toMatch(/注释甲\n\n模块乙/);
    expect(markdown).toContain('| 项目 | 结果 |');
    expect(markdown).toContain('| A | 通过 |');
    expect(markdown).not.toContain('M0 0');
  });

  it('converts rendered rich-layout text and visible citation markers without creating code blocks', async () => {
    const dom = current2026Dom({
      assistantBlocks: [
        '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">',
        '  <div data-d-component="row">',
        '    <div data-d-component="box"><svg data-d-component="icon"><path d="M0 0"/></svg></div>',
        '    <div data-d-component="box">',
        '          **第 1 步：建立试样**',
        '',
        '          | 参数 | 数值 |',
        '          | --- | --- |',
        '          | 半径 | 25 mm |',
        '    </div>',
        '  </div>',
        '  <p>&lt;divider color="subtle"/&gt;</p>',
        '  <p>参考 &lt;Cite ref="turn0search0"/&gt;</p>',
        '</div>',
      ].join('\n'),
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('**第 1 步：建立试样**');
    expect(markdown).toContain('| 半径 | 25 mm |');
    expect(markdown).toContain('（引用见原对话）');
    expect(markdown).toContain('---');
    expect(markdown).not.toMatch(/^ {4,}\*\*第 1 步/m);
    expect(markdown).not.toContain('<divider');
  });

  it('uses current document title for durable chats without a rendered history link', async () => {
    const dom = currentDom({
      url: 'https://chatgpt.com/c/current-durable-conversation',
      userText: '请帮我检查工作区中的 Git 状态和文件树',
      beforeTurn:
        '<section data-quick-chat-drag-handle="true" aria-label="另一个浮动聊天"><header><h2>另一个浮动聊天</h2></header></section>',
    });
    dom.window.document.title = 'Git 管理器改进计划';

    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.conversation.conversationKey).toBe('current-durable-conversation');
    expect(snapshot.conversation.title).toBe('Git 管理器改进计划');

    const project = currentDom({
      url: 'https://chatgpt.com/g/p_project/c/project-conversation',
      userText: 'Project prompt',
    });
    project.window.document.title = '项目科研综述';
    expect((await capturePrepared(currentDef(project))).conversation.title).toBe('项目科研综述');
  });

  it('does not use generic document titles, floating chats, or titles outside durable conversation routes', async () => {
    for (const title of ['ChatGPT', 'New chat', '  ']) {
      const generic = currentDom({
        userText: 'First user message',
        beforeTurn:
          '<section data-quick-chat-drag-handle="true" aria-label="旧的浮动会话"><h2>旧的浮动会话</h2></section>',
      });
      generic.window.document.title = title;
      expect((await capturePrepared(currentDef(generic))).conversation.title).toBe('First user message');
    }

    const shared = currentDom({ url: 'https://chatgpt.com/share/share-title-test', userText: 'Shared prompt' });
    shared.window.document.title = '另一个会话的标题';
    expect((await capturePrepared(currentDef(shared))).conversation.title).toBe('Shared prompt');

    const temporary = currentDom({ url: 'https://chatgpt.com/?temporary-chat=true', userText: 'Temporary prompt' });
    temporary.window.document.title = '旧会话标题';
    expect((await capturePrepared(currentDef(temporary))).conversation.title).toBe('Temporary prompt');
  });

  it('ignores ChatGPT skip-to-content fragment links when resolving the conversation title', async () => {
    const html = `<a href="#_R_jump" aria-label="跳转到内容">跳转到内容</a>
      <a href="/c/conversation-1" aria-current="page">真实对话标题</a>`;
    const linked = currentDom({ beforeTurn: html, userText: 'First prompt' });
    linked.window.document.title = '不该覆盖当前链接的浏览器标题';
    const def = currentDef(linked);
    const snapshot = (await capturePrepared(def)) as any;
    expect(snapshot.conversation.title).toBe('真实对话标题');
    const withoutSidebar = currentDef(
      currentDom({
        beforeTurn: `<a href="#_R_jump">跳转到内容</a>`,
        userText: 'First prompt',
      }),
    );
    const fallback = (await capturePrepared(withoutSidebar)) as any;
    expect(fallback.conversation.title).toBe('First prompt');
    const titled = currentDom({ beforeTurn: '<a href="#jump">跳转到内容</a>', userText: 'Prompt body' });
    titled.window.document.title = '生成交互式图表';
    const withDocumentTitle = (await capturePrepared(currentDef(titled))) as any;
    expect(withDocumentTitle.conversation.title).toBe('生成交互式图表');
  });

  it('enriches the matching API message with a DOM-backed SVG snapshot without changing other messages', async () => {
    const dom = currentDom({
      assistantContent: `<div data-chatgpt-selection-message-id="assistant-message-1">
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
          <p>图表正文</p><svg data-d-component="svg" width="200" height="100" viewBox="0 0 200 100" aria-label="结构图"><rect width="200" height="100" /></svg>
        </div>
      </div>`,
    });
    const url =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(url);
    (dom.window as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    };
    const def = currentDef(dom);
    const snapshot = {
      conversation: { conversationKey: 'conversation-1' },
      messages: [
        { messageKey: 'assistant-message-1', role: 'assistant', contentMarkdown: 'API 原始文本', sequence: 1 },
        { messageKey: 'other-message', role: 'assistant', contentMarkdown: '其他回答', sequence: 2 },
      ],
    };
    const result = await def.collector.enrichApiSnapshotWithRenderedGraphics(snapshot);
    expect(result.messages[0].contentMarkdown).toContain('API 原始文本');
    expect(result.messages[0].contentMarkdown).toContain(`![结构图](${url})`);
    expect(result.messages[1]).toEqual(snapshot.messages[1]);
    expect(hasCacheableChatImageReference(result.messages[0].contentMarkdown)).toBe(true);
    const otherConversation = await def.collector.enrichApiSnapshotWithRenderedGraphics({
      ...snapshot,
      conversation: { conversationKey: 'not-current-conversation' },
    });
    expect(otherConversation.messages).toEqual(snapshot.messages);
  });

  it('captures real Recharts accessibility rows as an exact data table before the PNG', async () => {
    const dom = current2026Dom({
      assistantBlocks: `<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
        <p>SyncNos 图表真机测试</p>
        <section><div>
          ${'<div>'.repeat(9)}
          <svg class="recharts-surface" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" /></svg>
          ${'</div>'.repeat(9)}
          <ul class="sr-only"><li>2021: 数值 11</li><li>2022: 数值 18</li><li>2026: 数值 38</li></ul>
        </div></section>
      </div>`,
    });
    const url =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(url);
    (dom.window as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    };
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('| 类别 | 数值 |');
    expect(markdown).toContain('SyncNos 图表真机测试\n\n| 类别 | 数值 |');
    expect(markdown).toContain('| 2021 | 11 |');
    expect(markdown).toContain('| 2022 | 18 |');
    expect(markdown).toContain('| 2026 | 38 |');
    expect(markdown).toContain(`![图表](${url})`);
    expect(markdown.indexOf('| 2021 | 11 |')).toBeLessThan(markdown.indexOf('![图表]'));
    expect(markdown.match(/2021 \| 11/g)?.length).toBe(1);
  });

  it('rasterizes SVG charts and Canvas graphics into cacheable PNGs in message order', async () => {
    const dom = current2026Dom({
      assistantBlocks: `<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
        <p>图表开始</p>
        <svg data-d-component="svg" aria-label="收入趋势" width="200" height="100" viewBox="0 0 200 100">
          <rect width="200" height="100" fill="#336699"></rect>
          <text x="20" y="50">收入增长</text>
        </svg>
        <p>第二个图形</p>
        <canvas aria-label="当前画布" width="200" height="100"></canvas>
        <p>图表结束</p>
      </div>`,
    });
    const imageUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const getContext = vi
      .spyOn(dom.window.HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() } as any);
    const toDataURL = vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(imageUrl);
    const assignedSvgSources: string[] = [];
    (dom.window as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        assignedSvgSources.push(value);
        this.onload?.();
      }
    };
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain(`![收入趋势](${imageUrl})`);
    expect(markdown).toContain(`![当前画布](${imageUrl})`);
    expect(markdown.indexOf('图表开始')).toBeLessThan(markdown.indexOf('![收入趋势]'));
    expect(markdown.indexOf('![收入趋势]')).toBeLessThan(markdown.indexOf('第二个图形'));
    expect(markdown.indexOf('![当前画布]')).toBeLessThan(markdown.indexOf('图表结束'));
    expect(hasCacheableChatImageReference(markdown)).toBe(true);
    expect(assignedSvgSources[0]).toContain('data:image/svg+xml');
    expect(getContext).toHaveBeenCalled();
    expect(toDataURL).toHaveBeenCalled();
  });

  it('keeps canvas pixels when ChatGPT splits one assistant turn into multiple primary blocks', async () => {
    const dom = current2026Dom({
      assistantBlocks: `<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><canvas aria-label="拆分图表" width="100" height="50"></canvas></div>
        <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>图表说明</p></div>`,
    });
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl);
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain(`![拆分图表](${dataUrl})`);
    expect(markdown).toContain('图表说明');
    expect(hasCacheableChatImageReference(markdown)).toBe(true);
  });

  it('preserves checked, selected and slider values without keeping executable controls', async () => {
    const dom = current2026Dom({
      assistantBlocks: `<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
        <div data-d-component="checkbox"><label><input type="checkbox"> 保留图片</label></div>
        <div data-d-component="slider" aria-label="透明度"><input type="range" min="0" max="100" value="20"></div>
        <div data-d-component="segmented-control" aria-label="主题">
          <button type="button" aria-pressed="false">亮色</button>
          <button type="button" aria-pressed="true">暗色</button>
        </div>
        <p>结束</p>
      </div>`,
    });
    (dom.window.document.querySelector('input[type=checkbox]') as HTMLInputElement).checked = true;
    (dom.window.document.querySelector('input[type=range]') as HTMLInputElement).value = '75';
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('[x] 保留图片');
    expect(markdown).toContain('透明度：75');
    expect(markdown).toContain('主题：暗色');
    expect(markdown).toContain('结束');
    expect(markdown).not.toContain('<input');
    expect(markdown).not.toContain('<button');
  });

  it('keeps a meaningful placeholder for chart-only content without recording decorative icons', async () => {
    const dom = current2026Dom({
      assistantBlocks: `<div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
        <svg data-d-component="icon"><path d="M0 0"></path></svg>
        <svg class="recharts-surface" viewBox="0 0 200 100"><path d="M0 0 L100 50"></path></svg>
        <svg role="img" aria-label="收入趋势"><path d="M0 0 L100 60"></path></svg>
      </div>`,
    });
    const def = currentDef(dom);
    const assistant = def.collector.__test.manualAdapter
      .readDescriptors()
      .find((descriptor: any) => descriptor.role === 'assistant');
    expect(assistant.rendered).toBe(true);
    const snapshot = (await capturePrepared(def)) as any;
    expect(snapshot.messages[1].contentMarkdown).toBe('[图表：请在原对话查看]\n\n[图表：收入趋势]');
  });

  it('preserves hidden rendered code sources such as Mermaid', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div id="root">
        <p>Diagram</p>
        <div class="mermaid">
          <svg aria-hidden="true"><path d="M0 0"></path></svg>
          <pre class="sr-only" aria-hidden="true"><code class="language-mermaid">graph TD
A --> B</code></pre>
        </div>
      </div>
    </body>`);
    const root = dom.window.document.querySelector('#root');
    const markdown = chatgptMarkdown.extractRenderedMarkdown(root);
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('graph TD');
    expect(markdown).toContain('A --> B');
  });

  it('uses protected generated-image identity instead of transient message ids', async () => {
    const fileId = 'file_shared_generated_1';
    const imageUrl = `https://chatgpt.com/backend-api/estuary/content?id=${fileId}&ts=1&sig=temporary`;
    const expectedKey = buildChatgptGeneratedImageMessageKey([fileId]);
    const dom = currentDom({
      assistantId: 'transient-assistant-id',
      assistantContent: `
        <div data-chatgpt-selection-message-id="transient-assistant-id">
          <div data-markdown-text-style="assistant-message"><img src="${imageUrl}" alt="generated cube" /></div>
        </div>
      `,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.messages[1].messageKey).toBe(expectedKey);
    expect(expectedKey).not.toContain(fileId);
  });

  it('keeps Deep Research as a stable placeholder for later hydration', async () => {
    const reportUrl = 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/report-a';
    const dom = currentDom({
      assistantContent: `<iframe title="internal://deep-research" src="${reportUrl}"></iframe>`,
    });
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.messages[1]).toMatchObject({
      messageKey: 'assistant-message-1',
      role: 'assistant',
      contentMarkdown: `Deep Research (iframe): ${reportUrl}`,
    });
  });

  it('uses active Project conversation title, otherwise derives a generic durable title from the first user message', async () => {
    const project = currentDom({
      url: 'https://chatgpt.com/g/p_1/c/conv_project_1',
      beforeTurn:
        '<h1>Research</h1><nav><a href="/g/p_1/c/conv_project_1" aria-current="page"><span>GPR signal preprocessing</span></a></nav>',
    });
    project.window.document.title = 'ChatGPT';
    expect((await capturePrepared(currentDef(project))).conversation.title).toBe('GPR signal preprocessing');

    const generic = currentDom({
      url: 'https://chatgpt.com/c/conversation-title-1',
      userText: '请帮我分析强化学习和机器学习的关系',
    });
    generic.window.document.title = 'ChatGPT';
    expect((await capturePrepared(currentDef(generic))).conversation.title).toBe('请帮我分析强化学习和机器学习的关系');

    const newChat = currentDom({
      url: 'https://chatgpt.com/c/conversation-title-2',
      userText: '这是一个尚未生成站点标题的新会话',
    });
    newChat.window.document.title = 'New chat';
    expect((await capturePrepared(currentDef(newChat))).conversation.title).toBe('这是一个尚未生成站点标题的新会话');
  });

  it('captures current share pages and uses the share id as durable identity', async () => {
    const dom = currentDom({
      url: 'https://chatgpt.com/share/share-current-1',
      userText: 'Shared current conversation',
    });
    dom.window.document.title = 'WRONG BROWSER TAB TITLE';
    const snapshot = (await capturePrepared(currentDef(dom))) as any;
    expect(snapshot.conversation).toMatchObject({
      conversationKey: 'share-current-1',
      title: 'Shared current conversation',
    });
  });

  it('keeps a durable conversation identity stable across irrelevant query changes', () => {
    const dom = currentDom({ url: 'https://chatgpt.com/c/current-conversation-2026?model=gpt-5' });
    const def = currentDef(dom);
    const root = dom.window.document.querySelector('main');
    const before = def.collector.__test.sampleIdentityGuard(root);
    dom.window.history.replaceState({}, '', '/c/current-conversation-2026?model=gpt-5&foo=bar');
    const after = def.collector.__test.sampleIdentityGuard(root);
    expect(before.durableId).toBe('current-conversation-2026');
    expect(after.durableId).toBe(before.durableId);
    expect(after.route).toBe(before.route);
  });

  it('binds temporary-chat identity only to rendered current units and keeps it stable across prompt edits', async () => {
    const first = currentDom({
      url: 'https://chatgpt.com/?temporary-chat=true',
      turnKey: 'stable-temp-turn',
      userId: 'stable-temp-user',
      assistantId: 'stable-temp-assistant',
      assistantIds: 'stable-temp-assistant',
      userText: 'first draft',
    });
    first.window.document.title = 'ChatGPT';
    const firstSnapshot = (await capturePrepared(currentDef(first))) as any;
    expect(firstSnapshot.conversation.conversationKey).toMatch(/^chatgpt_/);
    expect(firstSnapshot.conversation.title).toBe('first draft');

    const edited = currentDom({
      url: 'https://chatgpt.com/?temporary-chat=true',
      turnKey: 'stable-temp-turn',
      userId: 'stable-temp-user',
      assistantId: 'stable-temp-assistant',
      assistantIds: 'stable-temp-assistant',
      userText: 'edited prompt',
    });
    edited.window.document.title = 'ChatGPT';
    const editedSnapshot = (await capturePrepared(currentDef(edited))) as any;
    expect(editedSnapshot.conversation.conversationKey).toBe(firstSnapshot.conversation.conversationKey);

    const emptyShell = setupChatgptDom(
      '<div data-turn-key="empty-turn"><div data-content-search-turn-key="fallback-turn-0"></div></div>',
      'https://chatgpt.com/?temporary-chat=true',
    );
    const guard = currentDef(emptyShell).collector.__test.sampleIdentityGuard(
      emptyShell.window.document.querySelector('main'),
    );
    expect(guard.anchors).toEqual([]);
  });

  it('rejects a prepared temporary capture after same-path identity replacement', async () => {
    const first = currentDef(
      currentDom({
        url: 'https://chatgpt.com/?temporary-chat=true',
        turnKey: 'temp-a',
        userId: 'user-a',
        assistantId: 'assistant-a',
        assistantIds: 'assistant-a',
      }),
    );
    const preparedCapture = await prepare(first);

    const second = currentDef(
      currentDom({
        url: 'https://chatgpt.com/?temporary-chat=true',
        turnKey: 'temp-b',
        userId: 'user-b',
        assistantId: 'assistant-b',
        assistantIds: 'assistant-b',
      }),
    );
    expect(await second.collector.capture({ manual: true, preparedCapture })).toBeNull();
  });

  it('uses current fallback-turn ordinals and the dedicated history-loading sentinel for top completeness', () => {
    const dom = currentDom();
    const turn = dom.window.document.querySelector('[data-content-search-turn-key]') as HTMLElement;
    const adapter = currentDef(dom).collector.__test.manualAdapter;

    turn.setAttribute('data-content-search-turn-key', 'fallback-turn-10');
    expect(adapter.readBoundaryState('top')).toBe('unverified');
    turn.setAttribute('data-content-search-turn-key', 'fallback-turn-0');
    expect(adapter.readBoundaryState('top')).toBe('confirmed');

    const unrelated = dom.window.document.createElement('div');
    unrelated.setAttribute('role', 'progressbar');
    dom.window.document.querySelector('main')?.prepend(unrelated);
    expect(adapter.readBoundaryState('top')).toBe('confirmed');

    const unrelatedStatus = dom.window.document.createElement('div');
    unrelatedStatus.setAttribute('role', 'status');
    dom.window.document.querySelector('main')?.prepend(unrelatedStatus);
    expect(adapter.readBoundaryState('top')).toBe('confirmed');
    unrelatedStatus.remove();

    const boundary = dom.window.document.createElement('div');
    boundary.setAttribute('data-chatgpt-conversation-selection-target', 'current-conversation-id');
    boundary.innerHTML = '<div role="status"><div data-loading-indicator=""><svg></svg></div></div>';
    dom.window.document.querySelector('main')?.prepend(boundary);
    expect(adapter.readBoundaryState('top')).toBe('pending');
    boundary.remove();
    expect(adapter.readBoundaryState('top')).toBe('confirmed');
  });

  it('does not mistake fallback-turn-0 for the true top while the real transcript spinner is visible', async () => {
    const dom = currentDom();
    const main = dom.window.document.querySelector('main')!;
    const loader = dom.window.document.createElement('div');
    loader.setAttribute('data-chatgpt-conversation-selection-target', 'current-conversation-id');
    loader.setAttribute('data-rail-chat-transcript', 'true');
    loader.innerHTML =
      '<div class="flex items-center justify-center gap-2 py-4">' +
      '<div role="status"><div data-loading-indicator=""><svg></svg></div></div></div>';
    main.prepend(loader);
    const def = currentDef(dom);
    expect(def.collector.__test.manualAdapter.readBoundaryState('top')).toBe('pending');
    let clock = 0;
    const prepared = await prepare(def, {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += Math.max(1, ms);
      },
      pollMs: 4,
      boundaryTimeoutMs: 40,
      totalDeadlineMs: 300,
    });
    expect(prepared.metrics.reachedTop).toBe(false);
    expect(prepared.reasons).toContain('boundary_stalled');
    expect(prepared.reasons).toContain('top_not_reached');
    expect(prepared.completeness).toBe('partial');

    loader.remove();
    const finished = await prepare(def, {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += Math.max(1, ms);
      },
    });
    expect(finished.metrics.reachedTop).toBe(true);
    expect(finished.reasons).not.toContain('boundary_stalled');
  });

  it('stops a manual history scan when the ChatGPT tab becomes hidden', async () => {
    const dom = currentDom();
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    const def = currentDef(dom);
    expect(def.collector.__test.manualAdapter.readBoundaryState('top')).toBe('unverified');
    expect(def.collector.__test.manualAdapter.readBoundaryState('bottom')).toBe('unverified');
    const prepared = await prepare(def);
    expect(prepared.completeness).toBe('partial');
    expect(prepared.reasons).toContain('bottom_not_reached');
    expect(prepared.metrics.reachedTop).toBe(false);
  });

  it('ignores a zero-height home main ahead of the active ChatGPT conversation', async () => {
    const dom = currentDom();
    const actual = dom.window.document.querySelector('main') as HTMLElement;
    actual.insertAdjacentHTML('afterbegin', '<div data-rail-chat-transcript="true"></div>');
    actual.getBoundingClientRect = () =>
      ({ top: 0, bottom: 700, left: 0, right: 900, width: 900, height: 700 }) as DOMRect;
    const hidden = dom.window.document.createElement('main');
    hidden.innerHTML = '<div data-app-action-timeline-scroll></div>';
    hidden.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    dom.window.document.body.prepend(hidden);
    const def = currentDef(dom);
    expect(def.collector.__test.manualAdapter.readRoot()).toBe(actual);
    const snapshot = await capturePrepared(def);
    expect(snapshot?.messages.map((message: any) => message.messageKey)).toEqual([
      'user-message-1',
      'assistant-message-1',
    ]);
  });

  it('uses the rendered transcript instead of stale hidden conversation turns', async () => {
    const dom = currentDom({ userText: 'new active message' });
    const current = dom.window.document.querySelector('main') as HTMLElement;
    current.insertAdjacentHTML('afterbegin', '<div data-rail-chat-transcript="true"></div>');
    current.getBoundingClientRect = () =>
      ({ top: 0, bottom: 700, left: 0, right: 800, width: 800, height: 700 }) as DOMRect;
    const stale = dom.window.document.createElement('main');
    stale.innerHTML =
      '<div data-rail-chat-transcript="true"><div data-turn-key="stale"><div data-content-search-turn-key="fallback-turn-0">' +
      '<div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="old-id">' +
      '<div data-user-message-bubble><div class="whitespace-pre-wrap">old session</div></div></div></div></div></div>';
    stale.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    dom.window.document.body.prepend(stale);
    const def = currentDef(dom);
    expect(def.collector.__test.manualAdapter.readRoot()).toBe(current);
    const snapshot = await capturePrepared(def);
    expect(snapshot?.messages.some((m: any) => m.messageKey === 'old-id')).toBe(false);
    expect(snapshot?.messages[0]?.contentMarkdown).toBe('new active message');
  });

  it('uses the current inner timeline scroller as the manual sweep seed', () => {
    const dom = currentDom();
    const main = dom.window.document.querySelector('main') as HTMLElement;
    const scroller = dom.window.document.createElement('div');
    scroller.setAttribute('data-app-action-timeline-scroll', '');
    while (main.firstChild) scroller.appendChild(main.firstChild);
    main.appendChild(scroller);
    expect(currentDef(dom).collector.__test.manualAdapter.readScrollSeed()).toBe(scroller);
  });
});
