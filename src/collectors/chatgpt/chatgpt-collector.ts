import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import { appendImageMarkdown, extractImageUrlsFromElement } from '@collectors/collector-utils.ts';
import chatgptMarkdown from '@collectors/chatgpt/chatgpt-markdown.ts';
import {
  addPreparedReason,
  createPreparedAccumulator,
  createScrollRootRestorer,
  finishPreparedCapture,
  mergePreparedRecords,
  createPreparedCaptureConsumer,
  runVirtualizedSweep,
  resolveScrollRoot,
  writeScrollPosition,
  type PreparedAccumulator,
  type PreparedIdentityGuard,
  type PreparedMessageRecord,
} from '@collectors/virtualized-chat/virtualized-chat-sweep.ts';

// ---- Pure turn primitives ----
// These are env-free and side-effect-free (they never scroll or mutate the DOM), so they can be
// unit-tested directly and reused by both the live collector and the manual scroll-sweep path.

// Stable per-turn key. Prefers the turn UUID (data-turn-id), which is identical between a
// virtualized empty shell and its hydrated form; falls back to message id, then testid, then id.
export function turnKeyOf(el: any): string {
  if (!el) return '';
  const turn = el.closest ? el.closest('[data-turn-id]') : null;
  const turnId = turn && turn.getAttribute ? turn.getAttribute('data-turn-id') : '';
  if (turnId) return String(turnId);
  if (el.getAttribute) {
    const messageId = el.getAttribute('data-message-id');
    if (messageId) return String(messageId);
    const testid = el.getAttribute('data-testid');
    if (testid) return String(testid);
  }
  return el.id ? String(el.id) : '';
}

export function createChatgptCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('chatgpt');

  function findDeepResearchIframe(wrapper: any): any | null {
    if (!wrapper || !wrapper.querySelector) return null;
    const nodes = Array.from(wrapper.querySelectorAll("iframe[title='internal://deep-research']")) as any[];
    if (!nodes.length) return null;
    if (nodes.length === 1) return nodes[0];

    // Some turns keep multiple deep-research iframes in the DOM (stale duplicates). Prefer the most visible one.
    let best: any | null = null;
    let bestArea = -1;
    for (const node of nodes) {
      if (!node || typeof node.getBoundingClientRect !== 'function') continue;
      let rect: any = null;
      try {
        rect = node.getBoundingClientRect();
      } catch (_e) {
        rect = null;
      }
      const width = Number(rect?.width) || 0;
      const height = Number(rect?.height) || 0;
      const area = width * height;
      if (!area) continue;
      try {
        const style = env.window?.getComputedStyle ? env.window.getComputedStyle(node) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) continue;
      } catch (_e) {
        // ignore
      }
      if (area > bestArea) {
        bestArea = area;
        best = node;
      }
    }

    return best || nodes[0] || null;
  }

  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname);
  }

  function findConversationIdFromUrl(): any {
    const m =
      env.location.pathname.match(/^\/c\/([^/?#]+)/) || env.location.pathname.match(/^\/g\/[^/]+\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : '';
  }

  function findShareIdFromUrl(): string {
    const match = env.location.pathname.match(/^\/share\/([^/?#]+)/);
    return match?.[1] ? String(match[1]) : '';
  }

  function normalizedRoute(): string {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    const search = String(env.location.search || '');
    return `${String(env.location.hostname || '').toLowerCase()}${pathname}${search}`;
  }

  function hashStableIdentity(value: string): string {
    const hash = env.normalize?.fnv1a32 ? env.normalize.fnv1a32(value) : value;
    return String(hash);
  }

  function directMessageId(element: any): string {
    const direct = String(element?.getAttribute?.('data-message-id') || '').trim();
    if (direct) return direct;
    const nested = element?.querySelector?.('[data-message-id]');
    return String(nested?.getAttribute?.('data-message-id') || '').trim();
  }

  function explicitTurnId(element: any): string {
    const turn =
      element?.closest?.('[data-turn-id]') ||
      (element?.getAttribute?.('data-turn-id') ? element : element?.querySelector?.('[data-turn-id]'));
    return String(turn?.getAttribute?.('data-turn-id') || '').trim();
  }

  function stableManualMessageKey(element: any, role: string, turnKey: string, withinTurn: number): string {
    const messageId = directMessageId(element);
    if (messageId) return messageId;
    if (!turnKey || (role !== 'user' && role !== 'assistant')) return '';
    return `${turnKey}:${role}:${withinTurn}`;
  }

  function readTurnShells(root: any): any[] {
    if (!root?.querySelectorAll) return [];
    return Array.from(
      root.querySelectorAll("[data-testid^='conversation-turn-'], [data-testid='conversation-turn']"),
    ) as any[];
  }

  function sampleIdentityGuard(root: any): PreparedIdentityGuard {
    const durableId = findConversationIdFromUrl() || findShareIdFromUrl();
    const anchors: string[] = [];
    const seen = new Set<string>();
    const push = (value: unknown) => {
      const anchor = String(value || '').trim();
      if (!anchor || seen.has(anchor)) return;
      seen.add(anchor);
      anchors.push(anchor);
    };
    for (const turn of readTurnShells(root)) {
      const turnId = explicitTurnId(turn);
      if (turnId) push(`turn:${turnId}`);
    }
    const perTurn = new Map<string, number>();
    for (const wrapper of getTurnWrappers(root)) {
      const turnId = explicitTurnId(wrapper);
      const withinTurn = perTurn.get(turnId) || 0;
      perTurn.set(turnId, withinTurn + 1);
      push(stableManualMessageKey(wrapper, roleFromWrapper(wrapper), turnId, withinTurn));
    }
    const topAnchor = anchors[0] || '';
    return { route: normalizedRoute(), durableId, anchors, topAnchor };
  }

  function identityConversationKey(guard: PreparedIdentityGuard): string {
    if (guard.durableId) return guard.durableId;
    return guard.topAnchor ? `chatgpt_${hashStableIdentity(guard.topAnchor)}` : '';
  }

  function mergeIdentityAnchors(target: PreparedIdentityGuard, current: PreparedIdentityGuard): void {
    const seen = new Set(target.anchors);
    for (const anchor of current.anchors) {
      if (!anchor || seen.has(anchor)) continue;
      seen.add(anchor);
      target.anchors.push(anchor);
    }
  }

  function createNavigationIdentitySampler(): () => string | null {
    const route = normalizedRoute();
    const durableId = findConversationIdFromUrl() || findShareIdFromUrl();
    const stableIdentity = route ? `${route}|${durableId ? `durable:${durableId}` : 'temporary-session'}` : '';
    return () => {
      if (!stableIdentity || normalizedRoute() !== route) return null;
      const currentDurableId = findConversationIdFromUrl() || findShareIdFromUrl();
      if (durableId || currentDurableId) return durableId && currentDurableId === durableId ? stableIdentity : null;
      return stableIdentity;
    };
  }

  function identityGuardsMatch(expected: PreparedIdentityGuard, actual: PreparedIdentityGuard): boolean {
    if (!expected || !actual || expected.route !== actual.route) return false;
    if (expected.durableId || actual.durableId) {
      return !!expected.durableId && expected.durableId === actual.durableId;
    }
    if (!expected.anchors.length || !actual.anchors.length) return false;
    const actualAnchors = new Set(actual.anchors);
    return expected.anchors.some((anchor) => actualAnchors.has(anchor));
  }

  function createCaptureIdentitySampler(expected: PreparedIdentityGuard): () => string | null {
    const stableIdentity = expected.route
      ? `${expected.route}|${expected.durableId ? `durable:${expected.durableId}` : 'temporary-session'}`
      : '';
    return () => {
      if (!stableIdentity || normalizedRoute() !== expected.route) return null;
      const currentDurableId = findConversationIdFromUrl() || findShareIdFromUrl();
      if (expected.durableId || currentDurableId) {
        return expected.durableId && currentDurableId === expected.durableId ? stableIdentity : null;
      }
      return stableIdentity;
    };
  }

  function isTemporaryChatMode(): boolean {
    try {
      const params = new URLSearchParams(String(env.location.search || '').replace(/^\?/, ''));
      const value = String(params.get('temporary-chat') || '')
        .trim()
        .toLowerCase();
      return value === 'true' || value === '1' || value === 'yes' || value === 'on';
    } catch (_e) {
      return false;
    }
  }

  function normalizeTitleText(value: unknown): string {
    return String(value || '').trim();
  }

  function isGenericChatgptTitle(value: unknown): boolean {
    const normalized = normalizeTitleText(value).toLowerCase();
    return normalized === '' || normalized === 'chatgpt';
  }

  function deriveTemporaryChatAutoTitle(messages: any): string {
    const firstUser = Array.isArray(messages)
      ? messages.find((m: any) => m && m.role === 'user' && m.contentText)
      : null;
    const raw = firstUser ? String(firstUser.contentText || '') : '';
    const normalized = env.normalize && env.normalize.normalizeText ? env.normalize.normalizeText(raw) : raw;
    const text = String(normalized || '').trim();
    if (!text) return '';
    const maxLen = 56;
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1).trimEnd()}…`;
  }

  function findTitle(messages?: any): any {
    const conversationId = findConversationIdFromUrl();

    if (conversationId) {
      const activeLinks = Array.from(env.document.querySelectorAll("a[aria-current='page'][href]")) as any[];
      const active = activeLinks.find((a: any) =>
        String(a?.getAttribute?.('href') || '').includes(`/c/${conversationId}`),
      );
      const activeText = active && active.textContent ? String(active.textContent).trim() : '';
      if (activeText) return activeText;

      const hrefLinks = Array.from(env.document.querySelectorAll('a[href]')) as any[];
      const byHref = hrefLinks.find((a: any) =>
        String(a?.getAttribute?.('href') || '').includes(`/c/${conversationId}`),
      );
      const hrefText = byHref && byHref.textContent ? String(byHref.textContent).trim() : '';
      if (hrefText) return hrefText;
    }

    const h = env.document.querySelector('h1');
    const t = h && h.textContent ? h.textContent.trim() : '';
    const fallbackTitle = t || env.document.title || 'ChatGPT';
    if (!conversationId && isTemporaryChatMode() && isGenericChatgptTitle(fallbackTitle)) {
      const temporaryTitle = deriveTemporaryChatAutoTitle(messages);
      if (temporaryTitle) return temporaryTitle;
    }
    return fallbackTitle;
  }

  function getConversationRoot(): any {
    return env.document.querySelector('main') || env.document.querySelector("[role='main']") || env.document.body;
  }

  function inEditMode(root: any): any {
    if (!root) return false;
    const ta = root.querySelector('textarea');
    if (!ta) return false;
    return env.document.activeElement === ta || ta.contains(env.document.activeElement);
  }

  function userContentNode(element: any): any {
    return element.querySelector('.whitespace-pre-wrap') || element;
  }

  function assistantContentNode(element: any): any {
    return element.querySelector('.markdown.prose') || element.querySelector('.markdown') || element;
  }

  type ChatgptDescriptor = {
    key: string;
    turnKey: string;
    withinTurn: number;
    role: 'user' | 'assistant';
    fingerprint: string;
    hasDeepResearch: boolean;
    rendered: boolean;
  };

  type ChatgptExtractionInput = ChatgptDescriptor & {
    outerHtml: string;
    imageUrls: string[];
    iframeUrl: string;
  };

  function getTurnWrappers(root: any): any {
    const scope = root || env.document;
    const DOCUMENT_POSITION_FOLLOWING = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;

    function sortInDocumentOrder(nodes: any[]): any[] {
      const sorted = nodes.slice();
      sorted.sort((a: any, b: any) => {
        if (a === b) return 0;
        return a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      return sorted;
    }

    function dropAncestors(nodes: any[]): any[] {
      if (!nodes.length) return nodes;
      return nodes.filter((node: any) => !nodes.some((other: any) => other !== node && node.contains(other)));
    }

    const roleNodes = Array.from(scope.querySelectorAll('[data-message-author-role]')) as any[];
    // Modern ChatGPT wraps each turn with `data-testid="conversation-turn-N"` but the tag varies (`article`, `section`, etc).
    const turnNodes = Array.from(
      scope.querySelectorAll("[data-testid^='conversation-turn-'], [data-testid='conversation-turn']"),
    ) as any[];

    // Prefer message-level nodes if available. Some modern ChatGPT DOMs group multiple assistant
    // messages inside a single `.agent-turn` container; keeping `.agent-turn` as the wrapper would
    // only capture the first message.
    if (roleNodes.length) {
      const picked = dropAncestors(roleNodes);
      const extraTurns = turnNodes.filter((turn: any) => !picked.some((node: any) => turn.contains(node)));
      return sortInDocumentOrder(
        dropAncestors(Array.from(new Set(picked.concat(extraTurns).filter(Boolean))) as any[]),
      );
    }

    if (turnNodes.length) {
      return sortInDocumentOrder(dropAncestors(turnNodes));
    }

    const agentTurnNodes = Array.from(scope.querySelectorAll('.agent-turn')) as any[];
    return sortInDocumentOrder(dropAncestors(agentTurnNodes));
  }

  function roleFromWrapper(wrapper: any): any {
    const direct = wrapper && wrapper.getAttribute ? wrapper.getAttribute('data-message-author-role') : '';
    if (direct === 'user' || direct === 'assistant') return direct;

    const turnRole = wrapper && wrapper.getAttribute ? wrapper.getAttribute('data-turn') : '';
    if (turnRole === 'user' || turnRole === 'assistant') return turnRole;

    const inner = wrapper && wrapper.querySelector ? wrapper.querySelector('[data-message-author-role]') : null;
    const innerRole = inner && inner.getAttribute ? inner.getAttribute('data-message-author-role') : '';
    if (innerRole === 'user' || innerRole === 'assistant') return innerRole;

    if (wrapper && wrapper.classList && wrapper.classList.contains('agent-turn')) return 'assistant';
    if (wrapper && wrapper.querySelector && wrapper.querySelector("div[class*='user']")) return 'user';
    return 'assistant';
  }

  // Extract a single message from one turn wrapper. Returns null when the wrapper has no
  // textual content and no images (e.g. virtualized empty shells), so callers can skip it.
  async function extractMessageFromWrapper(el: any, i: number, { messageKeyOverride }: any = {}): Promise<any | null> {
    const role = roleFromWrapper(el);
    const messageId =
      (el.getAttribute && (el.getAttribute('data-message-id') || el.getAttribute('data-turn-id') || el.id)) || '';
    const node = role === 'user' ? userContentNode(el) : assistantContentNode(el);
    const raw = node ? node.innerText || node.textContent || '' : '';
    const fallbackText = env.normalize.normalizeText(raw);
    let contentText =
      role === 'assistant' && typeof chatgptMarkdown.extractAssistantText === 'function'
        ? chatgptMarkdown.extractAssistantText(el) || fallbackText
        : fallbackText;
    const imageUrls = (() => {
      const primary = extractImageUrlsFromElement(node || el);
      if (!node || node === el) return primary;
      const secondary = extractImageUrlsFromElement(el);
      return Array.from(new Set(primary.concat(secondary)));
    })();

    let baseMarkdown =
      role === 'assistant' && typeof chatgptMarkdown.extractAssistantMarkdown === 'function'
        ? chatgptMarkdown.extractAssistantMarkdown(el) || contentText || ''
        : contentText || '';

    const deepResearchIframe = role === 'assistant' ? findDeepResearchIframe(el) : null;
    if (role === 'assistant' && deepResearchIframe) {
      const iframeUrl = String(deepResearchIframe.getAttribute?.('src') || '').trim();
      const placeholder = iframeUrl ? `Deep Research (iframe): ${iframeUrl}` : 'Deep Research (iframe)';
      contentText = placeholder;
      baseMarkdown = placeholder;
    }

    if (!contentText && !imageUrls.length) return null;
    const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls);
    const messageKey =
      String(messageKeyOverride || '').trim() ||
      messageId ||
      env.normalize.makeFallbackMessageKey({ role, contentText, sequence: i });
    return {
      messageKey,
      role,
      contentText,
      contentMarkdown,
      sequence: i,
      updatedAt: Date.now(),
    };
  }

  function compactFingerprintPart(value: string): string {
    const normalized = String(value || '');
    return env.normalize?.fnv1a32 ? String(env.normalize.fnv1a32(normalized)) : normalized;
  }

  function descriptorFingerprint(input: {
    role: string;
    key: string;
    text: string;
    imageUrls: string[];
    iframeUrl: string;
  }): string {
    const imageRefs = input.imageUrls.join('|');
    const source = `${input.role}|${input.key}|${input.text.length}|${compactFingerprintPart(input.text)}|${
      input.imageUrls.length
    }|${compactFingerprintPart(imageRefs)}|${compactFingerprintPart(input.iframeUrl)}`;
    return compactFingerprintPart(source);
  }

  function readCurrentManualWindow(includeInputs = false): {
    descriptors: ChatgptDescriptor[];
    inputsByKey: Map<string, ChatgptExtractionInput>;
  } {
    const root = getConversationRoot();
    const descriptors: ChatgptDescriptor[] = [];
    const inputsByKey = new Map<string, ChatgptExtractionInput>();
    if (!root) return { descriptors, inputsByKey };
    const wrappers = getTurnWrappers(root);
    const perTurn = new Map<string, number>();
    for (const wrapper of wrappers) {
      const role = roleFromWrapper(wrapper);
      const turnKey = turnKeyOf(wrapper);
      const withinTurn = perTurn.get(turnKey) || 0;
      perTurn.set(turnKey, withinTurn + 1);
      const key = stableManualMessageKey(wrapper, role, turnKey, withinTurn);
      if (!key) continue;
      const node = role === 'user' ? userContentNode(wrapper) : assistantContentNode(wrapper);
      const text = env.normalize.normalizeText(node?.innerText || node?.textContent || '');
      const imageUrls = extractImageUrlsFromElement(wrapper);
      const iframe = role === 'assistant' ? findDeepResearchIframe(wrapper) : null;
      const iframeUrl = String(iframe?.getAttribute?.('src') || '').trim();
      const descriptor: ChatgptDescriptor = {
        key,
        turnKey,
        withinTurn,
        role,
        fingerprint: descriptorFingerprint({ role, key, text, imageUrls, iframeUrl }),
        hasDeepResearch: !!iframe,
        rendered: !!text || imageUrls.length > 0 || !!iframe,
      };
      descriptors.push(descriptor);
      if (includeInputs) {
        inputsByKey.set(key, {
          ...descriptor,
          outerHtml: String(wrapper?.outerHTML || ''),
          imageUrls,
          iframeUrl,
        });
      }
    }
    return { descriptors, inputsByKey };
  }

  function readCurrentDescriptors(): ChatgptDescriptor[] {
    return readCurrentManualWindow().descriptors;
  }

  let manualExtractionCount = 0;

  function extractManualMessage(input: ChatgptExtractionInput, sequence: number): any | null {
    manualExtractionCount += 1;
    const holder = env.document.createElement('div');
    holder.innerHTML = input.outerHtml;
    const wrapper = holder.firstElementChild as any;
    if (!wrapper) return null;
    const node = input.role === 'user' ? userContentNode(wrapper) : assistantContentNode(wrapper);
    const raw = node?.innerText || node?.textContent || '';
    const fallbackText = env.normalize.normalizeText(raw);
    let contentText =
      input.role === 'assistant' && typeof chatgptMarkdown.extractAssistantText === 'function'
        ? chatgptMarkdown.extractAssistantText(wrapper) || fallbackText
        : fallbackText;
    let baseMarkdown =
      input.role === 'assistant' && typeof chatgptMarkdown.extractAssistantMarkdown === 'function'
        ? chatgptMarkdown.extractAssistantMarkdown(wrapper) || contentText || ''
        : contentText || '';
    if (input.hasDeepResearch) {
      const placeholder = input.iframeUrl ? `Deep Research (iframe): ${input.iframeUrl}` : 'Deep Research (iframe)';
      contentText = placeholder;
      baseMarkdown = placeholder;
    }
    if (!contentText && !input.imageUrls.length) return null;
    return {
      messageKey: input.key,
      role: input.role,
      contentText,
      contentMarkdown: appendImageMarkdown(baseMarkdown, input.imageUrls),
      sequence,
      updatedAt: Date.now(),
    };
  }

  const manualAdapter = {
    readRoot: () => getConversationRoot(),
    readIdentity: () => sampleIdentityGuard(getConversationRoot()),
    readScrollSeed: () => getConversationRoot(),
    readDescriptors: readCurrentDescriptors,
    readDescriptorKeys: () => readCurrentDescriptors().map((descriptor) => descriptor.key),
    readUnresolvedKeys: () =>
      readCurrentDescriptors()
        .filter((descriptor) => !descriptor.rendered)
        .map((descriptor) => descriptor.turnKey),
    readWindow: () => readCurrentManualWindow(true),
    getExtractionCount: () => manualExtractionCount,
  };

  async function collectMessages({ allowEditing }: any = {}): Promise<any[]> {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getTurnWrappers(root);
    const out: any[] = [];
    for (let i = 0; i < wrappers.length; i += 1) {
      const msg = await extractMessageFromWrapper(wrappers[i], i);
      if (msg) out.push(msg);
    }

    return out;
  }

  async function harvestRenderedInto(
    accumulator: PreparedAccumulator<any>,
    _root: any,
    _options: any = {},
  ): Promise<{ added: number; updated: number }> {
    mergeIdentityAnchors(accumulator.identityGuard, manualAdapter.readIdentity());
    const { descriptors, inputsByKey } = manualAdapter.readWindow();
    const existingByKey = new Map(accumulator.records.map((record) => [record.key, record]));
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];
    for (let i = 0; i < descriptors.length; i += 1) {
      const descriptor = descriptors[i];
      const existing = existingByKey.get(descriptor.key);
      if (existing && existing.fingerprint === descriptor.fingerprint) {
        records.push({
          key: existing.key,
          turnKey: existing.turnKey,
          withinTurn: existing.withinTurn,
          fingerprint: existing.fingerprint,
          payload: existing.payload,
        });
        continue;
      }
      const input = inputsByKey.get(descriptor.key);
      if (!input) continue;
      const message = extractManualMessage(input, i);
      if (!message) continue;
      records.push({
        key: descriptor.key,
        turnKey: descriptor.turnKey,
        withinTurn: descriptor.withinTurn,
        fingerprint: input.fingerprint,
        payload: message,
      });
    }
    const stableKeys = new Set(descriptors.map((descriptor) => descriptor.key));
    if (!stableKeys.size && getTurnWrappers(getConversationRoot()).length) {
      addPreparedReason(accumulator, 'unstable_identity');
    }
    return mergePreparedRecords(accumulator, records);
  }

  // Manual-only dynamic sweep. The provider re-queries after every wait; no turn/message node
  // survives across an await. The original scroll root is restored exactly once in finally.
  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname })) return null;
    const root = manualAdapter.readRoot();
    if (!root) return null;

    const scrollRuntime = { document: env.document, window: env.window };
    const sampleNavigationIdentity = createNavigationIdentitySampler();
    const scrollRestorer = createScrollRootRestorer({
      ...scrollRuntime,
      getSeed: manualAdapter.readScrollSeed,
      sampleIdentity: sampleNavigationIdentity,
    });
    const scrollRoot = resolveScrollRoot(scrollRuntime, manualAdapter.readScrollSeed());
    writeScrollPosition(scrollRuntime, scrollRoot, 0, 0);
    const settle =
      options.sleep || ((ms: number) => new Promise<void>((resolve) => env.window.setTimeout(resolve, ms)));
    await settle(Math.max(0, Number(options.pollMs) || 0));

    const identityGuard = manualAdapter.readIdentity();
    const conversationKey = identityConversationKey(identityGuard);
    const sampleCaptureIdentity = createCaptureIdentitySampler(identityGuard);
    const accumulator = createPreparedAccumulator<any>({
      source: 'chatgpt',
      conversationKey,
      identityVerified: !!conversationKey,
      identityGuard,
    });
    if (!conversationKey) addPreparedReason(accumulator, 'unstable_identity');

    try {
      const sweep = await runVirtualizedSweep(
        scrollRuntime,
        {
          getScrollSeed: manualAdapter.readScrollSeed,
          sampleIdentity: sampleCaptureIdentity,
          readDescriptorKeys: manualAdapter.readDescriptorKeys,
          readUnresolvedKeys: manualAdapter.readUnresolvedKeys,
          harvest: (target) => harvestRenderedInto(target, null, { allowEditing: true }),
        },
        accumulator,
        {
          maxPasses: options.maxPasses,
          totalDeadlineMs: options.totalDeadlineMs,
          maxSteps: options.maxSteps,
          stableSamples: options.stableSamples,
          pollMs: options.pollMs,
          stepTimeoutMs: options.stepTimeoutMs,
          overlapRatio: options.overlapRatio,
          maxOverlapRecoveries: options.maxOverlapRecoveries,
          sleep: options.sleep,
          now: options.now,
        },
      );
      accumulator.completeness = sweep.completeness;
    } finally {
      const restoreResult = scrollRestorer.restore();
      if (!restoreResult.restored) {
        accumulator.completeness = 'partial';
        addPreparedReason(accumulator, 'restore_failed');
      }
    }

    const finalGuard = manualAdapter.readIdentity();
    if (!identityGuardsMatch(accumulator.identityGuard, finalGuard)) {
      accumulator.identityVerified = false;
      accumulator.conversationKey = '';
      accumulator.records = [];
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'identity_changed');
    }
    return finishPreparedCapture(accumulator);
  }

  async function capture(options: any): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || options?.manual !== true) return null;
    const prepared = consumePreparedCapture(options?.preparedCapture);
    if (!prepared) return null;
    const currentGuard = manualAdapter.readIdentity();
    if (!identityGuardsMatch(prepared.identityGuard, currentGuard)) return null;

    const accumulator = createPreparedAccumulator<any>({
      source: 'chatgpt',
      conversationKey: prepared.conversationKey,
      identityVerified: prepared.identityVerified === true,
      identityGuard: prepared.identityGuard,
    });
    accumulator.completeness = prepared.completeness;
    accumulator.reasons.push(...prepared.reasons.filter((reason) => !accumulator.reasons.includes(reason)));
    accumulator.sweepMetrics = { ...prepared.metrics };
    mergePreparedRecords(
      accumulator,
      prepared.records.map(({ firstSeenIndex: _firstSeenIndex, ...record }) => record),
    );
    const root = getConversationRoot();
    const finalLive = root ? await harvestRenderedInto(accumulator, root) : { added: 0, updated: 0 };
    if (accumulator.completeness === 'complete' && (finalLive.added > 0 || finalLive.updated > 0)) {
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'final_live_changed');
    }
    const finalGuard = manualAdapter.readIdentity();
    if (!identityGuardsMatch(accumulator.identityGuard, finalGuard)) return null;

    const finalPrepared = finishPreparedCapture(accumulator);
    const messages = finalPrepared.records.map((record, index) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !finalPrepared.identityVerified || !finalPrepared.conversationKey) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: finalPrepared.conversationKey,
        title: findTitle(messages),
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now(),
      },
      messages,
      captureMeta: {
        completeness: finalPrepared.completeness,
        identityVerified: true,
        reasons: finalPrepared.reasons,
        metrics: finalPrepared.metrics,
      },
    };
  }

  const collector = {
    capture,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: {
      sampleIdentityGuard,
      identityConversationKey,
      manualAdapter,
      getRoot: getConversationRoot,
      collectMessages,
    },
  };

  return {
    id: 'chatgpt',
    matches,
    collector,
  };
}
