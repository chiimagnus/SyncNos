import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  extractImageUrlsFromElement,
  firstUserMessageTitle,
  renderedElementText,
} from '@collectors/collector-utils.ts';
import chatgptMarkdown, { isChatgptNonContentImageUrl } from '@collectors/chatgpt/chatgpt-markdown.ts';
import {
  buildChatgptGeneratedImageMessageKey,
  chatgptFileIdFromEstuaryUrl,
} from '@services/shared/chatgpt-image-identity';
import { isCanonicalChatgptHostname, parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';
import {
  addPreparedReason,
  createPreparedAccumulator,
  createScrollRootRestorer,
  finishPreparedCapture,
  mergePreparedRecords,
  createPreparedCaptureConsumer,
  runVirtualizedSweep,
  type PreparedAccumulator,
  type VirtualizedBoundary,
  type VirtualizedBoundaryState,
  type PreparedIdentityGuard,
  type PreparedMessageRecord,
} from '@collectors/virtualized-chat/virtualized-chat-sweep.ts';

const CHATGPT_TURN_SELECTOR = '[data-turn-key]';
const CHATGPT_MESSAGE_UNIT_SELECTOR = '[data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]';
const CHATGPT_ASSISTANT_PRIMARY_SELECTOR =
  "[data-markdown-text-style='assistant-message'][data-markdown-text-tone='primary']";

function turnKeyOf(el: any): string {
  const turn = el?.closest?.(CHATGPT_TURN_SELECTOR);
  return String(turn?.getAttribute?.('data-turn-key') || '').trim();
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
    return isCanonicalChatgptHostname(hostname);
  }

  function findConversationIdFromUrl(): any {
    return parseChatgptDurableConversationRoute(env.location.href)?.conversationId || '';
  }

  function findShareIdFromUrl(): string {
    const match = env.location.pathname.match(/^\/share\/([^/?#]+)/);
    return match?.[1] ? String(match[1]) : '';
  }

  function isConversationSurfaceUrl(): boolean {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    return (
      pathname === '/' ||
      !!parseChatgptDurableConversationRoute(env.location.href) ||
      /^\/share\/[^/]+$/.test(pathname) ||
      /^\/g\/[^/]+$/.test(pathname)
    );
  }

  function normalizedRoute(): string {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    const hostPath = `${String(env.location.hostname || '').toLowerCase()}${pathname}`;
    if (findConversationIdFromUrl() || findShareIdFromUrl()) return hostPath;
    const search = String(env.location.search || '');
    return `${hostPath}${search}`;
  }

  function hashStableIdentity(value: string): string {
    return String(env.normalize.fnv1a32(value));
  }

  function directMessageId(element: any): string {
    const ids = String(element?.getAttribute?.('data-chatgpt-search-message-ids') || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const unique = Array.from(new Set(ids));
    return unique.length === 1 ? unique[0] : '';
  }

  function stableManualMessageKey(element: any, role: string, imageUrls: string[] = []): string {
    if (role === 'assistant') {
      const imageKey = buildChatgptGeneratedImageMessageKey(imageUrls.map(chatgptFileIdFromEstuaryUrl));
      if (imageKey) return imageKey;
    }
    const directId = directMessageId(element);
    if (directId) return directId;
    if (role === 'assistant' && element?.matches?.(CHATGPT_TURN_SELECTOR)) {
      const turnKey = turnKeyOf(element);
      if (turnKey) return `chatgpt_turn_${turnKey}_assistant`;
    }
    return '';
  }

  function readTurnShells(root: any): any[] {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll(CHATGPT_TURN_SELECTOR)) as any[];
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
      if (!turn.querySelector?.(CHATGPT_MESSAGE_UNIT_SELECTOR)) continue;
      const turnId = turnKeyOf(turn);
      if (turnId) push(`turn:${turnId}`);
    }
    const perTurn = new Map<string, number>();
    for (const wrapper of getTurnWrappers(root)) {
      const turnId = turnKeyOf(wrapper);
      const withinTurn = perTurn.get(turnId) || 0;
      perTurn.set(turnId, withinTurn + 1);
      const role = roleFromWrapper(wrapper);
      push(stableManualMessageKey(wrapper, role, extractChatgptImageUrlsForRole(wrapper, role)));
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

  function createIdentitySampler(expected: PreparedIdentityGuard): () => string | null {
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

  function identityGuardsMatch(expected: PreparedIdentityGuard, actual: PreparedIdentityGuard): boolean {
    if (!expected || !actual || expected.route !== actual.route) return false;
    if (expected.durableId || actual.durableId) {
      return !!expected.durableId && expected.durableId === actual.durableId;
    }
    if (!expected.anchors.length || !actual.anchors.length) return false;
    const actualAnchors = new Set(actual.anchors);
    return expected.anchors.some((anchor) => actualAnchors.has(anchor));
  }

  function findTitle(messages?: any): any {
    const conversationId = findConversationIdFromUrl();
    if (conversationId) {
      const routeMatchesConversation = (link: Element) => {
        try {
          const href = String(link.getAttribute('href') || '').trim();
          if (!/^\/(?:c\/|g\/[^/]+\/c\/)/.test(href) && !/^https?:\/\/[^/]+\/(?:c\/|g\/[^/]+\/c\/)/i.test(href)) {
            return false;
          }
          const url = new URL(href, env.location.href);
          return parseChatgptDurableConversationRoute(url)?.conversationId === conversationId;
        } catch (_error) {
          return false;
        }
      };
      const links = Array.from(env.document.querySelectorAll('a[href]'));
      const active = links.find(
        (link) => link.getAttribute('aria-current') === 'page' && routeMatchesConversation(link),
      );
      const activeText = env.normalize.normalizeText(renderedElementText(active)).trim();
      if (activeText) return activeText;

      const byRoute = links.find(routeMatchesConversation);
      const routeText = env.normalize.normalizeText(renderedElementText(byRoute)).trim();
      if (routeText) return routeText;
    }

    return firstUserMessageTitle(messages) || 'ChatGPT';
  }

  function getConversationRoot(): any {
    return env.document.querySelector('main');
  }

  function getConversationScrollSeed(): any {
    const root = getConversationRoot();
    return root?.querySelector?.('[data-app-action-timeline-scroll]') || root;
  }

  function userContentNode(element: any): any {
    return (
      element.querySelector('[data-user-message-bubble] .whitespace-pre-wrap') ||
      element.querySelector('[data-user-message-bubble]') ||
      element
    );
  }

  function aggregateNodes(nodes: any[]): any | null {
    if (!nodes.length) return null;
    if (nodes.length === 1) return nodes[0];
    const holder = env.document.createElement('div');
    for (const node of nodes) holder.appendChild(chatgptMarkdown.cloneWithControlState(node, true));
    return holder;
  }

  function assistantContentNode(element: any): any {
    const selection = element?.querySelector?.('[data-chatgpt-selection-message-id]');
    if (selection) return selection;
    const cotBodies = element?.matches?.(CHATGPT_TURN_SELECTOR) ? currentCotBodies(element) : [];
    const primary = (Array.from(element?.querySelectorAll?.(CHATGPT_ASSISTANT_PRIMARY_SELECTOR) || []) as any[]).filter(
      (node) => !cotBodies.some((body) => body?.contains?.(node)),
    );
    const aggregated = aggregateNodes(primary);
    if (aggregated) return aggregated;
    if (element?.matches?.(CHATGPT_TURN_SELECTOR)) return null;
    return element?.querySelector?.("[data-markdown-text-style='assistant-message']") || element;
  }

  function extractChatgptImageUrls(element: ParentNode | null): string[] {
    return extractImageUrlsFromElement(element).filter((url) => !isChatgptNonContentImageUrl(url));
  }

  function extractChatgptImageUrlsForRole(element: any, role: 'user' | 'assistant'): string[] {
    if (role !== 'assistant' || !element?.matches?.(CHATGPT_TURN_SELECTOR)) return extractChatgptImageUrls(element);
    return extractChatgptImageUrls(assistantContentNode(element));
  }

  function hasActiveAssistantStatus(element: any): boolean {
    const turn = element?.matches?.(CHATGPT_TURN_SELECTOR) ? element : element?.closest?.(CHATGPT_TURN_SELECTOR);
    if (!turn?.querySelector) return false;
    const status = turn.querySelector("[role='status'][aria-live='polite']");
    return !!status && !isExplicitlyHiddenWithin(status, turn);
  }

  function hasFallbackAssistantActivity(turn: any): boolean {
    if (!turn?.querySelector) return false;
    if (turn.querySelector("[data-markdown-text-style='assistant-message']")) return true;
    if (findDeepResearchIframe(turn)) return true;
    if (hasActiveAssistantStatus(turn)) return true;
    return extractChatgptImageUrlsForRole(turn, 'assistant').length > 0;
  }

  type ChatgptDescriptor = {
    key: string;
    turnKey: string;
    withinTurn: number;
    role: 'user' | 'assistant';
    fingerprint: string;
    hasDeepResearch: boolean;
    rendered: boolean;
    visible: boolean;
  };

  type ChatgptExtractionInput = ChatgptDescriptor & {
    outerHtml: string;
    imageUrls: string[];
    iframeUrl: string;
    cotOuterHtml: string;
    liveRoot: any;
  };

  function getTurnWrappers(root: any): any[] {
    if (!root?.querySelectorAll) return [];
    const wrappers: any[] = [];
    for (const turn of readTurnShells(root)) {
      const units = (Array.from(turn.querySelectorAll(CHATGPT_MESSAGE_UNIT_SELECTOR)) as any[]).filter((unit) =>
        /:(?:user|assistant)$/.test(String(unit?.getAttribute?.('data-chatgpt-search-unit-key') || '')),
      );
      wrappers.push(...units);
      const hasAssistantUnit = units.some((unit) => roleFromWrapper(unit) === 'assistant');
      if (!hasAssistantUnit && hasFallbackAssistantActivity(turn)) wrappers.push(turn);
    }
    return wrappers;
  }

  function roleFromWrapper(wrapper: any): 'user' | 'assistant' {
    return /:user$/.test(String(wrapper?.getAttribute?.('data-chatgpt-search-unit-key') || '')) ? 'user' : 'assistant';
  }

  const COT_REASONING_SELECTOR = "[data-markdown-text-style='assistant-message']";

  type CotContent = {
    text: string;
    markdown: string;
  };

  type CotAssociation = {
    semanticText: string;
    semanticMarkdown: string;
    outerHtml: string;
  };

  function compareDocumentOrder(left: any, right: any): number {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    if (position & env.window.Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & env.window.Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function joinContentBlocks(values: unknown[]): string {
    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n\n');
  }

  function isExplicitlyHiddenWithin(node: any, root: any): boolean {
    let current = node;
    while (current) {
      if (current.hasAttribute?.('hidden') || String(current.getAttribute?.('aria-hidden') || '') === 'true') {
        return true;
      }
      if (current === root) break;
      current = current.parentElement;
    }
    return false;
  }

  function collectCotContentBlocks(root: any): any[] {
    if (!root?.querySelectorAll) return [];
    const nodes = [
      ...(root.matches?.(COT_REASONING_SELECTOR) ? [root] : []),
      ...(Array.from(root.querySelectorAll(COT_REASONING_SELECTOR)) as any[]),
    ].filter((node) => !isExplicitlyHiddenWithin(node, root));
    return nodes.filter(
      (node, index) => !nodes.some((other, otherIndex) => otherIndex < index && other.contains?.(node)),
    );
  }

  function extractCotContent(root: any): CotContent {
    const blocks = collectCotContentBlocks(root);
    if (!blocks.length) return { text: '', markdown: '' };

    const textBlocks: string[] = [];
    const markdownBlocks: string[] = [];
    for (const block of blocks) {
      const text = String(chatgptMarkdown.extractRenderedText(block) || '').trim();
      const markdown = String(chatgptMarkdown.extractRenderedMarkdown(block) || text).trim();
      if (text) textBlocks.push(text);
      if (markdown) markdownBlocks.push(markdown);
    }
    return {
      text: joinContentBlocks(textBlocks),
      markdown: joinContentBlocks(markdownBlocks),
    };
  }

  function currentCotBodies(group: any): any[] {
    if (!group?.querySelectorAll) return [];
    const bodies: any[] = [];
    for (const start of Array.from(group.querySelectorAll('[data-chatgpt-agent-turn-start]')) as any[]) {
      const block = start?.parentElement;
      if (!block?.querySelector) continue;
      const expanded = block.querySelector("button[aria-expanded='true']");
      if (!expanded) continue;
      const body = expanded.parentElement?.nextElementSibling;
      if (!body) continue;
      bodies.push(body);
    }
    return bodies;
  }

  function buildCotAssociations(wrappers: any[], includeOuterHtml: boolean): Map<any, CotAssociation> {
    const result = new Map<any, CotAssociation>();
    for (const owner of wrappers) {
      if (roleFromWrapper(owner) !== 'assistant') continue;
      const group = owner.closest(CHATGPT_TURN_SELECTOR);
      if (!group) continue;
      const bodies = currentCotBodies(group);
      if (!bodies.length) continue;
      const parts = bodies.map((body) => ({ content: extractCotContent(body), body }));
      result.set(owner, {
        semanticText: joinContentBlocks(parts.map(({ content }) => content.text)),
        semanticMarkdown: joinContentBlocks(parts.map(({ content }) => content.markdown)),
        outerHtml: includeOuterHtml ? parts.map(({ body }) => String(body.outerHTML || '')).join('\n') : '',
      });
    }
    return result;
  }

  function extractCotContentFromHtml(html: string): CotContent {
    const holder = env.document.createElement('div');
    holder.innerHTML = String(html || '');
    const roots = Array.from(holder.children) as any[];
    if (!roots.length) return { text: '', markdown: '' };
    const parts = roots.map((root) => extractCotContent(root));
    return {
      text: joinContentBlocks(parts.map((part) => part.text)),
      markdown: joinContentBlocks(parts.map((part) => part.markdown)),
    };
  }

  function compactFingerprintPart(value: string): string {
    return String(env.normalize.fnv1a32(String(value || '')));
  }

  function descriptorFingerprint(input: {
    role: string;
    key: string;
    text: string;
    cotText: string;
    cotMarkdown: string;
    imageUrls: string[];
    iframeUrl: string;
  }): string {
    const imageRefs = input.imageUrls.join('|');
    const source = `${input.role}|${input.key}|${input.text.length}|${compactFingerprintPart(input.text)}|${
      input.cotText.length
    }|${compactFingerprintPart(input.cotText)}|${input.cotMarkdown.length}|${compactFingerprintPart(
      input.cotMarkdown,
    )}|${input.imageUrls.length}|${compactFingerprintPart(imageRefs)}|${compactFingerprintPart(input.iframeUrl)}`;
    return compactFingerprintPart(source);
  }

  function isVisibleWindow(wrapper: any): boolean {
    try {
      const virtualizer = wrapper?.closest?.('[data-is-intersecting]');
      const intersecting = String(virtualizer?.getAttribute?.('data-is-intersecting') || '').trim();
      if (intersecting === 'true') return true;
      if (intersecting === 'false') return false;
      const rect = wrapper?.getBoundingClientRect?.();
      const top = Number(rect?.top);
      const bottom = Number(rect?.bottom);
      const height = Number(rect?.height);
      const viewportHeight = Number(env.window?.innerHeight);
      return height > 0 && viewportHeight > 0 && bottom >= 0 && top <= viewportHeight;
    } catch (_error) {
      return false;
    }
  }

  function createCurrentExtractionInput(input: {
    wrapper: any;
    role: 'user' | 'assistant';
    key: string;
    turnKey: string;
    withinTurn: number;
    cot: CotAssociation | null;
  }): ChatgptExtractionInput {
    const { wrapper, role, key, turnKey, withinTurn, cot } = input;
    const imageUrls = extractChatgptImageUrlsForRole(wrapper, role);
    const node = role === 'user' ? userContentNode(wrapper) : assistantContentNode(wrapper);
    const text = env.normalize.normalizeText(node?.innerText || node?.textContent || '');
    const hasRichGraphic = role === 'assistant' && chatgptMarkdown.hasRichGraphic(node);
    const graphicSignature = hasRichGraphic
      ? compactFingerprintPart(
          Array.from(node?.querySelectorAll?.('svg, canvas, img[data-syncnos-graphic="true"]') || [])
            .map((el: any) => String(el.outerHTML || ''))
            .join('|'),
        )
      : '';
    const iframe = role === 'assistant' ? findDeepResearchIframe(wrapper) : null;
    const iframeUrl = String(iframe?.getAttribute?.('src') || '').trim();
    const effectiveCot = role === 'assistant' && !iframe ? cot : null;
    const cotText = String(effectiveCot?.semanticText || '');
    const cotMarkdown = String(effectiveCot?.semanticMarkdown || '');
    const fallbackAssistantTurn = role === 'assistant' && wrapper?.matches?.(CHATGPT_TURN_SELECTOR);
    const hasFinalAssistantSurface = !fallbackAssistantTurn || !!node || imageUrls.length > 0 || !!iframe;
    const streaming = role === 'assistant' && hasActiveAssistantStatus(wrapper);
    const serializedRoot = fallbackAssistantTurn ? node || iframe || wrapper : wrapper;
    return {
      key,
      turnKey,
      withinTurn,
      role,
      fingerprint: descriptorFingerprint({
        role,
        key,
        text: hasRichGraphic ? `${text}|${graphicSignature}` : text,
        cotText,
        cotMarkdown,
        imageUrls,
        iframeUrl,
      }),
      hasDeepResearch: !!iframe,
      rendered:
        !streaming &&
        hasFinalAssistantSurface &&
        (!!text || !!cotText || !!cotMarkdown || imageUrls.length > 0 || !!iframe || hasRichGraphic),
      visible: isVisibleWindow(wrapper),
      outerHtml:
        role === 'assistant' &&
        serializedRoot?.querySelector?.('input[type="checkbox"], input[type="radio"], input[type="range"], option')
          ? String(chatgptMarkdown.cloneWithControlState(serializedRoot)?.outerHTML || serializedRoot?.outerHTML || '')
          : String(serializedRoot?.outerHTML || ''),
      imageUrls,
      iframeUrl,
      cotOuterHtml: effectiveCot?.outerHtml || '',
      liveRoot: role === 'assistant' ? serializedRoot : null,
    };
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
    const cotByOwner = buildCotAssociations(wrappers, includeInputs);
    const perTurn = new Map<string, number>();
    for (const wrapper of wrappers) {
      const role = roleFromWrapper(wrapper);
      const turnKey = turnKeyOf(wrapper);
      const withinTurn = perTurn.get(turnKey) || 0;
      perTurn.set(turnKey, withinTurn + 1);
      const imageUrls = extractChatgptImageUrlsForRole(wrapper, role);
      const key = stableManualMessageKey(wrapper, role, imageUrls);
      if (!key) continue;
      const extractionInput = createCurrentExtractionInput({
        wrapper,
        role,
        key,
        turnKey,
        withinTurn,
        cot: cotByOwner.get(wrapper) || null,
      });
      const {
        outerHtml: _outerHtml,
        imageUrls: _imageUrls,
        iframeUrl: _iframeUrl,
        cotOuterHtml: _cotOuterHtml,
        liveRoot: _liveRoot,
        ...descriptor
      } = extractionInput;
      descriptors.push(descriptor);
      if (includeInputs) inputsByKey.set(key, extractionInput);
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
      input.role === 'assistant' ? chatgptMarkdown.extractAssistantText(wrapper) || fallbackText : fallbackText;
    let baseMarkdown =
      input.role === 'assistant'
        ? chatgptMarkdown.extractAssistantMarkdown(wrapper) || contentText || ''
        : contentText || '';
    if (input.hasDeepResearch) {
      const placeholder = input.iframeUrl ? `Deep Research (iframe): ${input.iframeUrl}` : 'Deep Research (iframe)';
      contentText = placeholder;
      baseMarkdown = placeholder;
    } else if (input.role === 'assistant' && input.cotOuterHtml) {
      const cot = extractCotContentFromHtml(input.cotOuterHtml);
      contentText = joinContentBlocks([cot.text, contentText]);
      baseMarkdown = joinContentBlocks([cot.markdown || cot.text, baseMarkdown]);
    }
    if (!contentText && !input.imageUrls.length && !baseMarkdown.trim()) return null;
    return {
      messageKey: input.key,
      role: input.role,
      contentMarkdown: appendImageMarkdown(baseMarkdown, input.imageUrls),
      sequence,
      updatedAt: Date.now(),
    };
  }

  function structuralTurnOrdinal(turn: any): number | null {
    const searchTurnKey = String(
      turn?.getAttribute?.('data-content-search-turn-key') ||
        turn?.querySelector?.('[data-content-search-turn-key]')?.getAttribute?.('data-content-search-turn-key') ||
        '',
    ).trim();
    const currentMatch = searchTurnKey.match(/^fallback-turn-(\d+)$/);
    if (currentMatch) {
      const index = Number(currentMatch[1]);
      return Number.isSafeInteger(index) && index >= 0 ? index : null;
    }
    return null;
  }

  const BOUNDARY_LOADING_SELECTOR = "[data-chatgpt-conversation-selection-target='true'] [role='status']";

  function hasBoundaryLoadingSignal(boundary: VirtualizedBoundary, root = getConversationRoot()): boolean {
    if (!root?.querySelectorAll) return false;
    const turns = readTurnShells(root);
    const edgeTurn = boundary === 'top' ? turns[0] : turns[turns.length - 1];
    const candidates: any[] = [];
    if (root.matches?.(BOUNDARY_LOADING_SELECTOR)) candidates.push(root);
    candidates.push(...(Array.from(root.querySelectorAll(BOUNDARY_LOADING_SELECTOR)) as any[]));
    for (const candidate of candidates) {
      if (!candidate || candidate.closest?.(CHATGPT_TURN_SELECTOR)) continue;
      if (isExplicitlyHiddenWithin(candidate, root)) continue;
      if (!edgeTurn) return true;
      if (candidate === root || candidate.contains?.(edgeTurn)) return true;
      const order = compareDocumentOrder(candidate, edgeTurn);
      if (boundary === 'top' ? order < 0 : order > 0) return true;
    }
    return false;
  }

  function readManualBoundaryState(boundary: VirtualizedBoundary): VirtualizedBoundaryState {
    const root = getConversationRoot();
    if (!root) return 'pending';
    if (hasBoundaryLoadingSignal(boundary, root)) return 'pending';
    if (boundary === 'top') {
      const turns = readTurnShells(root);
      const ordinals = turns.map(structuralTurnOrdinal).filter((value): value is number => value !== null);
      const firstTurn = turns[0] || null;
      const firstTurnUnits = firstTurn
        ? (Array.from(firstTurn.querySelectorAll?.(CHATGPT_MESSAGE_UNIT_SELECTOR) || []) as any[])
        : [];
      const currentOneBasedLayout =
        !!firstTurn &&
        !firstTurnUnits.some((unit) => roleFromWrapper(unit) === 'assistant') &&
        hasFallbackAssistantActivity(firstTurn);
      const expectedTopOrdinal = currentOneBasedLayout ? 1 : 0;
      if (ordinals.length && Math.min(...ordinals) > expectedTopOrdinal) return 'pending';
    }
    return 'confirmed';
  }

  const manualAdapter = {
    readRoot: () => getConversationRoot(),
    readIdentity: () => sampleIdentityGuard(getConversationRoot()),
    readScrollSeed: () => getConversationScrollSeed(),
    readDescriptors: readCurrentDescriptors,
    readDescriptorKeys: () => readCurrentDescriptors().map((descriptor) => descriptor.key),
    readUnresolvedKeys: () =>
      readCurrentDescriptors()
        .filter((descriptor) => descriptor.visible && !descriptor.rendered)
        .map((descriptor) => descriptor.key),
    readBoundaryState: readManualBoundaryState,
    readWindow: () => readCurrentManualWindow(true),
    getExtractionCount: () => manualExtractionCount,
  };

  function captureApiLiveTurn(input: { expectedConversationId: string }) {
    const expectedConversationId = String(input.expectedConversationId || '').trim();
    const currentConversationId = String(findConversationIdFromUrl() || '').trim();
    if (!expectedConversationId || !currentConversationId || currentConversationId !== expectedConversationId) {
      return { kind: 'identity_changed' };
    }

    try {
      const root = getConversationRoot();
      if (!root) return { kind: 'none' };
      const wrappers = getTurnWrappers(root);
      let lastUserIndex = -1;
      for (let index = wrappers.length - 1; index >= 0; index -= 1) {
        if (roleFromWrapper(wrappers[index]) === 'user' && !isExplicitlyHiddenWithin(wrappers[index], root)) {
          lastUserIndex = index;
          break;
        }
      }
      if (lastUserIndex < 0) return { kind: 'none' };

      const cotByOwner = buildCotAssociations(wrappers, true);
      let assistantWrapper: any = null;
      for (let index = wrappers.length - 1; index > lastUserIndex; index -= 1) {
        const wrapper = wrappers[index];
        if (
          roleFromWrapper(wrapper) !== 'assistant' ||
          isExplicitlyHiddenWithin(wrapper, root) ||
          !isVisibleWindow(wrapper)
        )
          continue;
        const node = assistantContentNode(wrapper);
        const text = env.normalize.normalizeText(node?.innerText || node?.textContent || '');
        const cot = cotByOwner.get(wrapper);
        const hasCot = !!String(cot?.semanticText || cot?.semanticMarkdown || '').trim();
        if (!text && !hasCot && !extractChatgptImageUrls(wrapper).length && !findDeepResearchIframe(wrapper)) continue;
        assistantWrapper = wrapper;
        break;
      }
      if (!assistantWrapper) return { kind: 'none' };

      const userWrapper = wrappers[lastUserIndex];
      const userKey = directMessageId(userWrapper);
      const assistantKey = directMessageId(assistantWrapper);
      if (!userKey || !assistantKey) return { kind: 'unsafe' };

      const userTurnKey = turnKeyOf(userWrapper);
      const assistantTurnKey = turnKeyOf(assistantWrapper);
      const withinTurn = (index: number, turnKey: string) =>
        wrappers.slice(0, index).filter((candidate: any) => turnKeyOf(candidate) === turnKey).length;
      const userInput = createCurrentExtractionInput({
        wrapper: userWrapper,
        role: 'user',
        key: userKey,
        turnKey: userTurnKey,
        withinTurn: withinTurn(lastUserIndex, userTurnKey),
        cot: null,
      });
      const assistantIndex = wrappers.indexOf(assistantWrapper);
      const assistantInput = createCurrentExtractionInput({
        wrapper: assistantWrapper,
        role: 'assistant',
        key: assistantKey,
        turnKey: assistantTurnKey,
        withinTurn: withinTurn(assistantIndex, assistantTurnKey),
        cot: cotByOwner.get(assistantWrapper) || null,
      });
      if (!assistantInput.rendered) return { kind: 'unsafe' };
      // Generated images and deep-research frames have separate ownership/identity rules in the API snapshot.
      if (
        userInput.imageUrls.length > 0 ||
        assistantInput.imageUrls.length > 0 ||
        assistantInput.hasDeepResearch ||
        assistantInput.iframeUrl
      ) {
        return { kind: 'unsafe' };
      }

      const userMessage = extractManualMessage(userInput, 0);
      const assistantMessage = extractManualMessage(assistantInput, 1);
      if (!userMessage || !assistantMessage) return { kind: 'unsafe' };
      return {
        kind: 'candidate',
        conversationId: currentConversationId,
        userMessage,
        assistantMessage,
      };
    } catch (_error) {
      return { kind: 'unsafe' };
    }
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
      if (input.role === 'assistant' && input.liveRoot && chatgptMarkdown.hasRichGraphic(input.liveRoot)) {
        input.outerHtml = (await chatgptMarkdown.snapshotRichGraphics(input.liveRoot, env.window)) || input.outerHtml;
      }
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

  async function enrichApiSnapshotWithRenderedGraphics(snapshot: any): Promise<any> {
    const expectedConversationId = String(snapshot?.conversation?.conversationKey || '').trim();
    if (!expectedConversationId || expectedConversationId !== findConversationIdFromUrl()) return snapshot;
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    const owned = new Map<string, any>(
      messages.filter((m: any) => m?.role === 'assistant').map((m: any) => [String(m.messageKey), m]),
    );
    if (!owned.size) return snapshot;
    const { inputsByKey } = readCurrentManualWindow(true);
    const updates = new Map<string, string>();
    for (const [key, input] of inputsByKey) {
      if (input.role !== 'assistant' || !input.rendered || !input.liveRoot || !owned.has(key)) continue;
      if (!chatgptMarkdown.hasRichGraphic(input.liveRoot)) continue;
      const rendered = extractManualMessage(
        { ...input, outerHtml: await chatgptMarkdown.snapshotRichGraphics(input.liveRoot, env.window) },
        Number(owned.get(key)?.sequence) || 0,
      );
      const images = String(rendered?.contentMarkdown || '').match(
        /^!\[[^\]\n]+\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)$/gm,
      );
      if (!images?.length) continue;
      const original = String(owned.get(key)?.contentMarkdown || '');
      updates.set(key, [original, ...images.filter((image) => !original.includes(image))].join('\n\n'));
    }
    if (!updates.size) return snapshot;
    if (findConversationIdFromUrl() !== expectedConversationId) {
      throw Object.assign(new Error('chatgpt_api_navigation_changed'), { code: 'chatgpt_api_navigation_changed' });
    }
    return {
      ...snapshot,
      messages: messages.map((message: any) =>
        updates.has(message.messageKey) ? { ...message, contentMarkdown: updates.get(message.messageKey) } : message,
      ),
    };
  }

  // Manual-only dynamic sweep. The provider re-queries after every wait; no turn/message node
  // survives across an await. The original scroll root is restored exactly once in finally.
  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname })) return null;
    const root = manualAdapter.readRoot();
    if (!root) return null;

    const scrollRuntime = { document: env.document, window: env.window };
    const initialIdentityGuard = manualAdapter.readIdentity();
    const sampleIdentity = createIdentitySampler(initialIdentityGuard);
    const scrollRestorer = createScrollRootRestorer({
      ...scrollRuntime,
      getSeed: manualAdapter.readScrollSeed,
      sampleIdentity,
    });
    const durableConversationKey = initialIdentityGuard.durableId ? identityConversationKey(initialIdentityGuard) : '';
    const accumulator = createPreparedAccumulator<any>({
      source: 'chatgpt',
      conversationKey: durableConversationKey,
      identityVerified: !!durableConversationKey,
      identityGuard: initialIdentityGuard,
    });

    try {
      const sweep = await runVirtualizedSweep(
        scrollRuntime,
        {
          getScrollSeed: manualAdapter.readScrollSeed,
          sampleIdentity,
          readDescriptorKeys: manualAdapter.readDescriptorKeys,
          readUnresolvedKeys: manualAdapter.readUnresolvedKeys,
          readBoundaryState: manualAdapter.readBoundaryState,
          onTopConfirmed: (target) => {
            const canonicalGuard = manualAdapter.readIdentity();
            target.identityGuard = {
              ...canonicalGuard,
              anchors: canonicalGuard.anchors.slice(),
            };
            if (!target.conversationKey) {
              target.conversationKey = identityConversationKey(canonicalGuard);
              target.identityVerified = !!target.conversationKey;
            }
            if (!target.conversationKey) addPreparedReason(target, 'unstable_identity');
          },
          harvest: (target) => harvestRenderedInto(target, null, { allowEditing: true }),
        },
        accumulator,
        {
          totalDeadlineMs: options.totalDeadlineMs,
          maxSteps: options.maxSteps,
          stableSamples: options.stableSamples,
          pollMs: options.pollMs,
          stepTimeoutMs: options.stepTimeoutMs,
          boundaryTimeoutMs: options.boundaryTimeoutMs,
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

    if (!accumulator.conversationKey) addPreparedReason(accumulator, 'unstable_identity');
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
    isCaptureAvailable: isConversationSurfaceUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
    captureApiLiveTurn,
    enrichApiSnapshotWithRenderedGraphics,
    __test: {
      sampleIdentityGuard,
      identityConversationKey,
      manualAdapter,
    },
  };

  return {
    id: 'chatgpt',
    matches,
    collector,
  };
}
