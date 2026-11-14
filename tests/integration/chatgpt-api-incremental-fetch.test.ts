import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBIndex, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests } from '@platform/idb/schema';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture';
import {
  getConversationBySourceConversationKey,
  getConversationTailWindowBySourceAndKey,
  getConversationMessagesByKeys,
  getMessagesByConversationId,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage-idb';
import { readDataRevision } from '@services/data-revisions/storage-idb';

const api = vi.hoisted(() => ({ requestPage: vi.fn() }));
vi.mock('@services/integrations/chatgpt/api-capture-settings', () => ({
  readChatgptApiCaptureEnabled: vi.fn(async () => true),
}));
vi.mock('@services/integrations/chatgpt/api-capture', async (importOriginal) => {
  const original = await importOriginal<typeof import('@services/integrations/chatgpt/api-capture')>();
  return {
    ...original,
    captureCurrentChatgptConversationViaApi: (options: any) =>
      original.captureCurrentChatgptConversationViaApi({ ...options, requestPage: api.requestPage }),
  };
});

const conversationKey = 'advanced-incremental-integration';
type Node = {
  id: string;
  author: { role: string };
  recipient: string;
  channel?: string;
  status: string;
  content: { content_type: string; parts: string[] };
  metadata: { parent_id?: string };
};
const node = (id: string, role: 'user' | 'assistant', content: string, parent?: string): Node => ({
  id,
  author: { role },
  recipient: 'all',
  ...(role === 'assistant' ? { channel: 'final' } : null),
  status: 'finished_successfully',
  content: { content_type: 'text', parts: [content] },
  metadata: parent ? { parent_id: parent } : {},
});
const initial = [
  node('u1', 'user', 'first'),
  node('a1', 'assistant', 'first answer', 'u1'),
  node('u2', 'user', 'second', 'a1'),
  node('a2', 'assistant', 'second answer', 'u2'),
];

async function deleteDb() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('webclipper');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  closeDbForTests();
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb();
  vi.stubGlobal('location', { href: `https://chatgpt.com/c/${conversationKey}` });
  vi.stubGlobal('chrome', {
    runtime: { lastError: null },
    storage: { local: { get: (_keys: string[], callback: (values: object) => void) => callback({}) } },
  });
  api.requestPage.mockReset();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  closeDbForTests();
  await deleteDb();
});

describe('ChatGPT Advanced end-to-end incremental fetch', () => {
  it('keeps one canonical current branch across full, incremental, repeated and regenerated Fetch', async () => {
    const notifications: number[] = [];
    let injectRevisionConflict = false;
    let conflictConversationId = 0;
    const router = createBackgroundRouter({
      fallback: (message: any) => ({ ok: false, error: { message: `unknown: ${message.type}` } }),
    });
    registerConversationHandlers(router as any, {
      onConversationChanged: async (id) => {
        notifications.push(id);
      },
      onRemoteCleanupPending: async () => {},
      scheduleImageBackfill: async () => {},
    });
    const capture = createCurrentPageCaptureService({
      runtime: {
        send: async (type, payload) => {
          if (type === 'syncConversationMessages' && payload?.verifiedChatgptApiTail && injectRevisionConflict) {
            injectRevisionConflict = false;
            await syncConversationMessages(
              conflictConversationId,
              [{ messageKey: 'concurrent', role: 'user', contentMarkdown: 'unrelated edit', sequence: 0 }],
              { mode: 'snapshot' },
            );
          }
          return router.dispatch({ type, ...payload });
        },
      },
      collectorsRegistry: {
        pickActive: () => ({
          id: 'chatgpt',
          collector: { isCaptureAvailable: () => true },
        }),
        list: () => [],
      },
      videoCapture: { captureVideoTranscript: vi.fn() as any },
    });

    let activeNodes: Node[] = initial;
    let olderNodes: Node[] | null = null;
    let hasPrevious = false;
    let nonHeadPages = 0;
    api.requestPage.mockImplementation(async (request: { before?: string; numTurns: number }) => {
      if (request.numTurns === 1)
        return {
          conversation_id: conversationKey,
          current_node: activeNodes.at(-1)!.id,
          messages: [activeNodes.at(-1)],
        };
      nonHeadPages += 1;
      if (request.before) {
        if (!olderNodes) throw new Error('older page unexpectedly requested');
        return {
          conversation_id: conversationKey,
          messages: olderNodes,
          page_info: {
            start_cursor: olderNodes[0]!.id,
            end_cursor: olderNodes.at(-1)!.id,
            has_previous_page: false,
          },
        };
      }
      return {
        conversation_id: conversationKey,
        current_node: activeNodes.at(-1)!.id,
        title: 'Test conversation',
        messages: activeNodes,
        page_info: {
          start_cursor: activeNodes[0]!.id,
          end_cursor: activeNodes.at(-1)!.id,
          has_previous_page: hasPrevious,
        },
      };
    });

    await capture.captureCurrentPage();
    const conversation = await getConversationBySourceConversationKey('chatgpt', conversationKey);
    const id = Number(conversation?.id);
    expect(id).toBeGreaterThan(0);
    expect(conversation?.chatgptApiCheckpoint?.lastUserKey).toBe('u2');
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual(['u1', 'a1', 'u2', 'a2']);

    activeNodes = [
      ...initial.slice(2),
      node('u3', 'user', 'third', 'a2'),
      node('a3', 'assistant', 'third answer', 'u3'),
    ];
    hasPrevious = true;
    const beforeNext = nonHeadPages;
    const beforeHeadChecks = api.requestPage.mock.calls.filter(([request]) => request.numTurns === 1).length;
    await capture.captureCurrentPage();
    expect(nonHeadPages - beforeNext).toBe(1);
    expect(api.requestPage.mock.calls.filter(([request]) => request.numTurns === 1)).toHaveLength(beforeHeadChecks + 1);
    expect(api.requestPage.mock.calls.slice(-2).map(([request]) => request.numTurns)).toEqual([10, 1]);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3',
      'a3',
    ]);
    const originalRevision = await readDataRevision('messages');
    const originalActivity = (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.lastActivityAt;
    const originalNotifications = notifications.length;
    await capture.captureCurrentPage();
    expect(await readDataRevision('messages')).toBe(originalRevision);
    expect((await getConversationBySourceConversationKey('chatgpt', conversationKey))?.lastActivityAt).toBe(
      originalActivity,
    );
    expect(notifications).toHaveLength(originalNotifications);

    // A changed remote HEAD after the initial page must stop before any IndexedDB mutation.
    const beforeRemoteChange = await getMessagesByConversationId(id);
    const beforeRemoteRevision = await readDataRevision('messages');
    const stableNodes = activeNodes;
    api.requestPage.mockImplementationOnce(async (request: { numTurns: number }) => {
      expect(request.numTurns).toBe(10);
      const captured = activeNodes;
      activeNodes = [...captured.slice(0, -1), node('a3-replaced', 'assistant', 'changed remotely', 'u3')];
      return {
        conversation_id: conversationKey,
        current_node: captured.at(-1)!.id,
        title: 'Test conversation',
        messages: captured,
        page_info: {
          start_cursor: captured[0]!.id,
          end_cursor: captured.at(-1)!.id,
          has_previous_page: true,
        },
      };
    });
    await expect(capture.captureCurrentPage()).rejects.toMatchObject({
      code: 'chatgpt_api_conversation_changed',
    });
    expect(await getMessagesByConversationId(id)).toEqual(beforeRemoteChange);
    expect(await readDataRevision('messages')).toBe(beforeRemoteRevision);
    activeNodes = stableNodes;

    activeNodes = [...activeNodes.slice(0, -1), node('a4', 'assistant', 'regenerated answer', 'u3')];
    await capture.captureCurrentPage();
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3',
      'a4',
    ]);
    expect((await getMessagesByConversationId(id)).at(-1)?.contentMarkdown).toBe('regenerated answer');
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u3');

    activeNodes = [
      node('u3-edited', 'user', 'changed third question', 'a2'),
      node('a5', 'assistant', 'answer to edited question', 'u3-edited'),
    ];
    olderNodes = initial;
    const beforeEdit = nonHeadPages;
    await capture.captureCurrentPage();
    expect(nonHeadPages - beforeEdit).toBe(2);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a5',
    ]);
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u3-edited');

    olderNodes = null;
    activeNodes = [
      activeNodes[0]!,
      { ...node('a6', 'assistant', 'streaming answer', 'u3-edited'), status: 'in_progress' },
    ];
    await capture.captureCurrentPage();
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a5',
      'a6',
    ]);
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u3-edited');

    activeNodes = [activeNodes[0]!, node('a6', 'assistant', 'completed regenerated answer', 'u3-edited')];
    const beforeFinish = nonHeadPages;
    await capture.captureCurrentPage();
    expect(nonHeadPages - beforeFinish).toBe(1);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a6',
    ]);
    expect((await getMessagesByConversationId(id)).at(-1)?.contentMarkdown).toBe('completed regenerated answer');

    const concurrent = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'revision-from-another-tab',
    });
    conflictConversationId = Number(concurrent.id);
    olderNodes = initial;
    injectRevisionConflict = true;
    const beforeConflict = nonHeadPages;
    await capture.captureCurrentPage();
    expect(injectRevisionConflict).toBe(false);
    expect(nonHeadPages - beforeConflict).toBe(3);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a6',
    ]);
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u3-edited');

    // Real tool-heavy API pages may lack the parent links needed to traverse from the latest assistant.
    // The saved assistant overlap still provides a bounded boundary before the newly appended user.
    olderNodes = null;
    activeNodes = [
      node('u3-edited', 'user', 'changed third question', 'a2'),
      node('a6', 'assistant', 'completed regenerated answer'),
      node('u4', 'user', 'fresh follow-up'),
      node('a7', 'assistant', 'fresh answer'),
    ];
    const beforeMissingParents = nonHeadPages;
    await capture.captureCurrentPage();
    expect(nonHeadPages - beforeMissingParents).toBe(1);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a6',
      'u4',
      'a7',
    ]);
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u4');

    const preStreamingTail = await getConversationTailWindowBySourceAndKey('chatgpt', conversationKey, 200, {
      withRevision: true,
    });
    expect(preStreamingTail.conversation?.chatgptApiCheckpoint?.lastUserKey).toBe('u4');
    expect(preStreamingTail.messages.at(-1)?.messageKey).toBe('a7');
    expect(preStreamingTail.messages.map((item) => item.sequence)).toEqual(
      Array.from({ length: 8 }, (_, index) => index),
    );
    activeNodes = [
      node('u4', 'user', 'fresh follow-up'),
      node('a7', 'assistant', 'fresh answer'),
      node('u5', 'user', 'prompt while generating', 'a7'),
      { ...node('a8', 'assistant', 'unfinished response', 'u5'), status: 'in_progress' },
    ];
    const beforeStreaming = nonHeadPages;
    await capture.captureCurrentPage();
    expect(nonHeadPages - beforeStreaming).toBe(1);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a6',
      'u4',
      'a7',
      'u5',
      'a8',
    ]);
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u4');

    activeNodes[3] = node('a8', 'assistant', 'finished response', 'u5');
    const beforeStreamingFinished = nonHeadPages;
    await capture.captureCurrentPage();
    expect(nonHeadPages - beforeStreamingFinished).toBe(1);
    expect((await getMessagesByConversationId(id)).map((item) => item.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3-edited',
      'a6',
      'u4',
      'a7',
      'u5',
      'a8',
    ]);
    expect((await getMessagesByConversationId(id)).at(-1)?.contentMarkdown).toBe('finished response');
    expect(
      (await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint?.lastUserKey,
    ).toBe('u5');

    const savedBeforeApiErrors = await getMessagesByConversationId(id);
    const savedRevision = await readDataRevision('messages');
    const savedConversation = await getConversationBySourceConversationKey('chatgpt', conversationKey);
    for (const status of [401, 403, 429, 503]) {
      const error = Object.assign(new Error('chatgpt_api_page_http'), {
        code: 'chatgpt_api_page_http',
        status,
      });
      api.requestPage.mockRejectedValueOnce(error);
      if (status === 503) api.requestPage.mockRejectedValueOnce(error);
      const beforeCalls = api.requestPage.mock.calls.length;
      await expect(capture.captureCurrentPage()).rejects.toThrow();
      expect(api.requestPage.mock.calls.length - beforeCalls).toBe(status === 503 ? 2 : 1);
      expect(await getMessagesByConversationId(id)).toEqual(savedBeforeApiErrors);
      expect(await readDataRevision('messages')).toBe(savedRevision);
      expect((await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint).toEqual(
        savedConversation?.chatgptApiCheckpoint,
      );
      expect((await getConversationBySourceConversationKey('chatgpt', conversationKey))?.lastActivityAt).toBe(
        savedConversation?.lastActivityAt,
      );
    }
  });

  it('does not let a stale completed full capture erase a concurrent newer local snapshot', async () => {
    const router = createBackgroundRouter({
      fallback: (message: any) => ({ ok: false, error: { message: `unknown: ${message.type}` } }),
    });
    registerConversationHandlers(router as any, {
      onConversationChanged: async () => {},
      onRemoteCleanupPending: async () => {},
      scheduleImageBackfill: async () => {},
    });
    let injected = false;
    let concurrentConversationId = 0;
    const capture = createCurrentPageCaptureService({
      runtime: {
        send: async (type, payload) => {
          if (!injected && type === 'syncConversationMessages' && payload?.mode === 'snapshot') {
            injected = true;
            concurrentConversationId = Number(payload.conversationId);
            await syncConversationMessages(
              concurrentConversationId,
              [
                ...initial.map((item, index) => ({
                  messageKey: item.id,
                  role: item.author.role,
                  contentMarkdown: item.content.parts.join('\n'),
                  sequence: index,
                })),
                { messageKey: 'u-concurrent', role: 'user', contentMarkdown: 'newer from another tab', sequence: 4 },
              ],
              { mode: 'snapshot' },
            );
          }
          return router.dispatch({ type, ...payload });
        },
      },
      collectorsRegistry: {
        pickActive: () => ({ id: 'chatgpt', collector: { isCaptureAvailable: () => true } }),
        list: () => [],
      },
      videoCapture: { captureVideoTranscript: vi.fn() as any },
    });
    api.requestPage.mockImplementation(async ({ numTurns }: { numTurns: number }) => ({
      conversation_id: conversationKey,
      current_node: initial.at(-1)!.id,
      messages: numTurns === 1 ? initial.slice(-1) : initial,
      ...(numTurns === 1
        ? null
        : {
            title: 'A saved conversation',
            page_info: {
              start_cursor: initial[0]!.id,
              end_cursor: initial.at(-1)!.id,
              has_previous_page: false,
            },
          }),
    }));

    await expect(capture.captureCurrentPage()).rejects.toMatchObject({
      code: 'chatgpt_api_storage_conflict',
      message: expect.stringMatching(/another tab|其他标签页/i),
    });
    expect(injected).toBe(true);
    expect((await getMessagesByConversationId(concurrentConversationId)).map((message) => message.messageKey)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u-concurrent',
    ]);
  });

  it('rejects an unresolved sibling branch without persisting its abandoned messages', async () => {
    const router = createBackgroundRouter({
      fallback: (message: any) => ({ ok: false, error: { message: `unknown: ${message.type}` } }),
    });
    registerConversationHandlers(router as any, {
      onConversationChanged: async () => {},
      onRemoteCleanupPending: async () => {},
      scheduleImageBackfill: async () => {},
    });
    const capture = createCurrentPageCaptureService({
      runtime: { send: async (type, payload) => router.dispatch({ type, ...payload }) },
      collectorsRegistry: {
        pickActive: () => ({ id: 'chatgpt', collector: { isCaptureAvailable: () => true } }),
        list: () => [],
      },
      videoCapture: { captureVideoTranscript: vi.fn() as any },
    });
    let activeNodes: Node[] = initial;
    api.requestPage.mockImplementation(async ({ numTurns }: { numTurns: number }) => ({
      conversation_id: conversationKey,
      current_node: activeNodes.at(-1)!.id,
      messages: numTurns === 1 ? activeNodes.slice(-1) : activeNodes,
      ...(numTurns === 1
        ? null
        : {
            title: 'A saved conversation',
            page_info: {
              start_cursor: activeNodes[0]!.id,
              end_cursor: activeNodes.at(-1)!.id,
              has_previous_page: false,
            },
          }),
    }));
    await capture.captureCurrentPage();
    const stored = await getConversationBySourceConversationKey('chatgpt', conversationKey);
    const conversationId = Number(stored?.id);
    const previousMessages = await getMessagesByConversationId(conversationId);
    const previousRevision = await readDataRevision('messages');
    activeNodes = [
      node('u2', 'user', 'second', 'a1'),
      node('abandoned-sibling', 'assistant', 'obsolete reply', 'u2'),
      node('u3', 'user', 'new question', 'u2'),
      node('active-sibling', 'assistant', 'current reply', 'unknown-parent'),
    ];
    await expect(capture.captureCurrentPage()).rejects.toMatchObject({
      code: 'chatgpt_api_branch_ambiguous',
      message: expect.stringMatching(/branch|分支/i),
    });
    expect(await getMessagesByConversationId(conversationId)).toEqual(previousMessages);
    expect(await readDataRevision('messages')).toBe(previousRevision);
    expect((await getConversationBySourceConversationKey('chatgpt', conversationKey))?.chatgptApiCheckpoint).toEqual(
      stored?.chatgptApiCheckpoint,
    );
  });

  it('updates an actual 10000-message IndexedDB history without loading the old message list', async () => {
    const conversation = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey,
      title: 'Long saved history',
    });
    const conversationId = Number(conversation.id);
    const firstTenThousand = Array.from({ length: 10_000 }, (_, i) => ({
      messageKey: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      contentMarkdown: `message-${i}`,
      sequence: i,
      updatedAt: i + 1,
    }));
    const encoded = new TextEncoder().encode(JSON.stringify(['message-9998', ['text', ['message-9998']], 'm9997', []]));
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    const signature = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    await syncConversationMessages(conversationId, firstTenThousand, {
      mode: 'snapshot',
      checkpoint: { lastUserKey: 'm9998', userSignature: signature, includeThinking: true },
    });
    const beforeRevision = await readDataRevision('messages');
    const latest = [
      node('m9998', 'user', 'message-9998', 'm9997'),
      node('m9999', 'assistant', 'message-9999', 'm9998'),
      node('m10000', 'user', 'message-10000', 'm9999'),
      node('m10001', 'assistant', 'message-10001', 'm10000'),
    ];
    const pageRequests: Array<{ numTurns: number; before?: string }> = [];
    api.requestPage.mockImplementation(async (request: { numTurns: number; before?: string }) => {
      pageRequests.push(request);
      if (request.before) throw new Error('old history must not be requested');
      if (request.numTurns === 1)
        return {
          conversation_id: conversationKey,
          current_node: latest.at(-1)!.id,
          messages: [latest.at(-1)],
        };
      return {
        conversation_id: conversationKey,
        current_node: latest.at(-1)!.id,
        title: 'Long saved history',
        messages: latest,
        page_info: { start_cursor: latest[0]!.id, end_cursor: latest.at(-1)!.id, has_previous_page: true },
      };
    });
    const router = createBackgroundRouter({
      fallback: (message: any) => ({ ok: false, error: { message: `unknown: ${message.type}` } }),
    });
    registerConversationHandlers(router as any, {
      onConversationChanged: async () => {},
      onRemoteCleanupPending: async () => {},
      scheduleImageBackfill: async () => {},
    });
    const capture = createCurrentPageCaptureService({
      runtime: { send: async (type, payload) => router.dispatch({ type, ...payload }) },
      collectorsRegistry: {
        pickActive: () => ({ id: 'chatgpt', collector: { isCaptureAvailable: () => true } }),
        list: () => [],
      },
      videoCapture: { captureVideoTranscript: vi.fn() as any },
    });
    const getAllSpy = vi.spyOn(IDBIndex.prototype, 'getAll');
    try {
      await capture.captureCurrentPage();
      expect(pageRequests.map((req) => req.numTurns)).toEqual([10, 1]);
      expect(
        getAllSpy.mock.instances.filter((instance) => instance.name === 'by_conversationId_sequence'),
      ).toHaveLength(0);
    } finally {
      getAllSpy.mockRestore();
    }
    expect(await readDataRevision('messages')).toBeGreaterThan(beforeRevision);
    const tail = await getConversationTailWindowBySourceAndKey('chatgpt', conversationKey, 4);
    expect(tail.messages.map((message) => message.messageKey)).toEqual(['m9998', 'm9999', 'm10000', 'm10001']);
    expect(
      (await getConversationMessagesByKeys(conversationId, ['m0', 'm5000'])).map((item) => item.messageKey),
    ).toEqual(['m0', 'm5000']);
  }, 60_000);
});
