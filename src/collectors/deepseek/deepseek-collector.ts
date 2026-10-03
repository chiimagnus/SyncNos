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
import deepseekMarkdown from '@collectors/deepseek/deepseek-markdown.ts';

type DeepseekRole = 'user' | 'assistant';

type DeepseekDescriptor = {
  key: string;
  role: DeepseekRole;
  fingerprint: string;
  rendered: boolean;
  streaming: boolean;
  editing: boolean;
};

export function createDeepseekCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('deepseek');

  function matches(loc: any): boolean {
    const hostname = String(loc?.hostname || env.location.hostname || '').toLowerCase();
    return hostname === 'chat.deepseek.com';
  }

  function findConversationIdFromUrl(): string {
    const match = String(env.location.pathname || '').match(/^\/a\/chat\/s\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  function isValidConversationUrl(): boolean {
    return !!findConversationIdFromUrl();
  }

  function isConversationSurfaceUrl(): boolean {
    const pathname = String(env.location.pathname || '');
    return pathname === '/' || /^\/a\/chat(?:\/|$)/.test(pathname);
  }

  function normalizedRoute(): string {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    return `${String(env.location.hostname || '').toLowerCase()}${pathname}`;
  }

  function findTitle(): string {
    return env.normalize.normalizeText(String(env.document.title || 'DeepSeek')).trim() || 'DeepSeek';
  }

  function getConversationRoot(): Element | null {
    return env.document.querySelector('.ds-virtual-list');
  }

  function getVisibleItems(root: Element | null = getConversationRoot()): Element[] {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll('[data-virtual-list-item-key]'));
  }

  function stableMessageKey(item: Element): string {
    const raw = String(item.getAttribute('data-virtual-list-item-key') || '').trim();
    return raw ? `deepseek_${raw}` : '';
  }

  function roleFromItem(item: Element): DeepseekRole | null {
    if (item.querySelector('.ds-assistant-message-main-content, .ds-think-content')) return 'assistant';
    return item.querySelector('.ds-message') ? 'user' : null;
  }

  function inEditMode(root: Element | null): boolean {
    return !!root && inEditModeUtil(root);
  }

  function extractUserText(item: Element): string {
    const message = item.querySelector('.ds-message') || item;
    const clone = message.cloneNode(true) as Element;
    for (const node of Array.from(clone.querySelectorAll('button, svg, path, textarea, input, select, option'))) {
      node.remove();
    }
    return env.normalize.normalizeText(String((clone as HTMLElement).innerText || clone.textContent || ''));
  }

  function assistantContentNode(item: Element): Element | null {
    return item.querySelector('.ds-assistant-message-main-content');
  }

  function extractAssistantText(item: Element): string {
    const node = assistantContentNode(item);
    if (!node) return '';
    const fallback = env.normalize.normalizeText(String((node as HTMLElement).innerText || node.textContent || ''));
    return String(deepseekMarkdown.extractAssistantText(node) || fallback);
  }

  function extractAssistantMarkdown(item: Element): string {
    const node = assistantContentNode(item);
    if (!node) return '';
    return String(deepseekMarkdown.extractAssistantMarkdown(node) || extractAssistantText(item));
  }

  function isAssistantStreaming(item: Element): boolean {
    if (!assistantContentNode(item)) return true;
    return !!item.querySelector('[data-markdown-animated], .ds-markdown-loading');
  }

  function extractContent(item: Element, role: DeepseekRole) {
    const text = role === 'user' ? extractUserText(item) : extractAssistantText(item);
    const contentNode = role === 'assistant' ? assistantContentNode(item) || item : item;
    const imageUrls = extractImageUrlsFromElement(contentNode);
    const baseMarkdown = role === 'assistant' ? extractAssistantMarkdown(item) || text : text;
    return {
      text,
      imageUrls,
      markdown: appendImageMarkdown(baseMarkdown, imageUrls),
    };
  }

  function compactFingerprint(value: string): string {
    return typeof env.normalize.fnv1a32 === 'function' ? String(env.normalize.fnv1a32(value)) : value;
  }

  function descriptorFromItem(item: Element): DeepseekDescriptor | null {
    const key = stableMessageKey(item);
    const role = roleFromItem(item);
    if (!key || !role) return null;
    const editing = inEditMode(item);
    const streaming = role === 'assistant' && isAssistantStreaming(item);
    const content = extractContent(item, role);
    const rendered = !editing && !streaming && (!!content.text || !!content.markdown || content.imageUrls.length > 0);
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
          content.text,
          content.markdown,
          content.imageUrls.join('|'),
        ].join('\u001f'),
      ),
    };
  }

  function readCurrentDescriptors(): DeepseekDescriptor[] {
    return getVisibleItems()
      .map(descriptorFromItem)
      .filter((descriptor): descriptor is DeepseekDescriptor => !!descriptor);
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

  function createIdentitySampler(expected: PreparedIdentityGuard): () => string | null {
    const stableIdentity =
      expected.route && expected.durableId ? `${expected.route}|durable:${expected.durableId}` : '';
    return () => {
      if (!stableIdentity || normalizedRoute() !== expected.route) return null;
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

  function visibleWindowOffset(): number | null {
    const node = getConversationRoot()?.querySelector('.ds-virtual-list-visible-items') as HTMLElement | null;
    if (!node) return null;
    const raw =
      node.style.getPropertyValue('--dsl-virtual-list-transform-y') ||
      node.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ||
      '';
    const value = Number.parseFloat(String(raw).replace('px', ''));
    return Number.isFinite(value) ? value : null;
  }

  function readBoundaryState(boundary: 'top' | 'bottom'): VirtualizedBoundaryState {
    const root = getConversationRoot() as HTMLElement | null;
    if (!root || inEditMode(root)) return 'pending';
    const descriptors = readCurrentDescriptors();
    if (!descriptors.length) return 'pending';

    if (boundary === 'top') {
      const offset = visibleWindowOffset();
      return root.scrollTop <= 1 && (offset == null || Math.abs(offset) <= 1) ? 'confirmed' : 'pending';
    }

    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
    const last = descriptors.at(-1);
    return atBottom && !!last?.rendered && !last.streaming && !last.editing ? 'confirmed' : 'pending';
  }

  function snapshotMessage(item: Element, descriptor: DeepseekDescriptor, sequence: number): any | null {
    if (!descriptor.rendered || descriptor.streaming || descriptor.editing) return null;
    const content = extractContent(item, descriptor.role);
    if (!content.markdown && !content.text && !content.imageUrls.length) return null;
    return {
      messageKey: descriptor.key,
      role: descriptor.role,
      contentMarkdown: content.markdown || content.text,
      sequence,
      updatedAt: Date.now(),
    };
  }

  async function harvestCurrentInto(
    accumulator: PreparedAccumulator<any>,
  ): Promise<{ added: number; updated: number }> {
    const items = getVisibleItems();
    const existingByKey = new Map(accumulator.records.map((record) => [record.key, record]));
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const descriptor = descriptorFromItem(item);
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
      const message = snapshotMessage(item, descriptor, index);
      if (!message) continue;
      records.push({
        key: descriptor.key,
        turnKey: descriptor.key,
        withinTurn: 0,
        fingerprint: descriptor.fingerprint,
        payload: message,
      });
    }

    if (!records.length && items.length) addPreparedReason(accumulator, 'unresolved_turn');
    return mergePreparedRecords(accumulator, records);
  }

  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return null;

    const initialIdentityGuard = sampleIdentityGuard();
    const conversationKey = initialIdentityGuard.durableId;
    const accumulator = createPreparedAccumulator<any>({
      source: 'deepseek',
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
            const canonical = sampleIdentityGuard();
            target.identityGuard = { ...canonical, anchors: canonical.anchors.slice() };
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
      const restored = scrollRestorer.restore();
      if (!restored.restored) {
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

  function snapshotFromPreparedCapture(prepared: any): any | null {
    const messages = prepared.records.map((record: any, index: number) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !prepared.identityVerified || !prepared.conversationKey) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'deepseek',
        conversationKey: prepared.conversationKey,
        title: findTitle(),
        url: env.location.href,
        warningFlags: [],
      },
      messages,
      captureMeta: {
        completeness: prepared.completeness,
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
        source: 'deepseek',
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

    const prepared = consumePreparedCapture(options?.preparedCapture);
    if (!prepared) return null;
    const currentGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(prepared.identityGuard, currentGuard)) return null;

    const accumulator = createPreparedAccumulator<any>({
      source: 'deepseek',
      conversationKey: prepared.conversationKey,
      identityVerified: prepared.identityVerified === true,
      identityGuard: prepared.identityGuard,
    });
    accumulator.completeness = prepared.completeness;
    accumulator.reasons.push(...prepared.reasons.filter((reason: string) => !accumulator.reasons.includes(reason)));
    accumulator.sweepMetrics = { ...prepared.metrics };
    mergePreparedRecords(
      accumulator,
      prepared.records.map(({ firstSeenIndex: _firstSeenIndex, ...record }: any) => record),
    );

    const finalLive = await harvestCurrentInto(accumulator);
    if (accumulator.completeness === 'complete' && (finalLive.added > 0 || finalLive.updated > 0)) {
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'final_live_changed');
    }

    if (!identityGuardsMatch(accumulator.identityGuard, sampleIdentityGuard())) return null;
    return snapshotFromPreparedCapture(finishPreparedCapture(accumulator));
  }

  const collector: any = {
    capture,
    isCaptureAvailable: isConversationSurfaceUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: {
      getVisibleItems,
      readCurrentDescriptors,
      readBoundaryState,
      visibleWindowOffset,
    },
  };

  return { id: 'deepseek', matches, collector };
}
