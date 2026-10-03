import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '@collectors/collector-utils.ts';
import {
  addPreparedReason,
  createPreparedAccumulator,
  createPreparedCaptureConsumer,
  createScrollRootRestorer,
  finishPreparedCapture,
  mergePreparedRecords,
  type PreparedAccumulator,
  type PreparedIdentityGuard,
  type PreparedMessageRecord,
} from '@collectors/virtualized-chat/virtualized-chat-sweep.ts';
import poeMarkdownApi from '@collectors/poe/poe-markdown.ts';

export function createPoeCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('poe');
  const window = env.window;
  const document = env.document;
  const location = env.location;

  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)poe\.com$/.test(hostname);
  }

  function findConversationIdFromUrl(): string {
    const match = String(location.pathname || '').match(/^\/chat\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  function isValidConversationUrl(): boolean {
    return !!findConversationIdFromUrl();
  }

  function isConversationSurfaceUrl(): boolean {
    const path = String(location.pathname || '');
    return path === '/' || /^\/chat(?:\/|$)/.test(path);
  }

  function normalizedRoute(): string {
    const pathname = String(location.pathname || '/').replace(/\/+$/, '') || '/';
    return `${String(location.hostname || '').toLowerCase()}${pathname}`;
  }

  function findTitle(): any {
    const selectors = [
      "div[class*='BaseNavbar_chatTitleItem__'] p[class*='ChatHeader_titleText__']",
      "div[class*='ChatHeader_titleRow__'] p[class*='ChatHeader_titleText__']",
      "p[class*='ChatHeader_titleText__']",
      "a[class*='BotHeader_title__'] p",
      "div[class*='BotHeader_textContainer__'] p",
      'h1',
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = node && node.textContent ? node.textContent.trim() : '';
      if (text) return text;
    }
    return document.title || 'Poe';
  }

  function getConversationRoot(): any {
    // Poe groups messages by date buckets:
    // tupleGroupContainer -> (MessageDate label) + (one or more messageTuple)
    // If we pick only the first messageTuple's parent, we may only capture one date bucket.
    const group = document.querySelector("div[class*='ChatMessagesView_tupleGroupContainer__']");
    if (group && group.parentElement) return group.parentElement;

    const tuple = document.querySelector("div[class*='ChatMessagesView_messageTuple__']");
    if (tuple) {
      const tupleGroup = tuple.closest ? tuple.closest("div[class*='ChatMessagesView_tupleGroupContainer__']") : null;
      if (tupleGroup && tupleGroup.parentElement) return tupleGroup.parentElement;
      if (tuple.parentElement) return tuple.parentElement;
    }

    const msg = document.querySelector("div[class*='ChatMessage_chatMessage__'][id^='message-']");
    if (msg && msg.parentElement) return msg.parentElement;

    return document.querySelector('main') || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function poeMarkdown(): any {
    return poeMarkdownApi || {};
  }

  function sortByDomOrder(nodes: any): any {
    const sorted: any[] = Array.from(nodes || []) as any[];
    const DOCUMENT_POSITION_FOLLOWING = window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
    const DOCUMENT_POSITION_PRECEDING = window?.Node?.DOCUMENT_POSITION_PRECEDING ?? 2;
    sorted.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return sorted;
  }

  function sleep(ms: any): any {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function isUserWrapper(wrapper: any): any {
    if (!wrapper || !wrapper.querySelector) return false;
    return !!(
      wrapper.querySelector("[class*='ChatMessage_rightSideMessageWrapper__']") ||
      wrapper.querySelector("[class*='Message_rightSideMessageBubble__']") ||
      wrapper.querySelector("[class*='Message_rightSideMessageRow__']")
    );
  }

  function isAssistantWrapper(wrapper: any): any {
    if (!wrapper || !wrapper.querySelector) return false;
    return !!(
      wrapper.querySelector("[class*='LeftSideMessageHeader_leftSideMessageHeader__']") ||
      wrapper.querySelector("[class*='Message_leftSideMessageBubble__']") ||
      wrapper.querySelector("[class*='Message_leftSideMessageRow__']")
    );
  }

  function contentNodeFromWrapper(wrapper: any): any {
    if (!wrapper || !wrapper.querySelector) return wrapper;
    const textContainer = wrapper.querySelector("div[class*='Message_messageTextContainer__']");
    const selectable = textContainer ? textContainer.querySelector("div[class*='Message_selectableText__']") : null;
    return selectable || textContainer || wrapper;
  }

  function imageScopeFromWrapper(wrapper: any): any {
    if (!wrapper || !wrapper.querySelector) return wrapper;
    const bubble = wrapper.querySelector(
      "div[class*='Message_leftSideMessageBubble__'], div[class*='Message_rightSideMessageBubble__']",
    );
    if (bubble) return bubble;
    const bubbleWrapper = wrapper.querySelector("div[class*='Message_messageBubbleWrapper__']");
    if (bubbleWrapper) return bubbleWrapper;
    return wrapper.querySelector("div[class*='Message_messageTextContainer__']") || wrapper;
  }

  function getMessageWrappers(root: any): any {
    const scope = root || document;
    const out: any[] = [];

    const tuples: any[] = Array.from(scope.querySelectorAll("div[class*='ChatMessagesView_messageTuple__']")) as any[];
    for (const t of tuples) {
      const msgs: any[] = Array.from(t.querySelectorAll("div[class*='ChatMessage_chatMessage__']")) as any[];
      for (const m of msgs) out.push(m);
    }

    if (!out.length) {
      const msgs: any[] = Array.from(
        scope.querySelectorAll("div[class*='ChatMessage_chatMessage__'][id^='message-']"),
      ) as any[];
      out.push(...msgs);
    }

    const sorted = sortByDomOrder(out);
    // De-dup nested or repeated candidates.
    const finalNodes: any[] = [];
    for (const node of sorted) {
      if (!node) continue;
      const isChild = finalNodes.some((p) => p && p.contains && p.contains(node));
      if (!isChild) finalNodes.push(node);
    }
    return finalNodes;
  }

  function isScrollableElement(el: any): any {
    if (!el) return false;
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    const canScroll = Number(el.scrollHeight || 0) > Number(el.clientHeight || 0) + 20;
    if (el === scrollingRoot || el === document.documentElement || el === document.body) {
      return canScroll;
    }

    let overflowY = '';
    try {
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      overflowY = String((win && win.getComputedStyle ? win.getComputedStyle(el).overflowY : '') || '');
    } catch (_e) {
      overflowY = '';
    }
    const styleScrollable = /(auto|scroll|overlay)/i.test(overflowY);
    return canScroll && (styleScrollable || !overflowY);
  }

  function isScrollCandidate(el: any): any {
    if (!el) return false;
    return Number(el.scrollHeight || 0) > Number(el.clientHeight || 0) + 20;
  }

  function findScrollContainer(root: any): any {
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    const seed =
      root && root.querySelector
        ? root.querySelector("div[class*='ChatMessagesView_messageTuple__']") ||
          root.querySelector("div[class*='ChatMessage_chatMessage__'][id^='message-']") ||
          root
        : root;

    let el = seed;
    for (let depth = 0; depth < 24 && el; depth += 1) {
      if (isScrollableElement(el)) return el;
      el = el.parentElement;
    }

    el = seed;
    for (let depth = 0; depth < 24 && el; depth += 1) {
      if (isScrollCandidate(el)) return el;
      el = el.parentElement;
    }

    if (isScrollableElement(scrollingRoot)) return scrollingRoot;
    return scrollingRoot;
  }

  function scrollContainerToTop(container: any): any {
    if (!container) return;
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    if (container === scrollingRoot || container === document.documentElement || container === document.body) {
      if (scrollingRoot) scrollingRoot.scrollTop = 0;
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      return;
    }
    container.scrollTop = 0;
  }

  function getScrollRoot(): Element | null {
    return (
      document.querySelector("div[class*='ChatMessagesScrollWrapper_scrollableContainerWrapper__']") ||
      findScrollContainer(getConversationRoot())
    );
  }

  function messageKeyFromWrapper(wrapper: any): string {
    const id = wrapper?.getAttribute ? String(wrapper.getAttribute('id') || '').trim() : '';
    return /^message-/.test(id) ? id : '';
  }

  function collectMessages(): any[] {
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    const markdown = poeMarkdown();
    const out: any[] = [];
    let sequence = 0;

    for (const wrapper of wrappers) {
      const key = messageKeyFromWrapper(wrapper);
      const role = isUserWrapper(wrapper) ? 'user' : isAssistantWrapper(wrapper) ? 'assistant' : '';
      if (!key || !role || String(wrapper.getAttribute?.('data-complete') || 'true') === 'false') continue;

      const node = contentNodeFromWrapper(wrapper);
      const raw =
        node && ((node as any).innerText || node.textContent) ? (node as any).innerText || node.textContent : '';
      const fallbackText = env.normalize.normalizeText(raw);
      const contentText =
        typeof markdown.extractMessageText === 'function'
          ? String(markdown.extractMessageText(wrapper, role) || '')
          : fallbackText;
      const imageUrls = extractImageUrlsFromElement(imageScopeFromWrapper(wrapper));
      let contentMarkdown =
        typeof markdown.extractMessageMarkdown === 'function'
          ? String(markdown.extractMessageMarkdown(wrapper, role) || '')
          : contentText;
      if (!contentMarkdown) contentMarkdown = contentText;
      if (!contentText && !imageUrls.length) continue;

      out.push({
        messageKey: key,
        role,
        contentMarkdown: appendImageMarkdown(contentMarkdown, imageUrls),
        sequence,
        updatedAt: Date.now(),
      });
      sequence += 1;
    }
    return out;
  }

  function compactFingerprint(value: string): string {
    return typeof env.normalize.fnv1a32 === 'function' ? String(env.normalize.fnv1a32(value)) : value;
  }

  function sampleIdentityGuard(): PreparedIdentityGuard {
    const anchors = getMessageWrappers(getConversationRoot()).map(messageKeyFromWrapper).filter(Boolean);
    return {
      route: normalizedRoute(),
      durableId: findConversationIdFromUrl(),
      anchors,
      topAnchor: anchors[0] || '',
    };
  }

  function identityGuardsMatch(expected: PreparedIdentityGuard, actual: PreparedIdentityGuard): boolean {
    return (
      !!expected?.route &&
      expected.route === actual?.route &&
      !!expected.durableId &&
      expected.durableId === actual?.durableId
    );
  }

  function createIdentitySampler(expected: PreparedIdentityGuard): () => string | null {
    const identity = expected.route && expected.durableId ? `${expected.route}|durable:${expected.durableId}` : '';
    return () => {
      if (!identity || normalizedRoute() !== expected.route) return null;
      return findConversationIdFromUrl() === expected.durableId ? identity : null;
    };
  }

  async function harvestCurrentInto(
    accumulator: PreparedAccumulator<any>,
  ): Promise<{ added: number; updated: number }> {
    const messages = collectMessages();
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = messages.map((message) => ({
      key: message.messageKey,
      turnKey: message.messageKey,
      withinTurn: 0,
      fingerprint: compactFingerprint([message.messageKey, message.role, message.contentMarkdown].join('\u001f')),
      payload: message,
    }));
    if (
      getMessageWrappers(getConversationRoot()).some(
        (wrapper: any) => wrapper.getAttribute?.('data-complete') === 'false',
      )
    ) {
      addPreparedReason(accumulator, 'unresolved_turn');
    }
    return mergePreparedRecords(accumulator, records);
  }

  function currentWindowSignature(): string {
    const root = getScrollRoot() as HTMLElement | null;
    const wrappers = getMessageWrappers(getConversationRoot());
    return `${wrappers
      .map((wrapper: any) => `${messageKeyFromWrapper(wrapper)}:${wrapper.getAttribute?.('data-complete') || ''}`)
      .join('|')}|${Number(root?.scrollHeight || 0)}`;
  }

  async function waitForHistoryChange(
    previousSignature: string,
    options: { waitForLoadMs: number; pollMs: number; sleep: (ms: number) => Promise<void>; now: () => number },
  ): Promise<boolean> {
    const deadline = options.now() + options.waitForLoadMs;
    while (options.now() <= deadline) {
      await options.sleep(options.pollMs);
      if (currentWindowSignature() !== previousSignature) return true;
    }
    return false;
  }

  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    const scrollRoot = getScrollRoot() as HTMLElement | null;
    if (!root || !scrollRoot || inEditMode(root)) return null;

    const initialGuard = sampleIdentityGuard();
    const accumulator = createPreparedAccumulator<any>({
      source: 'poe',
      conversationKey: initialGuard.durableId,
      identityVerified: !!initialGuard.durableId,
      identityGuard: initialGuard,
    });
    accumulator.completeness = 'partial';
    addPreparedReason(accumulator, 'top_not_reached');

    const sampleIdentity = createIdentitySampler(initialGuard);
    const restorer = createScrollRootRestorer({
      document: env.document,
      window: env.window,
      getSeed: getScrollRoot,
      sampleIdentity,
    });
    const maxRounds = Math.max(1, Math.min(50, Number(options.maxRounds) || 24));
    const stableRoundsRequired = Math.max(1, Math.min(5, Number(options.stableRounds) || 2));
    const waitForLoadMs = Math.max(20, Number(options.waitForLoadMs) || 900);
    const pollMs = Math.max(0, Number(options.pollMs) || 80);
    const sleepFn = options.sleep || sleep;
    const now = options.now || Date.now;
    let stableRounds = 0;

    try {
      await harvestCurrentInto(accumulator);
      for (let round = 0; round < maxRounds && stableRounds < stableRoundsRequired; round += 1) {
        const before = currentWindowSignature();
        scrollContainerToTop(scrollRoot);
        const changed = await waitForHistoryChange(before, { waitForLoadMs, pollMs, sleep: sleepFn, now });
        if (!sampleIdentity()) {
          accumulator.identityVerified = false;
          accumulator.conversationKey = '';
          accumulator.records = [];
          addPreparedReason(accumulator, 'identity_changed');
          break;
        }
        await harvestCurrentInto(accumulator);
        stableRounds = changed ? 0 : stableRounds + 1;
      }
    } finally {
      const restored = restorer.restore();
      if (!restored.restored) addPreparedReason(accumulator, 'restore_failed');
    }

    const finalGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(initialGuard, finalGuard)) {
      accumulator.identityVerified = false;
      accumulator.conversationKey = '';
      accumulator.records = [];
      addPreparedReason(accumulator, 'identity_changed');
    }
    return finishPreparedCapture(accumulator);
  }

  async function capture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl() || options?.manual !== true) {
      return null;
    }
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return null;
    const prepared = consumePreparedCapture(options.preparedCapture);
    if (!prepared || !identityGuardsMatch(prepared.identityGuard, sampleIdentityGuard())) return null;

    const accumulator = createPreparedAccumulator<any>({
      source: 'poe',
      conversationKey: prepared.conversationKey,
      identityVerified: prepared.identityVerified === true,
      identityGuard: prepared.identityGuard,
    });
    accumulator.completeness = 'partial';
    accumulator.reasons.push(...prepared.reasons.filter((reason: string) => !accumulator.reasons.includes(reason)));
    accumulator.sweepMetrics = { ...prepared.metrics };
    mergePreparedRecords(
      accumulator,
      prepared.records.map(({ firstSeenIndex: _firstSeenIndex, ...record }: any) => record),
    );
    await harvestCurrentInto(accumulator);

    if (!identityGuardsMatch(accumulator.identityGuard, sampleIdentityGuard())) return null;
    const finalPrepared = finishPreparedCapture(accumulator);
    const messages = finalPrepared.records.map((record, index) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !finalPrepared.identityVerified || !finalPrepared.conversationKey) return null;

    return {
      conversation: {
        sourceType: 'chat',
        source: 'poe',
        conversationKey: finalPrepared.conversationKey,
        title: findTitle(),
        url: env.location.href,
        warningFlags: [],
      },
      messages,
      captureMeta: {
        completeness: 'partial',
        identityVerified: true,
        reasons: finalPrepared.reasons,
        metrics: finalPrepared.metrics,
      },
    };
  }

  const collector: any = {
    capture,
    isCaptureAvailable: isConversationSurfaceUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
  };
  const markdown = poeMarkdown();
  collector.__test = {
    removeThinkingNodes: markdown.removeThinkingNodes,
    removeNonContentNodes: markdown.removeNonContentNodes,
    normalizeMarkdown: markdown.normalizeMarkdown,
    htmlToMarkdown: markdown.htmlToMarkdown,
    extractTextFromSanitizedClone: markdown.extractTextFromSanitizedClone,
    extractMessageMarkdown: markdown.extractMessageMarkdown,
    extractMessageText: markdown.extractMessageText,
    currentWindowSignature,
    getMessageWrappers,
  };

  return { id: 'poe', matches, collector };
}
