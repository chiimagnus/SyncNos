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
import yuanbaoMarkdown from '@collectors/yuanbao/yuanbao-markdown.ts';

type YuanbaoRole = 'user' | 'assistant';

type YuanbaoDescriptor = {
  key: string;
  role: YuanbaoRole;
  fingerprint: string;
  rendered: boolean;
  streaming: boolean;
  sensitive: boolean;
  failedUpload: boolean;
};

export function createYuanbaoCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('yuanbao');

  function matches(loc: any): boolean {
    const hostname = String(loc?.hostname || env.location.hostname || '').toLowerCase();
    return hostname === 'yuanbao.tencent.com';
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

  function findTitle(): string {
    return env.normalize.normalizeText(String(env.document.title || 'Yuanbao')).trim() || 'Yuanbao';
  }

  function getConversationRoot(): Element | null {
    return (
      env.document.querySelector('.agent-chat__list__content-wrapper') ||
      env.document.querySelector('.agent-chat__list__content')
    );
  }

  function getScrollRoot(): Element | null {
    return env.document.querySelector('.agent-chat__list__content-wrapper') || getConversationRoot();
  }

  function inEditMode(root: Element | null): boolean {
    return !!root && inEditModeUtil(root);
  }

  function getMessageItems(root: Element | null = getConversationRoot()): Element[] {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll('[data-conv-idx][data-conv-speaker]')).filter((item) => {
      const speaker = String(item.getAttribute('data-conv-speaker') || '');
      return speaker === 'human' || speaker === 'ai';
    });
  }

  function roleFromItem(item: Element): YuanbaoRole | null {
    const speaker = String(item.getAttribute('data-conv-speaker') || '');
    if (speaker === 'human') return 'user';
    if (speaker === 'ai') return 'assistant';
    return null;
  }

  function stableMessageKey(item: Element, role: YuanbaoRole): string {
    const index = String(item.getAttribute('data-conv-idx') || '').trim();
    return index ? `yuanbao_${index}_${role}` : '';
  }

  function attachmentMarkdown(item: Element): string {
    const names = Array.from(item.querySelectorAll('.hyc-content-file__info__name'))
      .map((node) => env.normalize.normalizeText(String(node.textContent || '')).trim())
      .filter(Boolean);
    return Array.from(new Set(names))
      .map((name) => `Attachment: ${name}`)
      .join('\n\n');
  }

  function userText(item: Element): string {
    const bubble = item.querySelector('.agent-chat__bubble') || item;
    const nodes = Array.from(bubble.querySelectorAll('.hyc-content-text'));
    const parts = nodes.length
      ? nodes
          .map((node) => env.normalize.normalizeText(String((node as HTMLElement).innerText || node.textContent || '')))
          .filter(Boolean)
      : [env.normalize.normalizeText(String((bubble as HTMLElement).innerText || bubble.textContent || ''))].filter(
          Boolean,
        );
    return env.normalize.normalizeText(Array.from(new Set(parts)).join('\n\n'));
  }

  function assistantContentNode(item: Element): Element | null {
    return item.querySelector('.agent-chat__speech-text');
  }

  function assistantText(item: Element): string {
    const node = assistantContentNode(item);
    if (!node) return '';
    const fallback = env.normalize.normalizeText(String((node as HTMLElement).innerText || node.textContent || ''));
    return typeof yuanbaoMarkdown.extractAssistantText === 'function'
      ? yuanbaoMarkdown.extractAssistantText(node) || fallback
      : fallback;
  }

  function assistantMarkdown(item: Element): string {
    const node = assistantContentNode(item);
    if (!node) return '';
    const fallback = assistantText(item);
    return typeof yuanbaoMarkdown.extractAssistantMarkdown === 'function'
      ? yuanbaoMarkdown.extractAssistantMarkdown(node) || fallback
      : fallback;
  }

  function extractContent(item: Element, role: YuanbaoRole) {
    const attachments = attachmentMarkdown(item);
    const text = role === 'user' ? userText(item) : assistantText(item);
    const baseMarkdown = role === 'assistant' ? assistantMarkdown(item) : text;
    const imageRoot = (item.querySelector('.agent-chat__bubble') || item).cloneNode(true) as Element;
    for (const fileCard of Array.from(imageRoot.querySelectorAll('.hyc-content-file'))) fileCard.remove();
    const imageUrls = extractImageUrlsFromElement(imageRoot);
    return {
      text: [attachments, text].filter(Boolean).join('\n\n'),
      markdown: appendImageMarkdown([attachments, baseMarkdown].filter(Boolean).join('\n\n'), imageUrls),
      imageUrls,
      attachments,
    };
  }

  function compactFingerprint(value: string): string {
    return typeof env.normalize.fnv1a32 === 'function' ? String(env.normalize.fnv1a32(value)) : value;
  }

  function descriptorFromItem(item: Element): YuanbaoDescriptor | null {
    const role = roleFromItem(item);
    if (!role) return null;
    const key = stableMessageKey(item, role);
    if (!key) return null;
    const streaming = role === 'assistant' && String(item.getAttribute('data-conv-outputting') || '') === 'true';
    const sensitive = String(item.getAttribute('data-conv-sensitive') || '') === 'true';
    const failedUpload = String(item.getAttribute('data-conv-failed-upload') || '') === 'true';
    const content = extractContent(item, role);
    const rendered =
      !streaming &&
      !sensitive &&
      !failedUpload &&
      (!!content.text || !!content.markdown || content.imageUrls.length > 0);
    return {
      key,
      role,
      streaming,
      sensitive,
      failedUpload,
      rendered,
      fingerprint: compactFingerprint(
        [
          key,
          role,
          String(streaming),
          String(sensitive),
          String(failedUpload),
          content.text,
          content.markdown,
          content.imageUrls.join('|'),
        ].join('\u001f'),
      ),
    };
  }

  function readCurrentDescriptors(): YuanbaoDescriptor[] {
    return getMessageItems()
      .map(descriptorFromItem)
      .filter((descriptor): descriptor is YuanbaoDescriptor => !!descriptor);
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
    const items = getMessageItems();
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];
    let unresolved = false;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const descriptor = descriptorFromItem(item);
      if (!descriptor) continue;
      if (!descriptor.rendered || descriptor.streaming || descriptor.sensitive || descriptor.failedUpload) {
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
    const scrollRoot = getScrollRoot() as HTMLElement | null;
    const descriptors = readCurrentDescriptors();
    return `${descriptors.map((descriptor) => `${descriptor.key}:${descriptor.fingerprint}`).join('|')}|${Number(scrollRoot?.scrollHeight || 0)}`;
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
      source: 'yuanbao',
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
    const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    let stableRounds = 0;

    try {
      await harvestCurrentInto(accumulator);
      for (let round = 0; round < maxRounds && stableRounds < stableRoundsRequired; round += 1) {
        const before = currentWindowSignature();
        if (typeof scrollRoot.scrollTo === 'function') {
          scrollRoot.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        } else {
          scrollRoot.scrollTop = 0;
        }
        const changed = await waitForHistoryChange(before, { waitForLoadMs, pollMs, sleep, now });
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

  function snapshotFromPreparedCapture(prepared: any): any | null {
    const messages = prepared.records.map((record: any, index: number) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !prepared.identityVerified || !prepared.conversationKey) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'yuanbao',
        conversationKey: prepared.conversationKey,
        title: findTitle(),
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
        source: 'yuanbao',
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
      source: 'yuanbao',
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

  return { id: 'yuanbao', matches, collector };
}
