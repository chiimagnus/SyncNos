import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  extractImageUrlsFromElement,
  firstUserMessageTitle,
  renderedElementText,
} from '@collectors/collector-utils.ts';
import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';
import { extractTextFromSanitizedClone, htmlToMarkdown } from '@collectors/shared/markdown-dom.ts';
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
} from '@collectors/virtualized-chat/virtualized-chat-sweep.ts';

const CONVERSATION_ROUTE = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const MESSAGE_SELECTOR = '[data-testid="user-message"], [data-testid="assistant-message"]';
const ROW_SELECTOR = '[data-plane-row^="gateway:"]';

type GrokEntry = {
  key: string;
  role: 'user' | 'assistant';
  content: Element;
  media: Element[];
  fingerprint: string;
  rendered: boolean;
};

export function createGrokCollectorDef(env: CollectorEnv): CollectorDefinition {
  const consumePreparedCapture = createPreparedCaptureConsumer<any>('grok');

  function matches(location: { hostname?: string }): boolean {
    return String(location.hostname || env.location.hostname || '').toLowerCase() === 'grok.com';
  }

  function conversationId(): string {
    return (
      String(env.location.pathname || '')
        .match(CONVERSATION_ROUTE)?.[1]
        ?.toLowerCase() || ''
    );
  }

  function canonicalRoute(): string {
    const id = conversationId();
    return id ? 'https://grok.com/c/' + id : '';
  }

  function transcript(): Element | null {
    return env.document.querySelector('main [data-testid="chat-transcript-scroller"]');
  }

  function messageEntries(): { entries: GrokEntry[]; missingIdentity: boolean } {
    const scroller = transcript();
    if (!scroller) return { entries: [], missingIdentity: false };
    const entries: GrokEntry[] = [];
    const seen = new Set<string>();
    let missingIdentity = false;

    for (const row of Array.from(scroller.querySelectorAll(ROW_SELECTOR))) {
      const container = row.querySelector('[id^="response-"]');
      const key = String(container?.getAttribute('id') || '');
      const bubble = container?.querySelector(MESSAGE_SELECTOR) || null;
      const role = bubble?.getAttribute('data-testid') === 'user-message' ? 'user' : 'assistant';
      const content = bubble?.querySelector('.response-content-markdown');
      if (
        !/^response-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key) ||
        !bubble ||
        !content ||
        seen.has(key) ||
        bubble.querySelector('[contenteditable="true"], textarea')
      ) {
        missingIdentity = true;
        continue;
      }
      seen.add(key);
      const media = Array.from(bubble.querySelectorAll('.inline-media-container'));
      const signature = [role, key, content.innerHTML, ...media.map((element) => element.innerHTML)].join('\u001f');
      const streaming = role === 'assistant' && scroller.getAttribute('aria-busy') === 'true';
      entries.push({
        key,
        role,
        content,
        media,
        fingerprint: String(env.normalize.fnv1a32(signature)),
        rendered:
          !streaming &&
          (!!content.textContent?.trim() ||
            !!content.querySelector('img') ||
            media.some((el) => el.querySelector('img, a'))),
      });
    }
    return { entries, missingIdentity };
  }

  function extractContent(entry: GrokEntry): { text: string; markdown: string } {
    const clone = entry.content.cloneNode(true) as Element;
    replaceMathElementsWithLatexText(clone);
    for (const block of Array.from(clone.querySelectorAll('[data-testid="code-block"]'))) {
      const code = block.querySelector('pre code');
      const pre = block.querySelector('pre');
      const language = String(block.querySelector('span.font-mono')?.textContent || '')
        .trim()
        .toLowerCase();
      if (code && /^[a-z0-9_#+.-]{1,40}$/.test(language)) code.classList.add('language-' + language);
      if (pre) block.replaceWith(pre);
    }
    for (const element of Array.from(
      clone.querySelectorAll('button, svg, script, style, [hidden], [aria-hidden="true"], .no-copy'),
    )) {
      element.remove();
    }
    const text = env.normalize.normalizeText(extractTextFromSanitizedClone(clone));
    const markdown = htmlToMarkdown(clone);
    const images = new Set<string>();
    for (const root of [entry.content, ...entry.media]) {
      for (const url of extractImageUrlsFromElement(root)) images.add(url);
    }
    return { text, markdown: appendImageMarkdown(markdown || text, Array.from(images)) };
  }

  function readIdentity(): PreparedIdentityGuard {
    const anchors = messageEntries().entries.map((entry) => entry.key);
    return {
      route: canonicalRoute(),
      durableId: conversationId(),
      anchors,
      topAnchor: anchors[0] || '',
    };
  }

  function sameConversation(expected: PreparedIdentityGuard): boolean {
    return (
      !!expected.route &&
      expected.route === canonicalRoute() &&
      !!expected.durableId &&
      expected.durableId === conversationId()
    );
  }

  function identitySampler(expected: PreparedIdentityGuard): () => string | null {
    const identity = expected.route + '|durable:' + expected.durableId;
    return () => (sameConversation(expected) ? identity : null);
  }

  function findTitle(messages: any[]): string {
    const route = canonicalRoute();
    if (route) {
      for (const link of Array.from(env.document.querySelectorAll('a[data-sidebar][href]'))) {
        try {
          if (new URL(link.getAttribute('href') || '', env.location.href).href.replace(/\/$/, '') !== route) continue;
          const title = env.normalize.normalizeText(renderedElementText(link)).trim();
          if (title) return title;
        } catch (_error) {
          // Ignore malformed navigation links.
        }
      }
    }
    return firstUserMessageTitle(messages) || 'Grok';
  }

  async function harvest(accumulator: PreparedAccumulator<any>): Promise<{ added: number; updated: number }> {
    const { entries, missingIdentity } = messageEntries();
    if (missingIdentity) addPreparedReason(accumulator, 'unstable_identity');
    const existing = new Map(accumulator.records.map((record) => [record.key, record]));
    const records: Array<Omit<PreparedMessageRecord<any>, 'firstSeenIndex'>> = [];
    for (const [index, entry] of entries.entries()) {
      if (!entry.rendered) {
        addPreparedReason(accumulator, 'unresolved_turn');
        continue;
      }
      const previous = existing.get(entry.key);
      if (previous?.fingerprint === entry.fingerprint) {
        records.push({
          key: previous.key,
          turnKey: previous.turnKey,
          withinTurn: previous.withinTurn,
          fingerprint: previous.fingerprint,
          payload: previous.payload,
        });
        continue;
      }
      const content = extractContent(entry);
      if (!content.markdown) continue;
      records.push({
        key: entry.key,
        turnKey: entry.key,
        withinTurn: 0,
        fingerprint: entry.fingerprint,
        payload: {
          messageKey: entry.key,
          role: entry.role,
          contentText: content.text,
          contentMarkdown: content.markdown,
          sequence: index,
          updatedAt: Date.now(),
        },
      });
    }
    return mergePreparedRecords(accumulator, records);
  }

  async function prepareManualCapture(options: Record<string, any> = {}): Promise<any | null> {
    if (!conversationId() || !transcript()) return null;
    const initial = readIdentity();
    const accumulator = createPreparedAccumulator<any>({
      source: 'grok',
      conversationKey: initial.durableId,
      identityVerified: !!initial.durableId,
      identityGuard: initial,
    });
    const runtime = { document: env.document, window: env.window };
    const sampleIdentity = identitySampler(initial);
    const restorer = createScrollRootRestorer({
      ...runtime,
      getSeed: transcript,
      sampleIdentity,
    });
    try {
      await runVirtualizedSweep(
        runtime,
        {
          getScrollSeed: transcript,
          sampleIdentity,
          readDescriptorKeys: () => messageEntries().entries.map((entry) => entry.key),
          readUnresolvedKeys: () =>
            messageEntries()
              .entries.filter((entry) => !entry.rendered)
              .map((entry) => entry.key),
          // Capture completed replies even if the live tail is still generating.
          readPendingKeys: () => [],
          harvest,
        },
        accumulator,
        options,
      );
    } finally {
      if (!restorer.restore().restored) addPreparedReason(accumulator, 'restore_failed');
    }

    // Grok's plane renderer proves viewport position, not that server-side history is exhausted.
    // A physical top/bottom must not authorize replacing previously saved messages.
    accumulator.completeness = 'partial';
    addPreparedReason(accumulator, 'top_not_reached');
    if (!sameConversation(initial)) {
      accumulator.identityVerified = false;
      accumulator.conversationKey = '';
      accumulator.records = [];
      addPreparedReason(accumulator, 'identity_changed');
    }
    return finishPreparedCapture(accumulator);
  }

  async function capture(options: { manual?: boolean; preparedCapture?: unknown } = {}): Promise<any | null> {
    if (!options.manual || !conversationId()) return null;
    const prepared = consumePreparedCapture(options.preparedCapture);
    if (!prepared || !sameConversation(prepared.identityGuard)) return null;
    const accumulator = createPreparedAccumulator<any>({
      source: 'grok',
      conversationKey: prepared.conversationKey,
      identityVerified: prepared.identityVerified,
      identityGuard: prepared.identityGuard,
    });
    accumulator.reasons.push(...prepared.reasons);
    accumulator.sweepMetrics = { ...prepared.metrics };
    accumulator.completeness = 'partial';
    mergePreparedRecords(
      accumulator,
      prepared.records.map(({ firstSeenIndex: _index, ...record }) => record),
    );
    await harvest(accumulator);
    if (!sameConversation(prepared.identityGuard)) return null;
    const messages = finishPreparedCapture(accumulator).records.map((record, index) => ({
      ...record.payload,
      sequence: index,
    }));
    if (!messages.length || !accumulator.identityVerified || !accumulator.conversationKey) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'grok',
        conversationKey: accumulator.conversationKey,
        title: findTitle(messages),
        url: canonicalRoute(),
        warningFlags: [],
      },
      messages,
      captureMeta: {
        completeness: 'partial',
        identityVerified: true,
        reasons: accumulator.reasons,
        metrics: accumulator.sweepMetrics,
      },
    };
  }

  return {
    id: 'grok',
    matches,
    collector: {
      capture,
      isCaptureAvailable: () => !!conversationId(),
      prepareManualCapture,
      getRoot: transcript,
    },
  };
}
