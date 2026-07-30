import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '@collectors/collector-utils.ts';
import geminiMarkdown from '@collectors/gemini/gemini-markdown.ts';
import {
  addPreparedReason,
  createPreparedAccumulator,
  createScrollRootRestorer,
  finishPreparedCapture,
  mergePreparedRecords,
  createPreparedCaptureConsumer,
  runVirtualizedSweep,
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

  function isValidConversationUrl(): any {
    try {
      const p = env.location.pathname || '';
      if (!p || p === '/') return false;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
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

  function messageKeyFromTurn(turn: Element, role: any, contentText: any, sequence: any): any {
    const id = (turn as any).getAttribute ? String((turn as any).getAttribute('id') || '').trim() : '';
    if (id) return `${id}:${role}`;
    return env.normalize.makeFallbackMessageKey({ role, contentText, sequence });
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

  function extractConversationTitle(): any {
    const selectors = [
      "[data-test-id='conversation-title']",
      '.conversation-title-container .conversation-title-column [class*="gds-title"]',
      '.conversation-title-container .conversation-title-column',
    ];
    for (const selector of selectors) {
      const el = env.document.querySelector(selector);
      if (!el) continue;
      const title = normalizeTitle((el as any).textContent || (el as any).innerText || '');
      if (title) return title;
    }
    const pageTitle = normalizeTitle(env.document.title || '');
    return pageTitle || 'Google AI Studio';
  }

  function extractAssistantMarkdown(node: any, fallbackText: any): any {
    if (typeof geminiMarkdown.extractAssistantMarkdown === 'function') {
      const markdown = geminiMarkdown.extractAssistantMarkdown(node);
      if (markdown) return markdown;
    }
    return fallbackText || '';
  }

  function extractAssistantText(node: any): any {
    if (typeof geminiMarkdown.extractAssistantText === 'function') {
      const text = geminiMarkdown.extractAssistantText(node);
      if (text) return text;
    }
    const raw = node ? node.innerText || node.textContent || '' : '';
    return env.normalize.normalizeText(raw);
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
    contentText: string;
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

  function stripThinkingFromNode(node: Element | null): Element | null {
    if (!node || typeof (node as any).cloneNode !== 'function') return node;
    const cloned = (node as any).cloneNode(true) as Element;
    const selectors = ['ms-thought-chunk', '.thought-panel', 'img[alt="Thinking"]', '.thinking-progress-icon'];
    for (const selector of selectors) {
      for (const element of Array.from((cloned as any).querySelectorAll?.(selector) || [])) {
        try {
          (element as any).remove?.();
        } catch (_error) {
          // ignore
        }
      }
    }
    return cloned;
  }

  function stripTurnChromeFromNode(node: Element | null): Element | null {
    if (!node || typeof (node as any).cloneNode !== 'function') return node;
    const cloned = (node as any).cloneNode(true) as Element;
    for (const selector of ['.author-label', '.timestamp']) {
      for (const element of Array.from((cloned as any).querySelectorAll?.(selector) || [])) {
        try {
          (element as any).remove?.();
        } catch (_error) {
          // ignore
        }
      }
    }
    return cloned;
  }

  function cleanTurnContentNode(node: Element | null): Element | null {
    return stripTurnChromeFromNode(stripThinkingFromNode(node));
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

  function snapshotPlainInput(
    turn: Element,
    role: 'user' | 'assistant',
    content: Element,
    sequence: number,
    manualEntry?: ManualTurnEntry,
  ): PlainExtractionInput | null {
    const cleaned = cleanTurnContentNode(content) || content;
    const contentText =
      role === 'assistant'
        ? extractAssistantText(cleaned)
        : env.normalize.normalizeText((cleaned as any).innerText || (cleaned as any).textContent || '');
    const baseMarkdown = role === 'assistant' ? extractAssistantMarkdown(cleaned, contentText) : contentText;
    const httpUrls = uniqueStrings(extractImageUrlsFromElement(cleaned));
    const blobUrls = uniqueStrings(extractBlobImageUrlsFromElement(cleaned));
    if (!contentText && !httpUrls.length && !blobUrls.length) return null;
    return {
      messageKey: manualEntry?.messageKey || messageKeyFromTurn(turn, role, contentText, sequence),
      turnKey: manualEntry?.turnId || String(turn.getAttribute?.('id') || '').trim(),
      withinTurn: manualEntry?.withinTurn || 0,
      role,
      sequence,
      contentText,
      baseMarkdown: baseMarkdown || contentText,
      imageReferences: { httpUrls, blobUrls },
      updatedAt: Date.now(),
    };
  }

  function snapshotNormalInputs(): PlainExtractionInput[] {
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return [];
    const output: PlainExtractionInput[] = [];
    for (const turn of Array.from(root.querySelectorAll('ms-chat-turn')) as Element[]) {
      const role = normalizeRoleFromTurn(turn);
      const content = role ? pickTurnContent(turn, role) : null;
      if (!role || !content) continue;
      const input = snapshotPlainInput(turn, role, content, output.length);
      if (input) output.push(input);
    }
    return output;
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
    if (!input.contentText && !resolved.urls.length) return null;
    return {
      messageKey: input.messageKey,
      role: input.role,
      contentText: input.contentText,
      contentMarkdown: appendImageMarkdown(input.baseMarkdown || input.contentText, resolved.urls, {
        allowDataImageUrls: true,
      }),
      sequence: input.sequence,
      updatedAt: input.updatedAt,
      ...(resolved.incomplete ? { captureMergePolicy: 'preserve-existing-markdown' } : null),
    };
  }

  async function extractMessagesFromInputs(inputs: PlainExtractionInput[], ctx: InlineImageContext): Promise<any[]> {
    const output: any[] = [];
    for (const input of inputs) {
      const message = await extractMessageFromInput({ ...input, sequence: output.length }, ctx);
      if (message) output.push(message);
    }
    return output;
  }

  async function collectMessages(ctx: InlineImageContext): Promise<any[]> {
    return extractMessagesFromInputs(snapshotNormalInputs(), ctx);
  }

  type AiStudioDescriptor = {
    key: string;
    turnKey: string;
    withinTurn: number;
    fingerprint: string;
    rendered: boolean;
  };

  function compactFingerprint(value: string): string {
    const normalized = String(value || '');
    return env.normalize?.fnv1a32 ? String(env.normalize.fnv1a32(normalized)) : normalized;
  }

  function descriptorFromEntry(entry: ManualTurnEntry): AiStudioDescriptor {
    const rawText = env.normalize.normalizeText(
      (entry.content as any).innerText || (entry.content as any).textContent || '',
    );
    const rawHtml = String((entry.content as any).innerHTML || '');
    const httpUrls = extractImageUrlsFromElement(entry.content);
    const blobUrls = extractBlobImageUrlsFromElement(entry.content);
    return {
      key: entry.messageKey,
      turnKey: entry.turnId,
      withinTurn: entry.withinTurn,
      fingerprint: compactFingerprint(
        [entry.messageKey, entry.role, rawText, rawHtml, httpUrls.join('|'), blobUrls.join('|')].join('\u001f'),
      ),
      rendered: !!rawText || !!httpUrls.length || !!blobUrls.length,
    };
  }

  function readCurrentDescriptors(): AiStudioDescriptor[] {
    return readCurrentManualEntryRefs().map(({ entry }) => descriptorFromEntry(entry));
  }

  async function harvestManualInto(
    accumulator: PreparedAccumulator<any>,
    ctx: InlineImageContext,
  ): Promise<{ added: number; updated: number }> {
    const existingByKey = new Map(accumulator.records.map((record) => [record.key, record]));
    const candidates = (() => {
      const output: Array<{
        descriptor: AiStudioDescriptor;
        existing?: PreparedMessageRecord<any>;
        input?: PlainExtractionInput;
      }> = [];
      for (const { turn, entry } of readCurrentManualEntryRefs()) {
        const descriptor = descriptorFromEntry(entry);
        const existing = existingByKey.get(descriptor.key);
        if (existing && existing.fingerprint === descriptor.fingerprint) {
          output.push({ descriptor, existing });
          continue;
        }
        const input = snapshotPlainInput(turn, entry.role, entry.content, output.length, entry);
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
    if (!root) return null;

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
          readDescriptorKeys: () => readCurrentDescriptors().map((descriptor) => descriptor.key),
          readUnresolvedKeys: () =>
            readCurrentDescriptors()
              .filter((descriptor) => !descriptor.rendered)
              .map((descriptor) => descriptor.turnKey),
          harvest: (target) => harvestManualInto(target, ctx),
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
    return { ...finishPreparedCapture(accumulator), warningFlags: Array.from(ctx.warningFlags) };
  }

  async function capture(options: any = {}): Promise<any> {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl() || options?.manual !== true) {
      return null;
    }
    const ctx = createInlineImageContext();
    const prepared = consumePreparedCapture(options?.preparedCapture);
    if (!prepared || !identityGuardsMatch(prepared.identityGuard)) return null;
    for (const flag of (options.preparedCapture as any)?.warningFlags || []) ctx.warningFlags.add(String(flag));

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
    const messages = finalPrepared.records.map((record, index) => ({ ...record.payload, sequence: index }));
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
        title: extractConversationTitle(),
        url: env.location.href,
        warningFlags: Array.from(ctx.warningFlags),
        lastCapturedAt: Date.now(),
      },
      messages,
      captureMeta,
    };
  }

  const collector = {
    capture,
    getRoot: getConversationRoot,
    prepareManualCapture,
    __test: {
      collectMessages: async () => collectMessages(createInlineImageContext()),
      extractAssistantMarkdown,
      extractAssistantText,
    },
  };

  return { id: 'googleaistudio', matches, collector };
}
