import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';

const storageMocks = vi.hoisted(() => ({
  readConversationMentionCandidatePool: vi.fn(),
  getConversationById: vi.fn(),
  getConversationDetail: vi.fn(),
}));

const revisionMocks = vi.hoisted(() => ({
  readDataRevision: vi.fn(),
}));

const externalMarkdownMocks = vi.hoisted(() => ({
  formatConversationMarkdownForExternalOutput: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', () => ({
  readConversationMentionCandidatePool: storageMocks.readConversationMentionCandidatePool,
  getConversationById: storageMocks.getConversationById,
  getConversationDetail: storageMocks.getConversationDetail,
}));

vi.mock('@services/data-revisions/storage-idb', () => ({
  readDataRevision: revisionMocks.readDataRevision,
}));

vi.mock('@services/conversations/external-markdown', () => ({
  formatConversationMarkdownForExternalOutput: externalMarkdownMocks.formatConversationMarkdownForExternalOutput,
}));

function candidate(conversationId: number, title: string, lastCapturedAt = conversationId) {
  return {
    conversationId,
    title,
    source: 'chatgpt',
    url: `https://example.com/${conversationId}`,
    domain: 'example.com',
    sourceType: 'chat',
    lastCapturedAt,
  };
}

function pool(revision: number, candidates = [candidate(1, 'OpenAI')]) {
  return {
    revision,
    candidates,
    scannedCount: candidates.length,
    truncatedByScanLimit: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRouter() {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerItemMentionHandlers(router as any);
  return router;
}

async function search(router: ReturnType<typeof createRouter>, query: string, limit = 20) {
  return router.__handleMessageForTests({
    type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES,
    query,
    limit,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.readConversationMentionCandidatePool.mockReset();
  storageMocks.getConversationById.mockReset();
  storageMocks.getConversationDetail.mockReset();
  revisionMocks.readDataRevision.mockReset();
  externalMarkdownMocks.formatConversationMarkdownForExternalOutput.mockReset();
});

describe('background-router item mention', () => {
  it('keeps empty and whitespace-only queries on the small recent-read path without filling the full cache', async () => {
    storageMocks.readConversationMentionCandidatePool
      .mockResolvedValueOnce(pool(1, [candidate(1, 'Recent')]))
      .mockResolvedValueOnce(pool(1, [candidate(2, 'Whitespace')]))
      .mockResolvedValueOnce(pool(1, [candidate(3, 'OpenAI')]))
      .mockResolvedValueOnce(pool(1, [candidate(4, 'OpenAI cached')]))
      .mockResolvedValueOnce(pool(1, [candidate(5, 'OpenAI cached again')]));
    revisionMocks.readDataRevision.mockResolvedValue(1);
    const router = createRouter();

    const empty = await search(router, '', 3);
    const whitespace = await search(router, ' \n\t ', 4);
    const nonEmpty = await search(router, 'openai', 20);
    const cached = await search(router, 'open', 20);

    expect(empty.ok).toBe(true);
    expect(whitespace.data?.query).toEqual({ raw: ' \n\t ', normalized: '', empty: true });
    expect(nonEmpty.ok).toBe(true);
    expect(cached.ok).toBe(true);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenNthCalledWith(1, {
      maxScan: 3,
      maxDurationMs: 300,
    });
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenNthCalledWith(2, {
      maxScan: 4,
      maxDurationMs: 300,
    });
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenNthCalledWith(3, {
      maxScan: 2000,
      maxDurationMs: 300,
    });
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(3);
    expect(revisionMocks.readDataRevision).toHaveBeenCalledTimes(2);
  });

  it('reuses one full pool for consecutive non-empty queries at the same revision', async () => {
    revisionMocks.readDataRevision.mockResolvedValue(7);
    storageMocks.readConversationMentionCandidatePool.mockResolvedValue(pool(7, [candidate(1, 'OpenAI')]));
    const router = createRouter();

    const first = await search(router, 'open');
    const second = await search(router, 'openai');

    expect(first.data?.candidates?.[0]?.conversationId).toBe(1);
    expect(second.data?.candidates?.[0]?.conversationId).toBe(1);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(1);
    expect(revisionMocks.readDataRevision).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the full pool when conversations revision changes', async () => {
    revisionMocks.readDataRevision.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    storageMocks.readConversationMentionCandidatePool
      .mockResolvedValueOnce(pool(1, [candidate(1, 'OpenAI one')]))
      .mockResolvedValueOnce(pool(2, [candidate(2, 'OpenAI two')]));
    const router = createRouter();

    expect((await search(router, 'openai')).data?.candidates?.[0]?.conversationId).toBe(1);
    expect((await search(router, 'openai')).data?.candidates?.[0]?.conversationId).toBe(2);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight full pool load across concurrent cache misses', async () => {
    revisionMocks.readDataRevision.mockResolvedValue(4);
    const pending = deferred<ReturnType<typeof pool>>();
    storageMocks.readConversationMentionCandidatePool.mockReturnValue(pending.promise);
    const router = createRouter();

    const first = search(router, 'open');
    const second = search(router, 'openai');
    await vi.waitFor(() => expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(1));
    pending.resolve(pool(4, [candidate(4, 'OpenAI')]));

    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(1);
  });

  it('performs one catch-up load when a shared pool revision still disagrees with current revision', async () => {
    revisionMocks.readDataRevision.mockResolvedValueOnce(6).mockResolvedValueOnce(6);
    storageMocks.readConversationMentionCandidatePool
      .mockResolvedValueOnce(pool(5, [candidate(5, 'OpenAI stale')]))
      .mockResolvedValueOnce(pool(6, [candidate(6, 'OpenAI current')]));
    const router = createRouter();

    const res = await search(router, 'openai');

    expect(res.data?.candidates?.[0]?.conversationId).toBe(6);
    expect(revisionMocks.readDataRevision).toHaveBeenCalledTimes(2);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(2);
  });

  it('uses a shared pool directly when its revision matches the second current-revision read', async () => {
    revisionMocks.readDataRevision.mockResolvedValueOnce(5).mockResolvedValueOnce(6);
    storageMocks.readConversationMentionCandidatePool.mockResolvedValue(pool(6, [candidate(6, 'OpenAI current')]));
    const router = createRouter();

    const res = await search(router, 'openai');

    expect(res.data?.candidates?.[0]?.conversationId).toBe(6);
    expect(revisionMocks.readDataRevision).toHaveBeenCalledTimes(2);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(1);
  });

  it('treats revision as an equality token so a DB lifecycle reset can replace a numerically newer cache', async () => {
    revisionMocks.readDataRevision.mockResolvedValueOnce(6).mockResolvedValueOnce(0);
    storageMocks.readConversationMentionCandidatePool
      .mockResolvedValueOnce(pool(6, [candidate(6, 'OpenAI old DB')]))
      .mockResolvedValueOnce(pool(0, [candidate(7, 'OpenAI new DB')]));
    const router = createRouter();

    expect((await search(router, 'openai')).data?.candidates?.[0]?.conversationId).toBe(6);
    expect((await search(router, 'openai')).data?.candidates?.[0]?.conversationId).toBe(7);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(2);
  });

  it('keeps candidate pool cache registration-local', async () => {
    revisionMocks.readDataRevision.mockResolvedValue(3);
    storageMocks.readConversationMentionCandidatePool.mockResolvedValue(pool(3));

    await search(createRouter(), 'openai');
    await search(createRouter(), 'openai');

    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(2);
  });

  it('clears a failed single-flight load so the next request can retry without poisoning cache', async () => {
    revisionMocks.readDataRevision.mockResolvedValue(9);
    storageMocks.readConversationMentionCandidatePool
      .mockRejectedValueOnce(new Error('pool failed'))
      .mockResolvedValueOnce(pool(9, [candidate(9, 'OpenAI recovered')]));
    const router = createRouter();

    const failed = await search(router, 'openai');
    const recovered = await search(router, 'openai');

    expect(failed).toMatchObject({ ok: false, error: { message: 'pool failed' } });
    expect(recovered.data?.candidates?.[0]?.conversationId).toBe(9);
    expect(storageMocks.readConversationMentionCandidatePool).toHaveBeenCalledTimes(2);
  });

  it('builds insert markdown via shared formatter', async () => {
    storageMocks.getConversationById.mockResolvedValue({
      id: 123,
      source: 'chatgpt',
      conversationKey: 'k',
      title: 't',
      url: 'https://chatgpt.com/c/1',
      sourceType: 'chat',
      lastCapturedAt: Date.now(),
    });
    storageMocks.getConversationDetail.mockResolvedValue({
      conversationId: 123,
      messages: [{ id: 1, conversationId: 123, messageKey: 'm1', role: 'user', contentText: 'hi' }],
    });
    externalMarkdownMocks.formatConversationMarkdownForExternalOutput.mockResolvedValue('MARKDOWN');

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 123,
    });

    expect(res.ok).toBe(true);
    expect(res.data?.markdown).toBe('MARKDOWN');
    expect(externalMarkdownMocks.formatConversationMarkdownForExternalOutput).toHaveBeenCalled();
  });

  it('rejects invalid conversationId', async () => {
    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 'bad',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('INVALID_ARGUMENT');
  });

  it('returns not found when conversation missing', async () => {
    storageMocks.getConversationById.mockResolvedValue(null);

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 999,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('NOT_FOUND');
  });

  it('returns empty detail error when messages missing', async () => {
    storageMocks.getConversationById.mockResolvedValue({
      id: 1,
      source: 'chatgpt',
      conversationKey: 'k',
      title: 't',
      url: 'https://chatgpt.com/c/1',
      sourceType: 'chat',
      lastCapturedAt: Date.now(),
    });
    storageMocks.getConversationDetail.mockResolvedValue({ conversationId: 1, messages: [] });

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('EMPTY_DETAIL');
  });
});
