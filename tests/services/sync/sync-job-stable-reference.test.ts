import { describe, expect, it } from 'vitest';

import { normalizeSyncJobSnapshot } from '@services/sync/sync-job-store';

const stable = { source: 'chatgpt', conversationKey: 'thread-job', conversationId: 88 } as const;

describe('sync job stable references', () => {
  it('preserves stable batch/current/result references and treats their numeric IDs as display hints', () => {
    const job = normalizeSyncJobSnapshot('notion', {
      id: 'job-1',
      status: 'running',
      conversations: [stable],
      conversationIds: [7],
      currentConversation: stable,
      currentConversationId: 7,
      perConversation: [
        {
          conversationId: 7,
          reference: stable,
          ok: false,
          error: 'failed',
        },
      ],
    });

    expect(job?.conversations).toEqual([stable]);
    expect(job?.conversationIds).toEqual([88]);
    expect(job?.currentConversation).toEqual(stable);
    expect(job?.currentConversationId).toBe(88);
    expect(job?.perConversation[0].reference).toEqual(stable);
  });

  it('does not invent a stable reference from a legacy numeric-only job', () => {
    const job = normalizeSyncJobSnapshot('obsidian', {
      id: 'legacy',
      status: 'done',
      conversationIds: [7],
      currentConversationId: 7,
      perConversation: [{ conversationId: 7, ok: false, error: 'legacy failure' }],
    });

    expect(job?.conversations).toEqual([]);
    expect(job?.currentConversation).toBeUndefined();
    expect(job?.perConversation[0].reference).toBeUndefined();
    expect(job?.conversationIds).toEqual([7]);
  });
});
