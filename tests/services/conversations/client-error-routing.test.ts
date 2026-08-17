import { afterEach, describe, expect, it, vi } from 'vitest';

import { findConversationBySourceAndKey } from '@services/conversations/client/repo';

const runtimeMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@platform/runtime/runtime', () => ({ send: runtimeMocks.send }));

afterEach(() => {
  runtimeMocks.send.mockReset();
});

describe('conversation client error contract', () => {
  it('preserves stale epoch/reference codes from the background envelope', async () => {
    runtimeMocks.send.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: {
        message: 'stale facts epoch',
        extra: { code: 'STALE_BACKEND_EPOCH', diagnostics: { expected: 'new-epoch' } },
      },
    });

    await expect(findConversationBySourceAndKey('chatgpt', 'thread-1', 'idb-v1')).rejects.toMatchObject({
      message: 'stale facts epoch',
      code: 'STALE_BACKEND_EPOCH',
      diagnostics: { expected: 'new-epoch' },
    });

    runtimeMocks.send.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: { message: 'stale reference', extra: { code: 'STALE_REFERENCE' } },
    });
    await expect(findConversationBySourceAndKey('chatgpt', 'thread-1', 'idb-v1')).rejects.toMatchObject({
      code: 'STALE_REFERENCE',
    });
  });
});
