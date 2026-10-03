import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
} from '@collectors/collector-utils.ts';
import claudeMarkdown from '@collectors/claude/claude-markdown.ts';
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

const TRANSCRIPT_ROW_SELECTOR = "[data-testid='transcript-row']";
const TRANSCRIPT_FEED_SELECTOR = "[role='feed'][data-perf-region='transcript']";

type ClaudeRole = 'user' | 'assistant';

type ClaudeDescriptor = {
  key: string;
  turnKey: string;
  withinTurn: number;
  role: ClaudeRole;
  position: number;
  total: number;
  fingerprint: string;
  rendered: boolean;
  streaming: boolean;
};

export function createClaudeCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('claude');
  let observedMessageCount = 0;

  function matches(loc: any): boolean {
    const hostname = String(loc?.hostname || env.location.hostname || '').toLowerCase();
    return /(^|\.)claude\.ai$/.test(hostname);
  }

  function findConversationId(): string {
    const match = String(env.location.pathname || '').match(/^\/chat\/([^/?#]+)\/?$/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  function isValidConversationUrl(): boolean {
    return !!findConversationId();
  }

  function findConversationKey(): string {
    return isValidConversationUrl() ? conversationKeyFromLocation(env.location) : '';
  }

  function normalizedRoute(): string {
    const pathname = String(env.location.pathname || '/').replace(/\/+$/, '') || '/';
    return `${String(env.location.hostname || '').toLowerCase()}${pathname}`;
  }

  function getConversationRoot(): Element | null {
    return env.document.querySelector(TRANSCRIPT_FEED_SELECTOR);
  }

  function getConversationScrollSeed(): Element | null {
    return getConversationRoot();
  }

  function isEditingConversation(root: Element | null): boolean {
    if (!root?.querySelector) return false;
    const active = env.document.activeElement;
    if (!active || active === env.document.body) return false;
    const editor = root.querySelector("textarea, [contenteditable='true']");
    return !!editor && (editor === active || editor.contains(active));
  }

  function normalizeTitle(value: unknown): string {
    return env.normalize.normalizeText(String(value || '')).trim();
  }

  function extractConversationTitle(): string {
    const pageTitle = normalizeTitle(env.document.title || '');
    const withoutSuffix = normalizeTitle(pageTitle.replace(/\s*[-–—]\s*Claude\s*$/i, ''));
    return withoutSuffix || 'Claude';
  }

  function rowRole(row: Element): ClaudeRole | null {
    const perfRole = String(row.getAttribute('data-perf-row') || '')
      .trim()
      .toLowerCase();
    if (perfRole === 'human') return 'user';
    if (perfRole === 'assistant') return 'assistant';
    return null;
  }

  function positiveInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function rowPosition(row: Element): number {
    const article = row.querySelector("[role='article']");
    return positiveInteger(article?.getAttribute('aria-posinset'));
  }

  function rowTotal(row: Element): number {
    const article = row.querySelector("[role='article']");
    return positiveInteger(article?.getAttribute('aria-setsize'));
  }

  function stableMessageKey(position: number, role: ClaudeRole): string {
    return position > 0 ? `claude:${position}:${role}` : '';
  }

  function isAssistantStreaming(row: Element): boolean {
    const rowStreaming = String(row.getAttribute('data-perf-row-streaming') || '')
      .trim()
      .toLowerCase();
    const assistant = row.querySelector("[data-testid='assistant-message']");
    const messageStreaming = String(assistant?.getAttribute('data-is-streaming') || '')
      .trim()
      .toLowerCase();
    return rowStreaming === 'true' || messageStreaming === 'true';
  }

  function assistantContentNode(row: Element): Element | null {
    const assistant = row.querySelector("[data-testid='assistant-message']");
    if (!assistant) return null;

    // Older Claude builds mark visible reply blocks with data-perf-reply-text. Current builds expose
    // the final response as one or more CDS Prose blocks while tool/thinking state remains in TurnStatus.
    const legacyReplies = Array.from(assistant.querySelectorAll('[data-perf-reply-text]'));
    const currentProse = Array.from(assistant.querySelectorAll("[data-cds='Prose']")).filter(
      (node) => !node.closest("[data-cds='TurnStatus'], [data-testid='TurnStatus']"),
    );
    const replies = legacyReplies.length ? legacyReplies : currentProse;
    if (!replies.length) return null;
    if (replies.length === 1) return replies[0] || null;

    const combined = env.document.createElement('div');
    for (const reply of replies) combined.appendChild(reply.cloneNode(true));
    return combined;
  }

  function contentNodeForRow(row: Element, role: ClaudeRole): Element | null {
    if (role === 'user') return row.querySelector("[data-testid='user-message']");
    return assistantContentNode(row);
  }

  function imageUrlsForRow(row: Element, role: ClaudeRole, content: Element | null): string[] {
    if (role === 'user') return extractImageUrlsFromElement(row);
    return extractImageUrlsFromElement(content);
  }

  function userAttachmentContent(row: Element): { text: string; markdown: string; fingerprint: string } {
    const tiles = Array.from(row.querySelectorAll("[data-cds='MessageAttachments'] [data-testid='file-thumbnail']"));
    const textParts: string[] = [];
    const markdownParts: string[] = [];
    const fingerprints: string[] = [];

    for (const tile of tiles) {
      const kind = String(tile.getAttribute('data-cds') || '');
      const quoteNode = kind === 'MessageAttachmentsQuote' ? tile.querySelector('blockquote') || tile : null;
      const source = quoteNode || tile;
      const clone = source.cloneNode(true) as Element;
      for (const hidden of Array.from(clone.querySelectorAll('.sr-only, svg, button, [aria-hidden="true"]'))) {
        hidden.remove();
      }
      const text = env.normalize.normalizeText(String(clone.textContent || '')).trim();
      if (!text || textParts.includes(text)) continue;

      fingerprints.push(`${kind}\u001e${text}`);
      textParts.push(text);
      markdownParts.push(
        quoteNode
          ? text
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n')
          : text,
      );
    }

    return {
      text: textParts.join('\n\n'),
      markdown: markdownParts.join('\n\n'),
      fingerprint: fingerprints.join('\u001f'),
    };
  }

  function normalizedNodeText(node: Element | null): string {
    if (!node) return '';
    const extracted = claudeMarkdown.extractText(node) || (node as any).innerText || node.textContent || '';
    return env.normalize.normalizeText(extracted || '');
  }

  function markdownFromNode(node: Element | null, fallbackText: string): string {
    if (!node) return '';
    return String(claudeMarkdown.extractMarkdown(node) || fallbackText || '').trim();
  }

  function compactFingerprint(value: string): string {
    return typeof env.normalize.fnv1a32 === 'function' ? String(env.normalize.fnv1a32(value)) : value;
  }

  function descriptorFromRow(row: Element): ClaudeDescriptor | null {
    const role = rowRole(row);
    const position = rowPosition(row);
    if (!role || !position) return null;

    const total = rowTotal(row);
    observedMessageCount = Math.max(observedMessageCount, total);
    const key = stableMessageKey(position, role);
    const content = contentNodeForRow(row, role);
    const streaming = role === 'assistant' && isAssistantStreaming(row);
    const imageUrls = imageUrlsForRow(row, role, content);
    const attachment = role === 'user' ? userAttachmentContent(row) : { text: '', markdown: '', fingerprint: '' };
    const semanticText = normalizedNodeText(content);
    const semanticMarkdown = markdownFromNode(content, semanticText);
    const rendered = !streaming && (!!semanticText || !!semanticMarkdown || !!attachment.text || imageUrls.length > 0);

    return {
      key,
      turnKey: `claude:${position}`,
      withinTurn: 0,
      role,
      position,
      total,
      fingerprint: compactFingerprint(
        [
          key,
          role,
          String(streaming),
          semanticText,
          semanticMarkdown,
          attachment.fingerprint,
          imageUrls.join('|'),
        ].join('\u001f'),
      ),
      rendered,
      streaming,
    };
  }

  function readCurrentRows(): Element[] {
    const root = getConversationRoot();
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll(TRANSCRIPT_ROW_SELECTOR));
  }

  function readCurrentDescriptors(): ClaudeDescriptor[] {
    const descriptors: ClaudeDescriptor[] = [];
    for (const row of readCurrentRows()) {
      const descriptor = descriptorFromRow(row);
      if (descriptor) descriptors.push(descriptor);
    }
    descriptors.sort((left, right) => left.position - right.position);
    return descriptors;
  }

  function sampleIdentityGuard(): PreparedIdentityGuard {
    const descriptors = readCurrentDescriptors();
    const anchors = descriptors.map((descriptor) => descriptor.key);
    return {
      route: normalizedRoute(),
      durableId: findConversationId(),
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
      return findConversationId() === expected.durableId ? stableIdentity : null;
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

  function readBoundaryState(boundary: 'top' | 'bottom'): VirtualizedBoundaryState {
    const descriptors = readCurrentDescriptors();
    if (!descriptors.length) return 'pending';
    const positions = descriptors.map((descriptor) => descriptor.position).filter((position) => position > 0);
    const total = Math.max(observedMessageCount, ...descriptors.map((descriptor) => descriptor.total));
    if (!positions.length || !total) return 'pending';
    if (boundary === 'top') return Math.min(...positions) === 1 ? 'confirmed' : 'pending';
    return Math.max(...positions) === total ? 'confirmed' : 'pending';
  }

  function snapshotMessage(row: Element, descriptor: ClaudeDescriptor): any | null {
    if (!descriptor.rendered || descriptor.streaming) return null;
    const content = contentNodeForRow(row, descriptor.role);
    const baseText = normalizedNodeText(content);
    const attachment =
      descriptor.role === 'user' ? userAttachmentContent(row) : { text: '', markdown: '', fingerprint: '' };
    const contentText = [attachment.text, baseText].filter(Boolean).join('\n\n');
    const imageUrls = imageUrlsForRow(row, descriptor.role, content);
    const baseMarkdown = markdownFromNode(content, baseText);
    const contentMarkdown = appendImageMarkdown(
      [attachment.markdown, baseMarkdown].filter(Boolean).join('\n\n'),
      imageUrls,
    );
    if (!contentText && !contentMarkdown && !imageUrls.length) return null;
    return {
      messageKey: descriptor.key,
      role: descriptor.role,
      contentText,
      contentMarkdown,
      sequence: Math.max(0, descriptor.position - 1),
      updatedAt: Date.now(),
    };
  }

  async function harvestCurrentInto(
    accumulator: PreparedAccumulator<any>,
  ): Promise<{ added: number; updated: number }> {
    const existingByKey = new Map(accumulator.records.map((record) => [record.key, record]));
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];

    for (const row of readCurrentRows()) {
      const descriptor = descriptorFromRow(row);
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

      const message = snapshotMessage(row, descriptor);
      if (!message) continue;
      records.push({
        key: descriptor.key,
        turnKey: descriptor.turnKey,
        withinTurn: descriptor.withinTurn,
        fingerprint: descriptor.fingerprint,
        payload: message,
      });
    }

    if (!records.length && readCurrentRows().length) addPreparedReason(accumulator, 'unresolved_turn');
    return mergePreparedRecords(accumulator, records);
  }

  function positionFromRecordKey(key: string): number {
    const match = String(key || '').match(/^claude:(\d+):(user|assistant)$/);
    return match?.[1] ? positiveInteger(match[1]) : 0;
  }

  function validateCoverage(accumulator: PreparedAccumulator<any>): void {
    const total = observedMessageCount;
    if (!total) return;
    const positions = new Set(
      accumulator.records.map((record) => positionFromRecordKey(record.key)).filter((position) => position > 0),
    );
    let complete = positions.size === total;
    for (let position = 1; complete && position <= total; position += 1) {
      if (!positions.has(position)) complete = false;
    }
    if (!complete) {
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'unresolved_turn');
    }
  }

  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    if (!root || isEditingConversation(root)) return null;

    observedMessageCount = 0;
    const initialIdentityGuard = sampleIdentityGuard();
    const conversationKey = initialIdentityGuard.durableId ? findConversationKey() : '';
    const accumulator = createPreparedAccumulator<any>({
      source: 'claude',
      conversationKey,
      identityVerified: !!conversationKey,
      identityGuard: initialIdentityGuard,
    });
    if (!conversationKey) addPreparedReason(accumulator, 'unstable_identity');

    const runtime = { document: env.document, window: env.window };
    const sampleIdentity = createIdentitySampler(initialIdentityGuard);
    const scrollRestorer = createScrollRootRestorer({
      ...runtime,
      getSeed: getConversationScrollSeed,
      sampleIdentity,
    });

    try {
      const sweep = await runVirtualizedSweep(
        runtime,
        {
          getScrollSeed: getConversationScrollSeed,
          sampleIdentity,
          readDescriptorKeys: () => readCurrentDescriptors().map((descriptor) => descriptor.key),
          readUnresolvedKeys: () =>
            readCurrentDescriptors()
              .filter((descriptor) => !descriptor.rendered || descriptor.streaming)
              .map((descriptor) => descriptor.key),
          readBoundaryState,
          onTopConfirmed: (target) => {
            const canonicalGuard = sampleIdentityGuard();
            target.identityGuard = {
              ...canonicalGuard,
              anchors: canonicalGuard.anchors.slice(),
            };
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
      validateCoverage(accumulator);
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

  async function capture(options: any): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl() || options?.manual !== true) {
      return null;
    }
    const prepared = consumePreparedCapture(options?.preparedCapture);
    if (!prepared) return null;
    const currentGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(prepared.identityGuard, currentGuard)) return null;

    observedMessageCount = Math.max(
      observedMessageCount,
      ...readCurrentDescriptors().map((descriptor) => descriptor.total),
    );
    const accumulator = createPreparedAccumulator<any>({
      source: 'claude',
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
    validateCoverage(accumulator);

    const finalGuard = sampleIdentityGuard();
    if (!identityGuardsMatch(accumulator.identityGuard, finalGuard)) return null;

    const finalPrepared = finishPreparedCapture(accumulator);
    const records = finalPrepared.records
      .slice()
      .sort((left, right) => positionFromRecordKey(left.key) - positionFromRecordKey(right.key));
    const messages = records.map((record, index) => ({ ...record.payload, sequence: index }));
    if (!messages.length || !finalPrepared.identityVerified || !finalPrepared.conversationKey) return null;

    return {
      conversation: {
        sourceType: 'chat',
        source: 'claude',
        conversationKey: finalPrepared.conversationKey,
        title: extractConversationTitle(),
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
    isCaptureAvailable: isValidConversationUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: {
      readCurrentDescriptors,
      readBoundaryState,
    },
  };

  return { id: 'claude', matches, collector };
}
