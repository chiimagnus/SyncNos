import { createHash, webcrypto } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { registerInsightHandlers } from '@services/insight/background-handlers';
import {
  createNativeConversationReadRepository,
  type ConversationReadRepository,
} from '@services/conversations/data/storage-native';
import {
  resolveConversationDetailResponse,
  resolveConversationTailWindowResponse,
} from '@services/conversations/client/repo';
import { getInsightFactsSnapshot } from '@services/insight/client';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_DETAIL_PREVIEW_BYTES,
  LocalDataContractError,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';
import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';

const notStarted = {
  mode: 'not_started',
  journal: null,
  factsEpoch: 'idb-v1',
  error: null,
} as const satisfies MigrationJournalSnapshot;

const conversation = {
  id: 8,
  source: 'chatgpt',
  conversationKey: 'thread-8',
  title: 'A thread',
  url: 'https://chatgpt.com/c/thread-8',
  sourceType: 'chat',
  lastCapturedAt: 42,
};

const message = {
  id: 11,
  conversationId: 8,
  messageKey: 'm-11',
  role: 'user',
  contentText: 'hello',
};

const insightSnapshot = {
  articleCount: 0,
  articleDailyCounts: [],
  articleDomainCounts: [],
  articleOtherDomainCount: 0,
  articleUnknownDateCount: 0,
  chatCount: 1,
  chatDailyCounts: [{ day: '2026-08-17', count: 1 }],
  chatOtherSourceCount: 0,
  chatSourceCounts: [{ key: 'chatgpt', count: 1 }],
  chatUnknownDateCount: 0,
  topConversations: [
    { conversationId: 8, source: 'chatgpt', conversationKey: 'thread-8', title: 'A thread', messageCount: 1 },
  ],
  totalMessages: 1,
} as const;

const digestProvider = {
  async sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

async function conversationDetailFrames(bytes: Uint8Array) {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';
  const digest = await OrderedFrameDigestAccumulator.create(digestProvider);
  const data = await createNativeWireDataFrame({
    bytes,
    offset: 0,
    provider: digestProvider,
    sequence: 1,
    sessionId,
  });
  await digest.append({ sequence: data.sequence, byteLength: data.byteLength, digest: data.sliceDigest });
  return [
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 0,
      type: 'begin' as const,
      operation: 'conversation-detail' as const,
      declaredTotalBytes: bytes.byteLength,
    },
    data,
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 2,
      type: 'end' as const,
      digest: digest.finalize(),
    },
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 3,
      type: 'terminal' as const,
      status: 'ok' as const,
    },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native conversation read repository', () => {
  it('maps only typed Host reads and preserves opaque pagination plus stable identity', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    const connectNative = vi.fn(async ({ command, payload }: any) => {
      calls.push({ command, payload });
      switch (command) {
        case 'CONVERSATION_BOOTSTRAP':
          return {
            items: [conversation],
            cursor: 'opaque-page-2',
            factsRevision: 4,
            hasMore: true,
            summary: { totalCount: 2, todayCount: 1 },
            facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 2 }], sites: [] },
          };
        case 'CONVERSATION_LOAD_MORE':
          return {
            items: [],
            cursor: null,
            factsRevision: 4,
            hasMore: false,
            summary: { totalCount: 2, todayCount: 1 },
            facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 2 }], sites: [] },
          };
        case 'CONVERSATION_LOOKUP':
          return conversation;
        case 'CONVERSATION_DETAIL':
          return { conversationId: 8, messages: [message] };
        case 'CONVERSATION_TAIL':
          return { conversationId: 8, messages: [message] };
        case 'GET_INSIGHT_STATS':
          return insightSnapshot;
        case 'SEARCH_CONVERSATIONS':
          return {
            cursor: null,
            factsRevision: 4,
            facets: { sources: [], sites: [] },
            hasMore: false,
            items: [
              {
                backendConversationId: 8,
                source: 'chatgpt',
                conversationKey: 'thread-8',
                sourceType: 'chat',
                title: 'A thread',
                url: 'https://chatgpt.com/c/thread-8',
                siteKey: 'unknown',
                score: null,
                lastCapturedAt: 42,
                snippet: 'hello',
                highlights: [{ start: 0, end: 5 }],
              },
            ],
            truncatedByScanLimit: false,
          };
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const sendNativeMessage = vi.fn(async ({ command }: any) => {
      if (command !== 'GET_FACTS_REVISION') throw new Error(`unexpected single-message command ${command}`);
      return { factsRevision: 4 };
    });
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();

    await gate.runFactsOperation('native-read', async (lease) => {
      const repository = createNativeConversationReadRepository(lease, {
        connectNative,
        sendNativeMessage,
      }) as ConversationReadRepository;
      await expect(repository.getFactsRevision()).resolves.toBe(4);
      const bootstrap = await repository.getConversationListBootstrap({ sourceKey: 'chatgpt', siteKey: 'all' }, 20);
      expect(bootstrap.cursor).toEqual({ nativeCursor: 'opaque-page-2' });
      expect(bootstrap.items).toEqual([conversation]);

      await expect(repository.getConversationListPage({}, bootstrap.cursor!, 20)).resolves.toMatchObject({
        cursor: null,
        hasMore: false,
      });
      await expect(repository.findConversationBySourceAndKey('chatgpt', 'thread-8')).resolves.toMatchObject({
        source: 'chatgpt',
        conversationKey: 'thread-8',
      });
      await expect(
        repository.getConversationDetail({ source: 'chatgpt', conversationKey: 'thread-8' }),
      ).resolves.toEqual({
        conversationId: 8,
        source: 'chatgpt',
        conversationKey: 'thread-8',
        messages: [message],
      });
      await expect(
        repository.getConversationTailWindow({ source: 'chatgpt', conversationKey: 'thread-8' }, 50),
      ).resolves.toEqual({
        conversationId: 8,
        messages: [message],
      });
      await expect(repository.getInsightStats({ timeZone: 'UTC' })).resolves.toMatchObject({
        chatCount: 1,
        totalMessages: 1,
        topConversations: [{ source: 'chatgpt', conversationKey: 'thread-8', messageCount: 1 }],
      });
      await expect(
        repository.searchConversations?.({
          query: { literal: 'hello', scalarCount: 5, mode: 'fts-phrase', ftsPhrase: '"hello"' },
          sort: 'best',
        }),
      ).resolves.toMatchObject({ factsRevision: 4, items: [{ source: 'chatgpt', conversationKey: 'thread-8' }] });
      await expect(repository.searchConversationMentionCandidates({ maxScan: 1 })).resolves.toMatchObject({
        candidates: [expect.objectContaining({ source: 'chatgpt', conversationKey: 'thread-8' })],
      });
    });

    expect(sendNativeMessage).toHaveBeenCalledWith({ command: 'GET_FACTS_REVISION', payload: {} });
    expect(calls.map((call) => call.command)).toEqual([
      'CONVERSATION_BOOTSTRAP',
      'CONVERSATION_LOAD_MORE',
      'CONVERSATION_LOOKUP',
      'CONVERSATION_DETAIL',
      'CONVERSATION_TAIL',
      'GET_INSIGHT_STATS',
      'SEARCH_CONVERSATIONS',
      'CONVERSATION_BOOTSTRAP',
    ]);
    expect(calls).toContainEqual({
      command: 'CONVERSATION_DETAIL',
      payload: { source: 'chatgpt', conversationKey: 'thread-8' },
    });
    expect(calls).toContainEqual({ command: 'GET_INSIGHT_STATS', payload: { timeZone: 'UTC' } });
    expect(calls).toContainEqual({
      command: 'SEARCH_CONVERSATIONS',
      payload: {
        query: { literal: 'hello', scalarCount: 5, mode: 'fts-phrase', ftsPhrase: '"hello"' },
        sort: 'best',
      },
    });
    expect(calls.some((call) => Object.prototype.hasOwnProperty.call(call.payload as object, 'factsEpoch'))).toBe(
      false,
    );
  });

  it('routes compact Insight stats through the browser client and background read runner without a browser numeric-id epoch', async () => {
    const sendMessage = vi.fn(async (_request: any) => ({ ok: true, data: insightSnapshot, error: null }));
    vi.stubGlobal('browser', { runtime: { id: 'hmgjflllphdffeocddjjcfllifhejpok', sendMessage } });

    await expect(getInsightFactsSnapshot({ timeZone: 'UTC' })).resolves.toEqual(insightSnapshot);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'getInsightStats', timeZone: 'UTC' });

    const repository = { getInsightStats: vi.fn(async () => insightSnapshot) };
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerInsightHandlers(router as any, {
      conversationReadRunner: {
        run: async ({ read }: any) => await read({ factsEpoch: 'idb-v1', mode: 'idb', repository }),
      },
    });

    await expect(router.__handleMessageForTests({ type: 'getInsightStats', timeZone: 'UTC' })).resolves.toEqual({
      ok: true,
      data: insightSnapshot,
      error: null,
    });
    expect(repository.getInsightStats).toHaveBeenCalledWith({ timeZone: 'UTC' });
  });

  it('rejects malformed Host pagination before exposing it to the caller', async () => {
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();

    await gate.runFactsOperation('native-read', async (lease) => {
      const repository = createNativeConversationReadRepository(lease, {
        connectNative: async () => ({
          items: [],
          cursor: 'opaque',
          factsRevision: 4,
          hasMore: true,
          summary: { totalCount: 1, todayCount: 0 },
          facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: -1 }], sites: [] },
        }),
      });
      await expect(repository.getConversationListBootstrap()).rejects.toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    });
  });
});

describe('conversation read streaming', () => {
  it('preflights large detail and tail snapshots, then consumes each request id once', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' });
    const handlers = new Map<string, any>();
    const streamRouter = {
      register(operation: string, handler: any) {
        handlers.set(operation, handler);
      },
    };
    const detail = {
      conversationId: 8,
      source: 'chatgpt',
      conversationKey: 'thread-8',
      factsEpoch: 'idb-v1',
      messages: [{ ...message, contentText: 'x'.repeat(256 * 1024) }],
    };
    const repository = {
      getConversationDetail: vi.fn(async () => detail),
      getConversationTailWindow: vi.fn(async () => ({
        conversationId: 8,
        messages: [{ ...message, contentText: 'y'.repeat(256 * 1024) }],
      })),
    };
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerConversationHandlers(router as any, {
      conversationReadRunner: {
        run: async ({ expectedFactsEpoch, read }: any) => {
          if (expectedFactsEpoch !== 'idb-v1') throw new LocalDataContractError('STALE_BACKEND_EPOCH');
          return await read({ factsEpoch: 'idb-v1', mode: 'idb', repository });
        },
      },
      onConversationChanged: async () => {},
      streamRouter,
    });

    const preflight = await router.__handleMessageForTests({
      type: 'getConversationDetail',
      source: 'chatgpt',
      conversationKey: 'thread-8',
      factsEpoch: 'idb-v1',
    });

    expect(preflight).toMatchObject({
      ok: true,
      data: { kind: 'stream', requestId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    expect(preflight.data.stream).toMatchObject({ operation: 'conversation-detail' });
    const download = handlers.get('conversation-detail')?.download as
      | ((input: { requestId: string; send: (bytes: Uint8Array) => Promise<void> }) => Promise<void>)
      | undefined;
    expect(typeof download).toBe('function');

    const sent: Uint8Array[] = [];
    await download!({ requestId: preflight.data.requestId, send: async (bytes) => sent.push(bytes) });
    expect(JSON.parse(new TextDecoder().decode(sent[0]))).toEqual(detail);
    await expect(download!({ requestId: preflight.data.requestId, send: async () => {} })).rejects.toMatchObject({
      code: 'STALE_REFERENCE',
    });

    const tailPreflight = await router.__handleMessageForTests({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: 'thread-8',
      factsEpoch: 'idb-v1',
    });
    expect(tailPreflight).toMatchObject({
      ok: true,
      data: { kind: 'stream', requestId: '550e8400-e29b-41d4-a716-446655440000' },
    });

    const tailSent: Uint8Array[] = [];
    await download!({ requestId: tailPreflight.data.requestId, send: async (bytes) => tailSent.push(bytes) });
    expect(JSON.parse(new TextDecoder().decode(tailSent[0]))).toEqual({
      conversationId: 8,
      source: 'chatgpt',
      conversationKey: 'thread-8',
      factsEpoch: 'idb-v1',
      messages: [{ ...message, contentText: 'y'.repeat(256 * 1024) }],
    });
    await expect(download!({ requestId: tailPreflight.data.requestId, send: async () => {} })).rejects.toMatchObject({
      code: 'STALE_REFERENCE',
    });
  });

  it('rejects an oversized detail declaration in the client before opening a runtime Port', async () => {
    await expect(
      resolveConversationDetailResponse({
        kind: 'stream',
        requestId: 'detail-over-limit',
        stream: { operation: 'conversation-detail', declaredTotalBytes: MAX_DETAIL_PREVIEW_BYTES + 1 },
      } as any),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects an invalid backend epoch in ordinary detail and tail responses', async () => {
    const invalidDetail = {
      conversationId: 8,
      source: 'chatgpt',
      conversationKey: 'thread-8',
      factsEpoch: 'unknown-epoch',
      messages: [message],
    };
    const invalidTail = {
      ...invalidDetail,
      conversationId: 8,
    };

    await expect(resolveConversationDetailResponse(invalidDetail as any)).rejects.toMatchObject({
      code: 'STALE_BACKEND_EPOCH',
    });
    await expect(resolveConversationTailWindowResponse(invalidTail as any)).rejects.toMatchObject({
      code: 'STALE_BACKEND_EPOCH',
    });
  });

  it('validates the stream header and P1 frames before returning the typed detail to the client', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const payload = {
      conversationId: 8,
      source: 'chatgpt',
      conversationKey: 'thread-8',
      factsEpoch: 'idb-v1',
      messages: [message],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const frames = await conversationDetailFrames(bytes);
    const messageListeners = new Set<(message?: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const posted: unknown[] = [];
    let disconnected = false;
    const emit = (value: unknown) => {
      for (const listener of messageListeners) listener(value);
    };
    const port = {
      disconnect() {
        if (disconnected) return;
        disconnected = true;
        for (const listener of disconnectListeners) listener();
      },
      postMessage(value: any) {
        posted.push(value);
        if (value?.type !== 'open') return;
        emit({
          type: 'header',
          requestId: 'detail-stream',
          stream: { operation: 'conversation-detail', declaredTotalBytes: bytes.byteLength },
        });
        for (const frame of frames) emit({ type: 'frame', requestId: 'detail-stream', frame });
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListeners.add(listener);
        },
        removeListener(listener: () => void) {
          disconnectListeners.delete(listener);
        },
      },
      onMessage: {
        addListener(listener: (message?: unknown) => void) {
          messageListeners.add(listener);
        },
        removeListener(listener: (message?: unknown) => void) {
          messageListeners.delete(listener);
        },
      },
    };
    const connect = vi.fn(() => port);
    vi.stubGlobal('chrome', { runtime: { connect } });

    await expect(
      resolveConversationDetailResponse({
        kind: 'stream',
        requestId: 'detail-stream',
        stream: { operation: 'conversation-detail', declaredTotalBytes: bytes.byteLength },
      }),
    ).resolves.toEqual(payload);

    expect(connect).toHaveBeenCalledWith({ name: 'local-data:stream' });
    expect(posted).toContainEqual(expect.objectContaining({ type: 'ack', acknowledgedSequence: 1 }));
    expect(disconnected).toBe(true);
  });
});
