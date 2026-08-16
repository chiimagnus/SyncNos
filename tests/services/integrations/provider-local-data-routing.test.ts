import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const feishuMocks = vi.hoisted(() => ({ getFeishuOAuthToken: vi.fn(async () => ({ accessToken: 'token' })) }));
vi.mock('@services/sync/feishu/auth/token-store', () => ({
  getFeishuOAuthToken: feishuMocks.getFeishuOAuthToken,
}));

import { syncConversations as syncObsidianConversations } from '@services/sync/obsidian/obsidian-sync-orchestrator';
import { syncConversations as syncFeishuConversations } from '@services/sync/feishu/feishu-sync-orchestrator';

const resolved = { source: 'chatgpt', conversationKey: 'thread-provider', conversationId: 73 } as const;

function storage() {
  return {
    resolveConversation: vi.fn(async () => resolved),
    getConversationByReference: vi.fn(async () => null),
    getMessagesByConversation: vi.fn(async () => []),
    getSyncMappingByConversation: vi.fn(async () => null),
    patchSyncMapping: vi.fn(async () => true),
    setConversationNotionPageId: vi.fn(async () => true),
    setSyncCursor: vi.fn(async () => true),
    clearSyncCursor: vi.fn(async () => true),
    getArticleCommentsByConversation: vi.fn(async () => []),
    attachOrphanArticleCommentsToConversation: vi.fn(async () => 0),
    getImageAsset: vi.fn(async () => null),
  };
}

describe('provider local-data routing', () => {
  it('passes the resolved stable reference into Obsidian storage instead of reopening by numeric ID', async () => {
    const bound = storage();
    const result: any = await syncObsidianConversations({
      conversations: [resolved],
      instanceId: 'provider-test-obsidian',
      storage: bound as any,
    });

    expect(result.failCount).toBe(1);
    expect(bound.getConversationByReference).toHaveBeenCalledWith(resolved);
  });

  it('passes the resolved stable reference into Feishu mapping lookup before any content write', async () => {
    const bound = storage();
    const result: any = await syncFeishuConversations({
      conversations: [resolved],
      instanceId: 'provider-test-feishu',
      storage: bound as any,
    });

    expect(result.failCount).toBe(1);
    expect(bound.getSyncMappingByConversation).toHaveBeenCalledWith(resolved);
    expect(bound.patchSyncMapping).not.toHaveBeenCalled();
  });

  it('has no provider import of the removed static backgroundStorage or storage-idb convenience path', () => {
    for (const file of [
      'src/services/sync/notion/notion-sync-orchestrator.ts',
      'src/services/sync/obsidian/obsidian-sync-orchestrator.ts',
      'src/services/sync/feishu/feishu-sync-orchestrator.ts',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('backgroundStorage');
      expect(source).not.toContain('@services/conversations/data/storage-idb');
    }
  });
});
