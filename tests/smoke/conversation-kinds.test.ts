import { describe, expect, it } from 'vitest';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';

function loadConversationKinds() {
  return conversationKinds;
}

describe('conversation-kinds', () => {
  it('registers built-in kinds and picks article by sourceType', () => {
    const kinds = loadConversationKinds();
    const list = kinds.list();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const article = kinds.pick({ sourceType: 'article', title: 'T' });
    expect(article.id).toBe('article');
    expect(article.obsidian.folder).toBe('SyncNos-WebArticles');
    expect(article.notion.dbSpec.storageKey).toBe('notion_db_id_syncnos_web_articles');
  });

  it('defaults to chat when no kind matches', () => {
    const kinds = loadConversationKinds();
    const chat = kinds.pick({ sourceType: 'unknown', title: 'T', source: 'chatgpt' });
    expect(chat.id).toBe('chat');
    expect(chat.obsidian.folder).toBe('SyncNos-AIChats');
    expect(chat.notion.dbSpec.storageKey).toBe('notion_db_id_syncnos_ai_chats');
  });

  it('projects lastActivityAt into Notion Date on create and update for every built-in kind', () => {
    const kinds = loadConversationKinds();
    const at = Date.parse('2026-09-08T01:02:03.000Z');
    for (const id of ['chat', 'article', 'video']) {
      const kind = kinds.list().find((item) => item.id === id)!;
      const conversation = {
        sourceType: id === 'chat' ? 'chat' : id,
        source: id === 'chat' ? 'chatgpt' : id === 'article' ? 'web' : 'video',
        title: id,
        url: `https://example.com/${id}`,
        lastActivityAt: at,
      };
      expect(kind.notion.pageSpec.buildCreateProperties(conversation).Date).toEqual({
        date: { start: '2026-09-08T01:02:03.000Z' },
      });
      expect(kind.notion.pageSpec.buildUpdateProperties(conversation).Date).toEqual({
        date: { start: '2026-09-08T01:02:03.000Z' },
      });
    }
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 9e99])(
    'projects invalid Activity %s as an explicit null Notion Date without inventing now',
    (lastActivityAt) => {
      const chat = loadConversationKinds().list().find((item) => item.id === 'chat')!;
      const properties = chat.notion.pageSpec.buildUpdateProperties({
        sourceType: 'chat',
        source: 'chatgpt',
        title: 'T',
        url: 'https://example.com',
        lastActivityAt,
      });
      expect(properties.Date).toEqual({ date: null });
    },
  );

  it('does not expose pageSpec.shouldRebuild (rebuild strategy is handled by orchestrator)', () => {
    const kinds = loadConversationKinds();
    const kind = kinds.pick({ sourceType: 'article' });
    expect((kind.notion.pageSpec as any).shouldRebuild).toBeUndefined();
  });

  it('exposes notion storage keys from registry (used by infra like disconnect/backup)', () => {
    const kinds = loadConversationKinds();
    const keys = kinds.getNotionStorageKeys();
    expect(keys).toContain('notion_db_id_syncnos_ai_chats');
    expect(keys).toContain('notion_db_id_syncnos_web_articles');
  });
});
