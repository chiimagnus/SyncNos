import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  extractImageUrlsFromElement,
  firstUserMessageTitle,
  inEditMode as inEditModeUtil,
  renderedElementText,
} from '@collectors/collector-utils.ts';
import googleAiStudioMarkdown from '@collectors/googleaistudio/googleaistudio-markdown.ts';
import {
  addPreparedReason,
  createPreparedAccumulator,
  createScrollRootRestorer,
  finishPreparedCapture,
  mergePreparedRecords,
  createPreparedCaptureConsumer,
  runVirtualizedSweep,
  resolveScrollRoot,
  type PreparedAccumulator,
  type PreparedIdentityGuard,
  type PreparedMessageRecord,
} from '@collectors/virtualized-chat/virtualized-chat-sweep.ts';

function normalizeRoleFromTurn(turn: Element): 'user' | 'assistant' | null {
  const container = turn.querySelector('.chat-turn-container');
  if (container && (container as any).classList) {
    const cls = (container as any).classList;
    if (cls.contains('user')) return 'user';
    if (cls.contains('model')) return 'assistant';
  }
  const marker = turn.querySelector('[data-turn-role]');
  const roleText =
    marker && (marker as any).getAttribute ? String((marker as any).getAttribute('data-turn-role') || '') : '';
  if (/user/i.test(roleText)) return 'user';
  if (/model|assistant/i.test(roleText)) return 'assistant';
  return null;
}

function pickTurnContent(turn: Element, role: 'user' | 'assistant'): Element | null {
  const roleSelector =
    role === 'user' ? '[data-turn-role="User"] .turn-content' : '[data-turn-role="Model"] .turn-content';
  const scoped = turn.querySelector(roleSelector);
  if (scoped) return scoped as any;
  const anyContent = turn.querySelector('.turn-content');
  return (anyContent as any) || null;
}

export function createGoogleAiStudioCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('googleaistudio');
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)aistudio\.google\.com$/.test(hostname) || /(^|\.)makersuite\.google\.com$/.test(hostname);
  }

  function findSavedPromptIdFromUrl(): string {
    try {
      const path = String(env.location.pathname || '');
      const match = path.match(/^\/(?:app\/)?(?:u\/\d+\/)?prompts\/([^/?#]+)(?:\/|$)/);
      const id = match?.[1] ? decodeURIComponent(match[1]).trim() : '';
      if (!id) return '';
      if (new Set(['new_chat', 'new_comparison', 'new_image', 'new_video', 'new_music']).has(id)) return '';
      return id;
    } catch (_error) {
      return '';
    }
  }

  function isValidConversationUrl(): boolean {
    return !!findSavedPromptIdFromUrl();
  }

  function findConversationKey(): any {
    return findSavedPromptIdFromUrl();
  }

  function getConversationRoot(): any {
    return (
      env.document.querySelector('.chat-session-content') || env.document.querySelector('main') || env.document.body
    );
  }

  function stableTurnAnchors(root = getConversationRoot()): string[] {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    return Array.from(root.querySelectorAll('ms-chat-turn[id]'))
      .map((turn: any) => String(turn?.getAttribute?.('id') || '').trim())
      .filter(Boolean);
  }

  function sampleIdentityGuard(): PreparedIdentityGuard {
    const anchors = stableTurnAnchors();
    return {
      route: String(env.location.pathname || ''),
      durableId: String(findConversationKey() || '').trim(),
      anchors,
      topAnchor: anchors[0] || '',
    };
  }

  function identityGuardsMatch(expected: PreparedIdentityGuard, actual = sampleIdentityGuard()): boolean {
    if (!expected || !actual || !expected.route || expected.route !== actual.route) return false;
    if (!expected.durableId || expected.durableId !== actual.durableId) return false;
    if (!expected.anchors.length || !actual.anchors.length) return false;
    const current = new Set(actual.anchors);
    return expected.anchors.some((anchor) => current.has(anchor));
  }

  function createCaptureIdentitySampler(expected: PreparedIdentityGuard): () => string | null {
    const stableIdentity = expected.route && expected.durableId ? `${expected.route}|${expected.durableId}` : '';
    return () => {
      if (!stableIdentity) return null;
      const current = sampleIdentityGuard();
      return current.route === expected.route && current.durableId === expected.durableId ? stableIdentity : null;
    };
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function isPromptRunning(): boolean {
    return !!env.document.querySelector('ms-run-button .stoppable-spinner, ms-run-button .stoppable-stop');
  }

  type ManualTurnEntry = {
    turnId: string;
    role: 'user' | 'assistant';
    content: Element;
    withinTurn: number;
    messageKey: string;
  };

  function roleFromMarker(marker: Element): 'user' | 'assistant' | null {
    const value = String(marker.getAttribute?.('data-turn-role') || '').trim();
    if (/^user$/i.test(value)) return 'user';
    if (/model|assistant/i.test(value)) return 'assistant';
    return null;
  }

  function readManualTurnEntries(turn: Element): ManualTurnEntry[] {
    const turnId = String(turn.getAttribute?.('id') || '').trim();
    if (!turnId) return [];
    const entries: ManualTurnEntry[] = [];
    for (const marker of Array.from(turn.querySelectorAll('[data-turn-role]'))) {
      const role = roleFromMarker(marker);
      if (!role) continue;
      const content = marker.matches?.('.turn-content') ? marker : marker.querySelector('.turn-content');
      if (!content) continue;
      const withinTurn = entries.length;
      entries.push({ turnId, role, content, withinTurn, messageKey: `${turnId}:${role}:${withinTurn}` });
    }
    if (entries.length) return entries;
    const role = normalizeRoleFromTurn(turn);
    const content = role ? pickTurnContent(turn, role) : null;
    if (!role || !content) return [];
    return [{ turnId, role, content, withinTurn: 0, messageKey: `${turnId}:${role}:0` }];
  }

  function normalizeTitle(value: any): any {
    const text = value == null ? '' : String(value);
    return env.normalize.normalizeText(text);
  }

  function extractConversationTitle(messages: any[] = []): any {
    const selectors = [
      'ms-playground-toolbar .page-title h1.mode-title',
      'ms-playground-toolbar h1.mode-title',
      '.page-title h1.mode-title',
      "[data-test-id='conversation-title']",
      '.conversation-title-container .conversation-title-column [class*="gds-title"]',
      '.conversation-title-container .conversation-title-column',
    ];
    for (const selector of selectors) {
      const el = env.document.querySelector(selector);
      if (!el) continue;
      const title = normalizeTitle(renderedElementText(el));
      if (title) return title;
    }
    return firstUserMessageTitle(messages) || 'Google AI Studio';
  }

  type InlineImageContext = {
    blobUrlCache: Map<string, string | null>;
    warningFlags: Set<string>;
  };

  type PlainImageReferences = {
    httpUrls: string[];
    blobUrls: string[];
  };

  type PlainExtractionInput = {
    messageKey: string;
    turnKey: string;
    withinTurn: number;
    role: 'user' | 'assistant';
    sequence: number;
    baseMarkdown: string;
    imageReferences: PlainImageReferences;
    updatedAt: number;
  };

  function createInlineImageContext(): InlineImageContext {
    return {
      blobUrlCache: new Map(),
      warningFlags: new Set(),
    };
  }

  function isBlobUrl(url: unknown): boolean {
    const text = String(url || '').trim();
    return /^blob:/i.test(text);
  }

  function pickBlobUrlFromImg(img: any): string {
    if (!img) return '';
    const current = img.currentSrc ? String(img.currentSrc).trim() : '';
    if (isBlobUrl(current)) return current;
    const src = img.src ? String(img.src).trim() : img.getAttribute ? String(img.getAttribute('src') || '').trim() : '';
    if (isBlobUrl(src)) return src;
    const srcset = img.getAttribute ? String(img.getAttribute('srcset') || '').trim() : '';
    if (srcset) {
      const items = srcset
        .split(',')
        .map((value: any) => String(value || '').trim())
        .filter(Boolean);
      for (const item of items) {
        const url = String(item.split(/\s+/)[0] || '').trim();
        if (isBlobUrl(url)) return url;
      }
    }
    return '';
  }

  function extractBlobImageUrlsFromElement(element: ParentNode | null): string[] {
    if (!element || typeof (element as any).querySelectorAll !== 'function') return [];
    const seen = new Set<string>();
    const output: string[] = [];
    for (const image of Array.from((element as any).querySelectorAll('img'))) {
      const url = pickBlobUrlFromImg(image);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      output.push(url);
    }
    return output;
  }

  async function blobToDataUrl(blob: any): Promise<string> {
    const FileReaderCtor: any = (env.window as any)?.FileReader || (globalThis as any).FileReader;
    if (!FileReaderCtor) throw new Error('FileReader not available');
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReaderCtor();
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(blob);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function inlineBlobImageUrl(blobUrl: string, ctx: InlineImageContext): Promise<string | null> {
    if (ctx.blobUrlCache.has(blobUrl)) return ctx.blobUrlCache.get(blobUrl) || null;
    const fail = (warning: string): null => {
      ctx.warningFlags.add(warning);
      ctx.blobUrlCache.set(blobUrl, null);
      return null;
    };

    const fetchFn: any = (env.window as any)?.fetch || (globalThis as any).fetch;
    if (typeof fetchFn !== 'function') return fail('inline_images_fetch_unavailable');

    try {
      const response = await fetchFn(blobUrl);
      if (!response || response.ok === false) return fail('inline_images_fetch_failed');
      const blob = await response.blob();
      const size = Number(blob?.size || 0);
      const type = String(blob?.type || '');
      if (!type || !/^image\//i.test(type)) return fail('inline_images_non_image_blob');
      if (size <= 0) return fail('inline_images_empty_blob');

      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl || !/^data:image\//i.test(dataUrl)) return fail('inline_images_encode_failed');
      ctx.blobUrlCache.set(blobUrl, dataUrl);
      return dataUrl;
    } catch (_error) {
      return fail('inline_images_fetch_failed');
    }
  }

  const TURN_CHROME_SELECTOR =
    'ms-thought-chunk, .thought-panel, img[alt="Thinking"], .thinking-progress-icon, .author-label, .timestamp';

  function cleanTurnContentNode(node: Element): Element {
    const clone = node.cloneNode(true) as Element;
    for (const element of Array.from(clone.querySelectorAll(TURN_CHROME_SELECTOR))) element.remove();
    return clone;
  }

  function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    return values.filter((value) => {
      const normalized = String(value || '').trim();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  function snapshotPlainInput(entry: ManualTurnEntry, sequence: number): PlainExtractionInput | null {
    const { role, content } = entry;
    const cleaned = cleanTurnContentNode(content);
    const baseMarkdown = googleAiStudioMarkdown.extractMarkdown(cleaned);
    const httpUrls = uniqueStrings(extractImageUrlsFromElement(cleaned));
    const blobUrls = uniqueStrings(extractBlobImageUrlsFromElement(cleaned));
    if (!baseMarkdown && !httpUrls.length && !blobUrls.length) return null;
    return {
      messageKey: entry.messageKey,
      turnKey: entry.turnId,
      withinTurn: entry.withinTurn,
      role,
      sequence,
      baseMarkdown,
      imageReferences: { httpUrls, blobUrls },
      updatedAt: Date.now(),
    };
  }

  type ManualEntryRef = { turn: Element; entry: ManualTurnEntry };

  function readCurrentManualEntryRefs(): ManualEntryRef[] {
    const root = getConversationRoot();
    if (!root) return [];
    const output: ManualEntryRef[] = [];
    for (const turn of Array.from(root.querySelectorAll('ms-chat-turn')) as Element[]) {
      for (const entry of readManualTurnEntries(turn)) output.push({ turn, entry });
    }
    return output;
  }

  async function resolveImageReferences(
    references: PlainImageReferences,
    ctx: InlineImageContext,
  ): Promise<{ urls: string[]; incomplete: boolean }> {
    const output = references.httpUrls.slice();
    let incomplete = false;
    for (const blobUrl of references.blobUrls) {
      const dataUrl = await inlineBlobImageUrl(blobUrl, ctx);
      if (dataUrl) output.push(dataUrl);
      else incomplete = true;
    }
    return { urls: uniqueStrings(output), incomplete };
  }

  async function extractMessageFromInput(input: PlainExtractionInput, ctx: InlineImageContext): Promise<any | null> {
    const resolved = await resolveImageReferences(input.imageReferences, ctx);
    if (!input.baseMarkdown && !resolved.urls.length) return null;
    return {
      messageKey: input.messageKey,
      role: input.role,
      contentMarkdown: appendImageMarkdown(input.baseMarkdown, resolved.urls, {
        allowDataImageUrls: true,
      }),
      sequence: input.sequence,
      updatedAt: input.updatedAt,
      ...(resolved.incomplete ? { captureMergePolicy: 'preserve-existing-markdown' } : null),
    };
  }

  type AiStudioDescriptor = {
    key: string;
    turnKey: string;
    withinTurn: number;
    fingerprint: string;
    rendered: boolean;
    streaming: boolean;
    pending: boolean;
  };

  function compactFingerprint(value: string): string {
    const normalized = String(value || '');
    return env.normalize?.fnv1a32 ? String(env.normalize.fnv1a32(normalized)) : normalized;
  }

  function latestStreamingAssistantKey(refs: ManualEntryRef[]): string {
    if (!isPromptRunning()) return '';
    for (let index = refs.length - 1; index >= 0; index -= 1) {
      const entry = refs[index]?.entry;
      if (entry?.role === 'assistant') return entry.messageKey;
    }
    return '';
  }

  function descriptorFromEntry(
    entry: ManualTurnEntry,
    streamingKey = '',
    inViewport: (node: Element) => boolean = () => true,
  ): AiStudioDescriptor {
    const cleaned = cleanTurnContentNode(entry.content);
    const rawText = googleAiStudioMarkdown.extractText(cleaned);
    const rawHtml = String((entry.content as any).innerHTML || '');
    const httpUrls = extractImageUrlsFromElement(cleaned);
    const blobUrls = extractBlobImageUrlsFromElement(cleaned);
    const streaming = entry.role === 'assistant' && entry.messageKey === streamingKey;
    const failed = entry.role === 'assistant' && !!entry.content.querySelector('.model-error');
    const pendingMath = Array.from(entry.content.querySelectorAll('ms-katex')).filter(
      (formula) => !formula.closest(TURN_CHROME_SELECTOR) && !env.normalize.normalizeText(formula.textContent || ''),
    );
    const rendered =
      !streaming && !failed && !pendingMath.length && (!!rawText || !!httpUrls.length || !!blobUrls.length);
    return {
      key: entry.messageKey,
      turnKey: entry.turnId,
      withinTurn: entry.withinTurn,
      fingerprint: compactFingerprint(
        [
          entry.messageKey,
          entry.role,
          String(streaming),
          rawText,
          rawHtml,
          httpUrls.join('|'),
          blobUrls.join('|'),
        ].join('\u001f'),
      ),
      rendered,
      streaming,
      pending:
        !rendered &&
        !failed &&
        (pendingMath.length
          ? pendingMath.some(inViewport)
          : inViewport(entry.content.closest('[data-turn-role]') || entry.content)),
    };
  }

  function readCurrentDescriptors(): AiStudioDescriptor[] {
    const refs = readCurrentManualEntryRefs();
    const streamingKey = latestStreamingAssistantKey(refs);
    const scrollRoot = resolveScrollRoot({ document: env.document, window: env.window }, getConversationRoot());
    const bounds = scrollRoot.getBoundingClientRect();
    const viewportTop = Math.max(0, bounds.top);
    const viewportBottom = bounds.height > 0 ? Math.min(env.window.innerHeight, bounds.bottom) : env.window.innerHeight;
    const inViewport = (node: Element): boolean => {
      const rect = node.getBoundingClientRect();
      return rect.height === 0
        ? rect.top >= viewportTop && rect.top < viewportBottom
        : rect.bottom > viewportTop && rect.top < viewportBottom;
    };
    return refs.map(({ entry }) => descriptorFromEntry(entry, streamingKey, inViewport));
  }

  function mergeObservedSlotOrder(storedKeys: string[], incomingKeys: string[]): { keys: string[]; anchored: boolean } {
    const stored = Array.from(new Set(storedKeys.map((key) => String(key || '').trim()).filter(Boolean)));
    const incoming = Array.from(new Set(incomingKeys.map((key) => String(key || '').trim()).filter(Boolean)));
    if (!stored.length) return { keys: incoming, anchored: true };
    if (!incoming.length) return { keys: stored, anchored: true };

    const storedPositions = new Map(stored.map((key, index) => [key, index]));
    const known = incoming.filter((key) => storedPositions.has(key));
    if (!known.length) {
      return { keys: [...stored, ...incoming.filter((key) => !storedPositions.has(key))], anchored: false };
    }
    const knownPositions = known.map((key) => storedPositions.get(key) as number);
    if (knownPositions.some((position, index) => index > 0 && position <= knownPositions[index - 1])) {
      return { keys: stored, anchored: false };
    }

    const merged = stored.slice();
    const knownSet = new Set(stored);
    let cursor = 0;
    while (cursor < incoming.length) {
      if (knownSet.has(incoming[cursor])) {
        cursor += 1;
        continue;
      }
      const start = cursor;
      while (cursor < incoming.length && !knownSet.has(incoming[cursor])) cursor += 1;
      const unknownRun = incoming.slice(start, cursor);
      const previousKnown = start > 0 ? incoming[start - 1] : '';
      const nextKnown = cursor < incoming.length ? incoming[cursor] : '';
      let insertionIndex = merged.length;
      if (nextKnown) insertionIndex = merged.indexOf(nextKnown);
      else if (previousKnown) {
        const previousIndex = merged.indexOf(previousKnown);
        insertionIndex = previousIndex < 0 ? merged.length : previousIndex + 1;
      }
      merged.splice(insertionIndex, 0, ...unknownRun);
      for (const key of unknownRun) knownSet.add(key);
    }
    return { keys: merged, anchored: true };
  }

  async function harvestManualInto(
    accumulator: PreparedAccumulator<any>,
    ctx: InlineImageContext,
  ): Promise<{ added: number; updated: number }> {
    const existingByKey = new Map(accumulator.records.map((record) => [record.key, record]));
    const refs = readCurrentManualEntryRefs();
    const streamingKey = latestStreamingAssistantKey(refs);
    const candidates = (() => {
      const output: Array<{
        descriptor: AiStudioDescriptor;
        existing?: PreparedMessageRecord<any>;
        input?: PlainExtractionInput;
      }> = [];
      for (const { entry } of refs) {
        const descriptor = descriptorFromEntry(entry, streamingKey);
        if (!descriptor.rendered) {
          output.push({ descriptor });
          continue;
        }
        const existing = existingByKey.get(descriptor.key);
        if (existing && existing.fingerprint === descriptor.fingerprint) {
          output.push({ descriptor, existing });
          continue;
        }
        const input = snapshotPlainInput(entry, output.length);
        if (input) output.push({ descriptor, input });
      }
      return output;
    })();

    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];
    for (const candidate of candidates) {
      const { descriptor, existing, input } = candidate;
      if (existing) {
        records.push({
          key: existing.key,
          turnKey: existing.turnKey,
          withinTurn: existing.withinTurn,
          fingerprint: existing.fingerprint,
          payload: existing.payload,
        });
        continue;
      }
      if (!input) continue;
      const message = await extractMessageFromInput(input, ctx);
      if (!message) continue;
      if (message.captureMergePolicy === 'preserve-existing-markdown') {
        accumulator.completeness = 'partial';
        if (!accumulator.reasons.includes('inline_images_incomplete')) {
          accumulator.reasons.push('inline_images_incomplete');
        }
      }
      records.push({
        key: descriptor.key,
        turnKey: descriptor.turnKey,
        withinTurn: descriptor.withinTurn,
        fingerprint: descriptor.fingerprint,
        payload: message,
      });
    }
    if (!candidates.length && stableTurnAnchors().length) addPreparedReason(accumulator, 'unstable_identity');
    return mergePreparedRecords(accumulator, records);
  }

  async function prepareManualCapture(options: any = {}): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return null;

    const identityGuard = sampleIdentityGuard();
    const conversationKey = identityGuard.durableId && identityGuard.anchors.length ? identityGuard.durableId : '';
    const accumulator = createPreparedAccumulator<any>({
      source: 'googleaistudio',
      conversationKey,
      identityVerified: !!conversationKey,
      identityGuard,
    });
    if (!conversationKey) addPreparedReason(accumulator, 'unstable_identity');
    const ctx = createInlineImageContext();
    const sampleIdentity = createCaptureIdentitySampler(identityGuard);
    const runtime = { document: env.document, window: env.window };
    let observedSlotOrder: string[] = [];
    let slotOrderAnchored = true;
    let windowDescriptors: AiStudioDescriptor[] = [];
    const readTrackedDescriptors = () => {
      const descriptors = readCurrentDescriptors();
      const merged = mergeObservedSlotOrder(
        observedSlotOrder,
        descriptors.map((descriptor) => descriptor.key),
      );
      observedSlotOrder = merged.keys;
      if (!merged.anchored) slotOrderAnchored = false;
      return descriptors;
    };
    const restorer = createScrollRootRestorer({
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
          readDescriptorKeys: () => {
            windowDescriptors = readTrackedDescriptors();
            return windowDescriptors.map((descriptor) => descriptor.key);
          },
          readUnresolvedKeys: () =>
            windowDescriptors.filter((descriptor) => !descriptor.rendered).map((descriptor) => descriptor.key),
          readPendingKeys: () =>
            windowDescriptors.filter((descriptor) => descriptor.pending).map((descriptor) => descriptor.key),
          harvest: (target) => harvestManualInto(target, ctx),
        },
        accumulator,
        {
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
      accumulator.completeness = accumulator.reasons.includes('inline_images_incomplete')
        ? 'partial'
        : sweep.completeness;
    } finally {
      const restored = restorer.restore();
      if (!restored.restored) {
        accumulator.completeness = 'partial';
        addPreparedReason(accumulator, 'restore_failed');
      }
    }

    if (!identityGuardsMatch(accumulator.identityGuard)) {
      accumulator.identityVerified = false;
      accumulator.conversationKey = '';
      accumulator.records = [];
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'identity_changed');
    }
    return {
      ...finishPreparedCapture(accumulator),
      warningFlags: Array.from(ctx.warningFlags),
      aiStudioSlotOrder: observedSlotOrder.slice(),
      aiStudioSlotOrderAnchored: slotOrderAnchored,
    };
  }

  async function capture(options: any = {}): Promise<any> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl() || options?.manual !== true) {
      return null;
    }
    if (inEditMode(getConversationRoot())) return null;
    const ctx = createInlineImageContext();
    const prepared = consumePreparedCapture(options?.preparedCapture);
    if (!prepared || !identityGuardsMatch(prepared.identityGuard)) return null;
    if (prepared.metrics.reachedTop !== true) return null;
    for (const flag of (options.preparedCapture as any)?.warningFlags || []) ctx.warningFlags.add(String(flag));

    let slotOrder: string[] = Array.isArray((options.preparedCapture as any)?.aiStudioSlotOrder)
      ? (options.preparedCapture as any).aiStudioSlotOrder
          .map((key: unknown) => String(key || '').trim())
          .filter(Boolean)
      : [];
    let slotOrderAnchored = (options.preparedCapture as any)?.aiStudioSlotOrderAnchored !== false;
    const currentSlotMerge = mergeObservedSlotOrder(
      slotOrder,
      readCurrentDescriptors().map((descriptor) => descriptor.key),
    );
    slotOrder = currentSlotMerge.keys;
    if (!currentSlotMerge.anchored) slotOrderAnchored = false;
    if (!slotOrderAnchored) return null;

    const accumulator = createPreparedAccumulator<any>({
      source: 'googleaistudio',
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
    const finalLive = await harvestManualInto(accumulator, ctx);
    if (accumulator.completeness === 'complete' && (finalLive.added > 0 || finalLive.updated > 0)) {
      accumulator.completeness = 'partial';
      addPreparedReason(accumulator, 'final_live_changed');
    }
    if (!identityGuardsMatch(accumulator.identityGuard)) return null;

    const finalPrepared = finishPreparedCapture(accumulator);
    const slotIndexByKey = new Map(slotOrder.map((key, index) => [key, index]));
    if (finalPrepared.records.some((record) => !slotIndexByKey.has(record.key))) return null;
    const messages = finalPrepared.records.map((record) => {
      const slotIndex = slotIndexByKey.get(record.key) as number;
      return {
        ...record.payload,
        messageKey: `googleaistudio:${slotIndex}:${record.payload.role}`,
        sequence: slotIndex,
        captureSequencePolicy: 'reconcile-existing-order',
      };
    });
    if (!messages.length || !finalPrepared.identityVerified || !finalPrepared.conversationKey) return null;
    const captureMeta = {
      completeness: finalPrepared.completeness,
      identityVerified: true,
      reasons: finalPrepared.reasons,
      metrics: finalPrepared.metrics,
    };
    return {
      conversation: {
        sourceType: 'chat',
        source: 'googleaistudio',
        conversationKey: finalPrepared.conversationKey,
        title: extractConversationTitle(messages),
        url: env.location.href,
        warningFlags: Array.from(ctx.warningFlags),
      },
      messages,
      captureMeta,
    };
  }

  const collector = {
    capture,
    isCaptureAvailable: isValidConversationUrl,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: {
      isPromptRunning,
      readCurrentDescriptors,
    },
  };

  return { id: 'googleaistudio', matches, collector };
}
