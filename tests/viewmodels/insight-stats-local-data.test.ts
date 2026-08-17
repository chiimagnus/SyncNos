import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { createConversationReadRunner } from '@services/conversations/data/storage';
import { registerInsightHandlers } from '@services/insight/background-handlers';
import { getInsightFactsSnapshot } from '@services/insight/client';
import { LocalDataContractError } from '@services/local-data/contracts';
import { FactsBackend } from '@services/local-data/facts-backend';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { buildInsightStatsFromFactsSnapshot } from '@viewmodels/settings/insight-stats';

const active = {
  mode: 'active',
  factsEpoch: 'native:550e8400-e29b-41d4-a716-446655440000',
  error: null,
  journal: { stage: 'active' },
} as unknown as MigrationJournalSnapshot;

const transitional = {
  mode: 'transitional',
  factsEpoch: null,
  error: null,
  journal: { stage: 'copying' },
} as unknown as MigrationJournalSnapshot;

const insightSnapshot = {
  articleCount: 1,
  articleDailyCounts: [{ day: '2026-08-17', count: 1 }],
  articleDomainCounts: [{ key: 'example.com', count: 1 }],
  articleOtherDomainCount: 0,
  articleUnknownDateCount: 0,
  chatCount: 1,
  chatDailyCounts: [{ day: '2026-08-17', count: 1 }],
  chatOtherSourceCount: 0,
  chatSourceCounts: [{ key: 'chatgpt', count: 1 }],
  chatUnknownDateCount: 0,
  topConversations: [
    {
      conversationId: 8,
      source: 'chatgpt',
      conversationKey: 'thread-8',
      title: 'A thread',
      messageCount: 3,
    },
  ],
  totalMessages: 3,
} as const;

function activeInsightRunner(
  input: Readonly<{ idbRead: ReturnType<typeof vi.fn>; nativeRead: ReturnType<typeof vi.fn> }>,
) {
  const gate = new FactsOperationGate({ readJournal: async () => active });
  const backend = new FactsBackend<any>({
    readJournal: async () => active,
    createIdbRepository: input.idbRead,
    createNativeRepository: input.nativeRead,
  });
  return {
    gate,
    runner: createConversationReadRunner(
      gate,
      async (lease, expectedFactsEpoch) => (await backend.open(lease, expectedFactsEpoch)) as any,
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Insight local-data aggregate boundary', () => {
  it('routes active About You reads through the Native repository and never touches IDB facts', async () => {
    const idbRead = vi.fn(() => {
      throw new Error('IDB must not be opened in active mode');
    });
    const getInsightStats = vi.fn(async () => insightSnapshot);
    const nativeRead = vi.fn(() => ({ getInsightStats }));
    const { gate, runner } = activeInsightRunner({ idbRead, nativeRead });
    await gate.initializeFromJournal();

    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerInsightHandlers(router as any, { conversationReadRunner: runner });

    await expect(router.__handleMessageForTests({ type: 'getInsightStats', timeZone: 'UTC' })).resolves.toEqual({
      ok: true,
      data: insightSnapshot,
      error: null,
    });
    expect(nativeRead).toHaveBeenCalledOnce();
    expect(idbRead).not.toHaveBeenCalled();
    expect(getInsightStats).toHaveBeenCalledWith({ timeZone: 'UTC' });
  });

  it('surfaces an active Host failure as recoverable and never falls back to IDB', async () => {
    const idbRead = vi.fn(() => {
      throw new Error('IDB fallback is forbidden');
    });
    const nativeRead = vi.fn(() => ({
      getInsightStats: vi.fn(async () => {
        throw new LocalDataContractError('HOST_UNAVAILABLE');
      }),
    }));
    const { gate, runner } = activeInsightRunner({ idbRead, nativeRead });
    await gate.initializeFromJournal();
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerInsightHandlers(router as any, { conversationReadRunner: runner });

    await expect(router.__handleMessageForTests({ type: 'getInsightStats', timeZone: 'UTC' })).resolves.toMatchObject({
      ok: false,
      error: { extra: { code: 'HOST_UNAVAILABLE' } },
    });
    expect(nativeRead).toHaveBeenCalledOnce();
    expect(idbRead).not.toHaveBeenCalled();
  });

  it('returns a recoverable transitional error without falling back to either facts repository', async () => {
    const createIdbRepository = vi.fn(() => ({ getInsightStats: vi.fn(async () => insightSnapshot) }));
    const createNativeRepository = vi.fn(() => ({ getInsightStats: vi.fn(async () => insightSnapshot) }));
    const gate = new FactsOperationGate({ readJournal: async () => transitional });
    await gate.initializeFromJournal();
    const backend = new FactsBackend<any>({
      readJournal: async () => transitional,
      createIdbRepository,
      createNativeRepository,
    });
    const runner = createConversationReadRunner(
      gate,
      async (lease, expectedFactsEpoch) => (await backend.open(lease, expectedFactsEpoch)) as any,
    );
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerInsightHandlers(router as any, { conversationReadRunner: runner });

    const response = await router.__handleMessageForTests({ type: 'getInsightStats', timeZone: 'UTC' });
    expect(response).toMatchObject({
      ok: false,
      error: { extra: { code: 'MIGRATION_IN_PROGRESS' } },
    });
    expect(createIdbRepository).not.toHaveBeenCalled();
    expect(createNativeRepository).not.toHaveBeenCalled();
  });

  it('rehydrates typed background errors in the browser client instead of hiding them behind fallback reads', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: false,
      data: null,
      error: { message: 'Local data host is unavailable.', extra: { code: 'HOST_UNAVAILABLE' } },
    }));
    vi.stubGlobal('browser', {
      runtime: {
        id: 'hmgjflllphdffeocddjjcfllifhejpok',
        sendMessage,
      },
    });

    await expect(getInsightFactsSnapshot({ timeZone: 'UTC' })).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('keeps the browser client aggregate-only and preserves the pure stats fixture', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: insightSnapshot, error: null }));
    vi.stubGlobal('browser', {
      runtime: {
        id: 'hmgjflllphdffeocddjjcfllifhejpok',
        sendMessage,
      },
    });

    const snapshot = await getInsightFactsSnapshot({ timeZone: 'UTC' });
    expect(snapshot).toEqual(insightSnapshot);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'getInsightStats', timeZone: 'UTC' });
    expect(JSON.stringify(snapshot)).not.toContain('contentMarkdown');
    expect(JSON.stringify(snapshot)).not.toContain('image');

    expect(buildInsightStatsFromFactsSnapshot(snapshot)).toMatchObject({
      totalClips: 2,
      chatCount: 1,
      articleCount: 1,
      totalMessages: 3,
      topConversations: [
        expect.objectContaining({
          conversationId: 8,
          openSource: 'chatgpt',
          openConversationKey: 'thread-8',
          messageCount: 3,
        }),
      ],
    });
  });
});
