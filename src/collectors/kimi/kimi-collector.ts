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
import kimiMarkdown from '@collectors/kimi/kimi-markdown.ts';

type KimiRole = 'user' | 'assistant';

type KimiDescriptor = {
  key: string;
  role: KimiRole;
  fingerprint: string;
  rendered: boolean;
  streaming: boolean;
};

export function createKimiCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('kimi');

  function matches(loc: any): boolean {
    const hostname = String(loc?.hostname || env.location.hostname || '').toLowerCase();
    return hostname === 'kimi.moonshot.cn' || /(^|\.)kimi\.com$/.test(hostname);
  }

  function findConversationIdFromUrl(): string {
    const match = String(env.location.pathname || '').match(/^\/chat\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  function isValidConversationUrl(): boolean {
    return !!findConversationIdFromUrl();
  }

  function isConversationSurfaceUrl(): boolean {
    const path = String(env.location.pathname || '');
    return path === '/' || /^\/chat(?:\/|$)/.test(path);
  }

  function normalizedRoute(): string {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    return `${String(env.location.hostname || '').toLowerCase()}${pathname}`;
  }

  function getConversationRoot(): Element | null {
    return env.document.querySelector('.chat-content-list');
  }

  function getScrollRoot(): Element | null {
    return env.document.querySelector('.chat-detail-main') || getConversationRoot();
  }

  function inEditMode(root: Element | null): boolean {
    return !!root && inEditModeUtil(root);
  }

  function getMessageItems(root: Element | null = getConversationRoot()): Element[] {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll('.chat-content-item[data-archer-id]')).filter(
      (item) =>
        item.classList.contains('chat-content-item-user') || item.classList.contains('chat-content-item-assistant'),
    );
  }

  function roleFromItem(item: Element): KimiRole | null {
    if (item.classList.contains('chat-content-item-user')) return 'user';
    if (item.classList.contains('chat-content-item-assistant')) return 'assistant';
    return null;
  }

  function stableMessageKey(item: Element): string {
    const id = String(item.getAttribute('data-archer-id') || '').trim();
    return id ? `kimi_${id}` : '';
  }

  function mergeImageUrls(nodes: Element[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const node of nodes) {
      for (const url of extractImageUrlsFromElement(node)) {
        if (seen.has(url)) continue;
        seen.add(url);
        output.push(url);
      }
    }
    return output;
  }

  function assistantContentNodes(item: Element): Element[] {
    const candidates = Array.from(item.querySelectorAll('.markdown-container, .editor-content')).filter(
      (element) => !element.closest('.think-stage'),
    );
    candidates.sort((left, right) => {
      const position = left.compareDocumentPosition(right);
      const following = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
      const preceding = env.window?.Node?.DOCUMENT_POSITION_PRECEDING ?? 2;
      if (position & following) return -1;
      if (position & preceding) return 1;
      return 0;
    });
    const unique: Element[] = [];
    for (const candidate of candidates) {
      if (unique.some((parent) => parent.contains(candidate))) continue;
      unique.push(candidate);
    }
    return unique;
  }

  function extractContent(item: Element, role: KimiRole): { text: string; markdown: string; imageUrls: string[] } {
    const attachmentRoots = Array.from(
      item.querySelectorAll('.attachment-list, .attachment-list-image, .attachment-list-file'),
    );
    if (role === 'user') {
      const contentNodes = Array.from(item.querySelectorAll('.user-content'));
      const text = env.normalize.normalizeText(
        contentNodes
          .map((node) => String((node as HTMLElement).innerText || node.textContent || ''))
          .filter(Boolean)
          .join('\n\n'),
      );
      const imageUrls = mergeImageUrls(
        [...contentNodes, ...attachmentRoots].length ? [...contentNodes, ...attachmentRoots] : [item],
      );
      return { text, markdown: appendImageMarkdown(text, imageUrls), imageUrls };
    }

    const contentNodes = assistantContentNodes(item);
    const textParts = contentNodes
      .map((node) => {
        const fallback = env.normalize.normalizeText(String((node as HTMLElement).innerText || node.textContent || ''));
        return typeof kimiMarkdown.extractAssistantText === 'function'
          ? kimiMarkdown.extractAssistantText(node) || fallback
          : fallback;
      })
      .filter(Boolean);
    const markdownParts = contentNodes
      .map((node) => {
        const fallback = env.normalize.normalizeText(String((node as HTMLElement).innerText || node.textContent || ''));
        return typeof kimiMarkdown.extractAssistantMarkdown === 'function'
          ? kimiMarkdown.extractAssistantMarkdown(node) || fallback
          : fallback;
      })
      .filter(Boolean);
    const text = env.normalize.normalizeText(textParts.join('\n\n'));
    const markdown =
      typeof kimiMarkdown.normalizeMarkdown === 'function'
        ? kimiMarkdown.normalizeMarkdown(markdownParts.join('\n\n'))
        : markdownParts.join('\n\n');
    const imageUrls = mergeImageUrls([...(contentNodes.length ? contentNodes : [item]), ...attachmentRoots]);
    return { text, markdown: appendImageMarkdown(markdown || text, imageUrls), imageUrls };
  }

  function compactFingerprint(value: string): string {
    return typeof env.normalize.fnv1a32 === 'function' ? String(env.normalize.fnv1a32(value)) : value;
  }

  function descriptorFromItem(item: Element): KimiDescriptor | null {
    const key = stableMessageKey(item);
    const role = roleFromItem(item);
    if (!key || !role) return null;
    const content = extractContent(item, role);
    const streaming =
      role === 'assistant' &&
      (item.matches('.awaiting-assistant-item') ||
        !!item.querySelector('.segment-pending-loading') ||
        !!item.querySelector('.last-node'));
    const rendered = !streaming && (!!content.text || !!content.markdown || content.imageUrls.length > 0);
    return {
      key,
      role,
      rendered,
      streaming,
      fingerprint: compactFingerprint(
        [key, role, String(streaming), content.text, content.markdown, content.imageUrls.join('|')].join('\u001f'),
      ),
    };
  }

  function readCurrentDescriptors(): KimiDescriptor[] {
    return getMessageItems()
      .map(descriptorFromItem)
      .filter((descriptor): descriptor is KimiDescriptor => !!descriptor);
  }

  function sampleIdentityGuard(): PreparedIdentityGuard {
    const anchors = readCurrentDescriptors().map((descriptor) => descriptor.key);
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
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];
    const items = getMessageItems();
    let unresolved = false;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const descriptor = descriptorFromItem(item);
      if (!descriptor) continue;
      if (!descriptor.rendered || descriptor.streaming) {
        unresolved = true;
        continue;
      }
      const content = extractContent(item, descriptor.role);
      records.push({
        key: descriptor.key,
        turnKey: descriptor.key,
        withinTurn: 0,
        fingerprint: descriptor.fingerprint,
        payload: {
          messageKey: descriptor.key,
          role: descriptor.role,
          contentMarkdown: content.markdown || content.text,
          sequence: index,
          updatedAt: Date.now(),
        },
      });
    }
    if (unresolved) addPreparedReason(accumulator, 'unresolved_turn');
    return mergePreparedRecords(accumulator, records);
  }

  function currentWindowSignature(): string {
    const root = getScrollRoot() as HTMLElement | null;
    const descriptors = readCurrentDescriptors();
    return `${descriptors.map((descriptor) => `${descriptor.key}:${descriptor.fingerprint}`).join('|')}|${Number(root?.scrollHeight || 0)}`;
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
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    const scrollRoot = getScrollRoot() as HTMLElement | null;
    if (!root || !scrollRoot || inEditMode(root)) return null;

    const initialGuard = sampleIdentityGuard();
    const accumulator = createPreparedAccumulator<any>({
      source: 'kimi',
      conversationKey: initialGuard.durableId,
      identityVerified: !!initialGuard.durableId,
      identityGuard: initialGuard,
    });
    accumulator.completeness = 'partial';
    addPreparedReason(accumulator, 'top_not_reached');

    const runtime = { document: env.document, window: env.window };
    const sampleIdentity = createIdentitySampler(initialGuard);
    const restorer = createScrollRootRestorer({ ...runtime, getSeed: getScrollRoot, sampleIdentity });
    const maxRounds = Math.max(1, Math.min(50, Number(options.maxRounds) || 24));
    const stableRoundsRequired = Math.max(1, Math.min(5, Number(options.stableRounds) || 2));
    const waitForLoadMs = Math.max(20, Number(options.waitForLoadMs) || 900);
    const pollMs = Math.max(0, Number(options.pollMs) || 80);
    const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    let stableRounds = 0;

    try {
      await harvestCurrentInto(accumulator);
      for (let round = 0; round < maxRounds && stableRounds < stableRoundsRequired; round += 1) {
        const before = currentWindowSignature();
        if (typeof scrollRoot.scrollTo === 'function')
          scrollRoot.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        else scrollRoot.scrollTop = 0;
        const changed = await waitForHistoryChange(before, { waitForLoadMs, pollMs, sleep, now });
        if (String(sampleIdentity() || '') === '') {
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

  function snapshotFromPreparedCapture(prepared: any): any | null {
    const messages = prepared.records.map((record: any, index: number) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !prepared.identityVerified || !prepared.conversationKey) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'kimi',
        conversationKey: prepared.conversationKey,
        title: env.document.title || 'Kimi',
        url: env.location.href,
        warningFlags: [],
      },
      messages,
      captureMeta: {
        completeness: 'partial',
        identityVerified: true,
        reasons: prepared.reasons,
        metrics: prepared.metrics,
      },
    };
  }

  async function capture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return null;

    if (options?.manual !== true) {
      const identityGuard = sampleIdentityGuard();
      const accumulator = createPreparedAccumulator<any>({
        source: 'kimi',
        conversationKey: identityGuard.durableId,
        identityVerified: !!identityGuard.durableId,
        identityGuard,
      });
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'top_not_reached');
      await harvestCurrentInto(accumulator);
      if (!identityGuardsMatch(identityGuard, sampleIdentityGuard())) return null;
      return snapshotFromPreparedCapture(finishPreparedCapture(accumulator));
    }

    const prepared = consumePreparedCapture(options.preparedCapture);
    if (!prepared || !identityGuardsMatch(prepared.identityGuard, sampleIdentityGuard())) return null;

    const accumulator = createPreparedAccumulator<any>({
      source: 'kimi',
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
    return snapshotFromPreparedCapture(finishPreparedCapture(accumulator));
  }

  const collector: any = {
    capture,
    isCaptureAvailable: isConversationSurfaceUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: { getMessageItems, readCurrentDescriptors, currentWindowSignature },
  };
  return { id: 'kimi', matches, collector };
}
