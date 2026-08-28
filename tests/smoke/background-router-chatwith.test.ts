import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSyncMappingByConversationMock = vi.fn();

vi.mock('../../src/services/conversations/data/storage-idb', () => ({
  getSyncMappingByConversation: (...args: any[]) => getSyncMappingByConversationMock(...args),
}));

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { CHATWITH_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { buildConversationBasename } from '../../src/services/conversations/domain/file-naming';
import { registerChatWithBackgroundHandlers } from '../../src/services/integrations/chatwith/chatwith-background-handlers';
import { GITHUB_OUTPUT_FOLDERS } from '../../src/services/sync/github/settings-store';

function createRouter() {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerChatWithBackgroundHandlers(router);
  return router;
}

describe('ChatWith synced URL background contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSyncMappingByConversationMock.mockResolvedValue(null);
  });

  it('rejects an invalid conversation id before reading storage', async () => {
    const router = createRouter();

    const response = await router.__handleMessageForTests({
      type: CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS,
      conversationId: 0,
    });

    expect(getSyncMappingByConversationMock).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      data: null,
      error: {
        message: 'invalid conversationId',
        extra: { code: 'CHATWITH_CONVERSATION_ID_REQUIRED' },
      },
    });
  });

  it('reports a missing conversation without fabricating destination URLs', async () => {
    const router = createRouter();

    const response = await router.__handleMessageForTests({
      type: CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS,
      conversationId: 9,
    });

    expect(getSyncMappingByConversationMock).toHaveBeenCalledWith(9);
    expect(response).toEqual({
      ok: false,
      data: null,
      error: {
        message: 'conversation not found',
        extra: { code: 'CHATWITH_CONVERSATION_NOT_FOUND', conversationId: 9 },
      },
    });
  });

  it('falls back to conversation Notion and Feishu fields when no sync mapping row exists', async () => {
    const router = createRouter();
    getSyncMappingByConversationMock.mockResolvedValue({
      conversation: {
        id: 5,
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/fallback',
        title: 'Fallback Article',
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
        notionWorkspaceSlug: 'workspace',
        feishuDocId: 'docxFallback',
      },
      mapping: null,
    });

    const response = await router.__handleMessageForTests({
      type: CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS,
      conversationId: 5,
    });

    expect(response).toEqual({
      ok: true,
      data: {
        notionUrl: 'https://app.notion.com/p/workspace/0123456789abcdef0123456789abcdef',
        feishuUrl: 'https://www.feishu.cn/docx/docxFallback',
        githubUrl: '',
      },
      error: null,
    });
  });

  it('returns a router error when sync mapping storage fails', async () => {
    const router = createRouter();
    getSyncMappingByConversationMock.mockRejectedValue(new Error('idb unavailable'));

    const response = await router.__handleMessageForTests({
      type: CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS,
      conversationId: 7,
    });

    expect(response).toEqual({
      ok: false,
      data: null,
      error: { message: 'idb unavailable', extra: null },
    });
  });

  it('resolves Notion, Feishu, and GitHub URLs from the canonical sync mapping', async () => {
    const router = createRouter();
    const conversation = {
      id: 7,
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/a',
      title: 'Article A',
      url: 'https://example.com/a',
    };
    const markdownPath = `${GITHUB_OUTPUT_FOLDERS.article}/${buildConversationBasename(conversation)}.md`;
    getSyncMappingByConversationMock.mockResolvedValue({
      conversation,
      mapping: {
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
        notionWorkspaceSlug: 'workspace',
        feishuDocId: 'docxToken',
        githubRemoteKey: 'github.com/owner/repo@main',
        githubLastSyncedAt: 123,
        githubProjectionFingerprint: 'c'.repeat(64),
        githubManagedFiles: {
          [markdownPath]: {
            kind: 'markdown',
            sha: 'a'.repeat(40),
            contentHash: 'b'.repeat(64),
          },
        },
      },
    });

    const response = await router.__handleMessageForTests({
      type: CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS,
      conversationId: 7,
    });

    expect(getSyncMappingByConversationMock).toHaveBeenCalledWith(7);
    expect(response).toEqual({
      ok: true,
      data: {
        notionUrl: 'https://app.notion.com/p/workspace/0123456789abcdef0123456789abcdef',
        feishuUrl: 'https://www.feishu.cn/docx/docxToken',
        githubUrl: `https://github.com/owner/repo/blob/main/${markdownPath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`,
      },
      error: null,
    });
  });
});
