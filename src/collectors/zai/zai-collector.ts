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
  runVirtualizedSweep,
  type PreparedAccumulator,
  type PreparedIdentityGuard,
  type PreparedMessageRecord,
  type VirtualizedBoundaryState,
} from '@collectors/virtualized-chat/virtualized-chat-sweep.ts';
import zaiMarkdown from '@collectors/zai/zai-markdown.ts';

type ZaiRole = 'user' | 'assistant';

type ZaiDescriptor = {
  key: string;
  role: ZaiRole;
  fingerprint: string;
  rendered: boolean;
  streaming: boolean;
  editing: boolean;
};

type ZaiMessageContent = {
  contentText: string;
  contentMarkdown: string;
  imageUrls: string[];
  attachmentFingerprint: string;
};

export function createZaiCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('zai');

  function matches(loc: any): boolean {
    const hostname = String(loc?.hostname || env.location.hostname || '').toLowerCase();
    return hostname === 'chat.z.ai';
  }

  function findConversationIdFromUrl(): string {
    const match = String(env.location.pathname || '').match(/^\/c\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  function isValidConversationUrl(): boolean {
    return !!findConversationIdFromUrl();
  }

  function findConversationKey(): string {
    return findConversationIdFromUrl();
  }

  function normalizedRoute(): string {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    return `${String(env.location.hostname || '').toLowerCase()}${pathname}`;
  }

  function findTitle(): string {
    return env.normalize.normalizeText(String(env.document.title || 'z.ai')).trim() || 'z.ai';
  }

  function getConversationRoot(): Element | null {
    return env.document.getElementById('messages-container');
  }

  function inEditMode(root: Element | null): boolean {
    if (!root) return false;
    if (root.querySelector("[id^='message-edit-']")) return true;
    return inEditModeUtil(root);
  }

  function isConversationStreaming(): boolean {
    return !!env.document.getElementById('chat-input') && !env.document.getElementById('send-message-button');
  }

  function sortByDomOrder(nodes: Iterable<Element>): Element[] {
    const sorted = Array.from(nodes);
    sorted.sort((left, right) => {
      if (left === right) return 0;
      const position = left.compareDocumentPosition(right);
      const following = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
      const preceding = env.window?.Node?.DOCUMENT_POSITION_PRECEDING ?? 2;
      if (position & following) return -1;
      if (position & preceding) return 1;
      return 0;
    });
    return sorted;
  }

  function roleFromWrapper(wrapper: Element | null): ZaiRole | null {
    if (!wrapper) return null;
    if (wrapper.classList.contains('user-message') || wrapper.querySelector('.chat-user')) return 'user';
    if (wrapper.classList.contains('chat-assistant') || wrapper.querySelector('.chat-assistant')) return 'assistant';
    return null;
  }

  function extractUserText(wrapper: Element): string {
    const node = wrapper.querySelector('.whitespace-pre-wrap') || wrapper;
    return env.normalize.normalizeText(String((node as HTMLElement).innerText || node.textContent || ''));
  }

  function extractAssistantText(wrapper: Element): string {
    return String(zaiMarkdown.extractAssistantText(wrapper) || '');
  }

  function extractAssistantMarkdown(wrapper: Element): string {
    return String(zaiMarkdown.extractAssistantMarkdown(wrapper) || '');
  }

  function comesBefore(left: Element, right: Element): boolean {
    const position = left.compareDocumentPosition(right);
    const following = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
    return !!(position & following);
  }

  function attachmentRegionForUser(wrapper: Element): Element | null {
    const textNode = wrapper.querySelector('.whitespace-pre-wrap');
    const candidates = Array.from(wrapper.querySelectorAll('.overflow-x-auto')).filter((element) =>
      element.querySelector("button[type='button'], video[src]"),
    );
    if (!candidates.length) return null;
    if (!textNode) return candidates[0] || null;
    return candidates.find((element) => comesBefore(element, textNode)) || null;
  }

  function attachmentNameFromButton(button: Element): string {
    const preferred = button.querySelector('.text-text-primary.truncate');
    const fallback = Array.from(button.querySelectorAll("[class*='truncate']")).find((element) => {
      if (element.querySelector("[class*='truncate']")) return false;
      return !!env.normalize.normalizeText(String(element.textContent || '')).trim();
    });
    return env.normalize.normalizeText(String((preferred || fallback)?.textContent || '')).trim();
  }

  function userAttachmentContent(wrapper: Element): { text: string; markdown: string; fingerprint: string } {
    const region = attachmentRegionForUser(wrapper);
    if (!region) return { text: '', markdown: '', fingerprint: '' };

    const textParts: string[] = [];
    const markdownParts: string[] = [];
    const fingerprints: string[] = [];
    const seen = new Set<string>();

    for (const button of Array.from(region.querySelectorAll("button[type='button']"))) {
      const name = attachmentNameFromButton(button);
      if (!name) continue;
      const key = `file:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = `Attachment: ${name}`;
      textParts.push(label);
      markdownParts.push(label);
      fingerprints.push(`file\u001e${name}`);
    }

    for (const video of Array.from(region.querySelectorAll('video[src]'))) {
      const src = String(video.getAttribute('src') || '').trim();
      const key = `video:${src || 'unknown'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = 'Video attachment';
      textParts.push(src ? `${label}: ${src}` : label);
      markdownParts.push(/^https?:\/\//i.test(src) ? `[${label}](${src})` : label);
      fingerprints.push(`video\u001e${src}`);
    }

    return {
      text: textParts.join('\n\n'),
      markdown: markdownParts.join('\n\n'),
      fingerprint: fingerprints.join('\u001f'),
    };
  }

  function getMessageWrappers(root: Element | null = getConversationRoot()): Element[] {
    if (!root?.querySelectorAll) return [];
    return sortByDomOrder(
      Array.from(root.querySelectorAll("div[id^='message-']")).filter((wrapper) => !!roleFromWrapper(wrapper)),
    );
  }

  function stableMessageKey(wrapper: Element): string {
    const id = String(wrapper.getAttribute('id') || '').trim();
    return /^message-.+/.test(id) ? id : '';
  }

  function imageScopeForWrapper(wrapper: Element, role: ZaiRole): Element {
    if (role === 'user') return wrapper.querySelector('.chat-user') || wrapper;
    return (
      wrapper.querySelector('#response-content-container') ||
      wrapper.querySelector('.markdown-prose') ||
      wrapper.querySelector('.chat-assistant') ||
      wrapper
    );
  }

  function extractMessageContent(wrapper: Element, role: ZaiRole): ZaiMessageContent {
    const attachment = role === 'user' ? userAttachmentContent(wrapper) : { text: '', markdown: '', fingerprint: '' };
    const baseText = role === 'user' ? extractUserText(wrapper) : extractAssistantText(wrapper);
    const imageUrls = extractImageUrlsFromElement(imageScopeForWrapper(wrapper, role));
    const baseMarkdown = role === 'assistant' ? extractAssistantMarkdown(wrapper) || baseText : baseText;
    const contentText = [attachment.text, baseText].filter(Boolean).join('\n\n');
    const contentMarkdown = appendImageMarkdown(
      [attachment.markdown, baseMarkdown].filter(Boolean).join('\n\n') || contentText,
      imageUrls,
    );
    return {
      contentText,
      contentMarkdown,
      imageUrls,
      attachmentFingerprint: attachment.fingerprint,
    };
  }

  function compactFingerprint(value: string): string {
    return typeof env.normalize.fnv1a32 === 'function' ? String(env.normalize.fnv1a32(value)) : value;
  }

  function descriptorFromWrapper(wrapper: Element, lastWrapper: Element | null): ZaiDescriptor | null {
    const role = roleFromWrapper(wrapper);
    const key = stableMessageKey(wrapper);
    if (!role || !key) return null;

    const editing = !!wrapper.querySelector("[id^='message-edit-']");
    const streaming = role === 'assistant' && wrapper === lastWrapper && isConversationStreaming();
    const content = extractMessageContent(wrapper, role);
    const rendered =
      !editing && !streaming && (!!content.contentText || !!content.contentMarkdown || content.imageUrls.length > 0);

    return {
      key,
      role,
      rendered,
      streaming,
      editing,
      fingerprint: compactFingerprint(
        [
          key,
          role,
          String(streaming),
          String(editing),
          content.contentText,
          content.contentMarkdown,
          content.attachmentFingerprint,
          content.imageUrls.join('|'),
        ].join('\u001f'),
      ),
    };
  }

  function readCurrentDescriptors(): ZaiDescriptor[] {
    const wrappers = getMessageWrappers();
    const lastWrapper = wrappers.at(-1) || null;
    return wrappers
      .map((wrapper) => descriptorFromWrapper(wrapper, lastWrapper))
      .filter((descriptor): descriptor is ZaiDescriptor => !!descriptor);
  }

  function sampleIdentityGuard(): PreparedIdentityGuard {
    const descriptors = readCurrentDescriptors();
    const anchors = descriptors.map((descriptor) => descriptor.key);
    return {
      route: normalizedRoute(),
      durableId: findConversationIdFromUrl(),
      anchors,
      topAnchor: anchors[0] || '',
    };
  }

  function createIdentitySampler(expected: PreparedIdentityGuard): () => string | null {
    const stableIdentity =
      expected.route && expected.durableId ? `${expected.route}|durable:${expected.durableId}` : '';
    return () => {
      if (!stableIdentity) return null;
      if (normalizedRoute() !== expected.route) return null;
      return findConversationIdFromUrl() === expected.durableId ? stableIdentity : null;
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

  function hasOlderHistorySentinel(root: Element | null = getConversationRoot()): boolean {
    if (!root) return false;
    const firstWrapper = getMessageWrappers(root)[0] || null;
    if (!firstWrapper) return false;
    return Array.from(root.querySelectorAll('.animate-pulse')).some(
      (element) => comesBefore(element, firstWrapper) && String(element.textContent || '').includes('Loading...'),
    );
  }

  function readBoundaryState(boundary: 'top' | 'bottom'): VirtualizedBoundaryState {
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return 'pending';
    const descriptors = readCurrentDescriptors();
    if (!descriptors.length) return 'pending';
    if (boundary === 'top') return hasOlderHistorySentinel(root) ? 'pending' : 'confirmed';
    const last = descriptors.at(-1);
    return last?.rendered && !last.streaming && !last.editing ? 'confirmed' : 'pending';
  }

  function snapshotMessage(wrapper: Element, descriptor: ZaiDescriptor, sequence: number): any | null {
    if (!descriptor.rendered || descriptor.streaming || descriptor.editing) return null;
    const content = extractMessageContent(wrapper, descriptor.role);
    if (!content.contentMarkdown && !content.contentText && !content.imageUrls.length) return null;
    return {
      messageKey: descriptor.key,
      role: descriptor.role,
      contentMarkdown: content.contentMarkdown || content.contentText,
      sequence,
      updatedAt: Date.now(),
    };
  }

  async function harvestCurrentInto(
    accumulator: PreparedAccumulator<any>,
  ): Promise<{ added: number; updated: number }> {
    const wrappers = getMessageWrappers();
    const lastWrapper = wrappers.at(-1) || null;
    const existingByKey = new Map(accumulator.records.map((record) => [record.key, record]));
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];

    for (let index = 0; index < wrappers.length; index += 1) {
      const wrapper = wrappers[index];
      const descriptor = descriptorFromWrapper(wrapper, lastWrapper);
      if (!descriptor) continue;
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

      const message = snapshotMessage(wrapper, descriptor, index);
      if (!message) continue;
      records.push({
        key: descriptor.key,
        turnKey: descriptor.key,
        withinTurn: 0,
        fingerprint: descriptor.fingerprint,
        payload: message,
      });
    }

    if (!records.length && wrappers.length) addPreparedReason(accumulator, 'unresolved_turn');
    return mergePreparedRecords(accumulator, records);
  }

  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return null;

    const initialIdentityGuard = sampleIdentityGuard();
    const conversationKey = initialIdentityGuard.durableId ? findConversationKey() : '';
    const accumulator = createPreparedAccumulator<any>({
      source: 'zai',
      conversationKey,
      identityVerified: !!conversationKey,
      identityGuard: initialIdentityGuard,
    });
    if (!conversationKey) addPreparedReason(accumulator, 'unstable_identity');

    const runtime = { document: env.document, window: env.window };
    const sampleIdentity = createIdentitySampler(initialIdentityGuard);
    const scrollRestorer = createScrollRootRestorer({
      ...runtime,
      getSeed: getConversationRoot,
      sampleIdentity,
    });

    try {
      const sweep = await runVirtualizedSweep(
        runtime,
        {
          getScrollSeed: getConversationRoot,
          sampleIdentity,
          readDescriptorKeys: () => readCurrentDescriptors().map((descriptor) => descriptor.key),
          readUnresolvedKeys: () =>
            readCurrentDescriptors()
              .filter((descriptor) => !descriptor.rendered || descriptor.streaming || descriptor.editing)
              .map((descriptor) => descriptor.key),
          readBoundaryState,
          onTopConfirmed: (target) => {
            const canonicalGuard = sampleIdentityGuard();
            target.identityGuard = { ...canonicalGuard, anchors: canonicalGuard.anchors.slice() };
          },
          harvest: harvestCurrentInto,
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

    const finalGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(accumulator.identityGuard, finalGuard)) {
      accumulator.identityVerified = false;
      accumulator.conversationKey = '';
      accumulator.records = [];
      accumulator.completeness = 'partial';
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

    const prepared = consumePreparedCapture(options?.preparedCapture);
    if (!prepared) return null;
    const currentGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(prepared.identityGuard, currentGuard)) return null;

    const accumulator = createPreparedAccumulator<any>({
      source: 'zai',
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

    const finalLive = await harvestCurrentInto(accumulator);
    if (accumulator.completeness === 'complete' && (finalLive.added > 0 || finalLive.updated > 0)) {
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'final_live_changed');
    }

    const finalGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(accumulator.identityGuard, finalGuard)) return null;

    const finalPrepared = finishPreparedCapture(accumulator);
    const messages = finalPrepared.records.map((record, index) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !finalPrepared.identityVerified || !finalPrepared.conversationKey) return null;

    return {
      conversation: {
        sourceType: 'chat',
        source: 'zai',
        conversationKey: finalPrepared.conversationKey,
        title: findTitle(),
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

  const collector: any = {
    capture,
    isCaptureAvailable: isValidConversationUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: {
      removeThinkingNodes: (zaiMarkdown as any).removeThinkingNodes,
      removeNonContentNodes: (zaiMarkdown as any).removeNonContentNodes,
      normalizeMarkdown: (zaiMarkdown as any).normalizeMarkdown,
      htmlToMarkdown: (zaiMarkdown as any).htmlToMarkdown,
      extractTextFromSanitizedClone: (zaiMarkdown as any).extractTextFromSanitizedClone,
      extractAssistantMarkdown: (zaiMarkdown as any).extractAssistantMarkdown,
      extractAssistantText: (zaiMarkdown as any).extractAssistantText,
      readCurrentDescriptors,
      readBoundaryState,
      hasOlderHistorySentinel,
      isConversationStreaming,
    },
  };

  return { id: 'zai', matches, collector };
}
