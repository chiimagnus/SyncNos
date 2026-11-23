import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBIndex, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests } from '@platform/idb/schema';
import {
  __resetConversationStorageStateForTests,
  deleteConversationsByIds,
  findSavedConversationForPage,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(() => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
});

describe('saved current-page identity', () => {
  it('uses the article identity contract, including Discourse post routes and page fragments', async () => {
    const article = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'legacy-article-key',
      url: 'https://example.com/post?article=1',
      title: 'Article',
    });
    expect(await findSavedConversationForPage('web', 'https://example.com/post?article=1#section')).toMatchObject({
      id: article.id,
      source: 'web',
      conversationKey: 'article:https://example.com/post?article=1',
    });
    expect(await findSavedConversationForPage('web', 'https://example.com/post?article=2')).toBeNull();

    const discourse = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'legacy-discourse-key',
      url: 'https://forum.example.com/t/topic/456',
    });
    expect(
      await findSavedConversationForPage('web', 'https://forum.example.com/t/topic/456/12?u=someone'),
    ).toMatchObject({
      id: discourse.id,
    });
    expect(await findSavedConversationForPage('web', 'https://forum.example.com/t/topic/457/12')).toBeNull();
  });

  it('matches saved videos through canonical playback addresses without confusing different parts', async () => {
    const youtube = await upsertConversation({
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video:https://www.youtube.com/watch?v=abc',
      url: 'https://www.youtube.com/watch?v=abc',
    });
    const bilibili = await upsertConversation({
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video:https://www.bilibili.com/video/BV1ABC123/',
      url: 'https://www.bilibili.com/video/BV1ABC123/',
    });
    expect(await findSavedConversationForPage('video', 'https://youtu.be/abc?t=12')).toMatchObject({ id: youtube.id });
    expect(
      await findSavedConversationForPage('video', 'https://www.bilibili.com/list/watchlater?bvid=BV1ABC123'),
    ).toMatchObject({ id: bilibili.id });
    expect(await findSavedConversationForPage('video', 'https://www.bilibili.com/video/BV1ABC123/?p=2')).toBeNull();
    expect(await findSavedConversationForPage('video', 'https://www.youtube.com/watch?v=other')).toBeNull();
    expect(await findSavedConversationForPage('video', 'https://www.youtube.com/')).toBeNull();
  });

  it('resolves chat aliases by durable identity and returns the stored locator, not a guessed key', async () => {
    const chatgpt = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'old-key-format',
      title: 'Saved Chat',
      url: 'https://chatgpt.com/c/session-1',
    });
    const claude = await upsertConversation({
      sourceType: 'chat',
      source: 'claude',
      conversationKey: 'legacy-claude-key',
      url: 'https://claude.ai/chat/chat-2',
    });
    const notion = await upsertConversation({
      sourceType: 'chat',
      source: 'notionai',
      conversationKey: 'notionai_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      url: 'https://app.notion.com/chat?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(await findSavedConversationForPage('chatgpt', 'https://chatgpt.com/c/session-1?foo=bar')).toMatchObject({
      id: chatgpt.id,
      source: 'chatgpt',
      conversationKey: 'old-key-format',
    });
    expect(await findSavedConversationForPage('claude', 'https://claude.ai/chat/chat-2#last')).toMatchObject({
      id: claude.id,
      conversationKey: 'legacy-claude-key',
    });
    expect(
      await findSavedConversationForPage('notionai', 'https://notion.so/chat?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).toMatchObject({
      id: notion.id,
    });
    expect(await findSavedConversationForPage('claude', 'https://chatgpt.com/c/session-1')).toBeNull();
    expect(await findSavedConversationForPage('chatgpt', 'https://chatgpt.com/c/session-2')).toBeNull();
    expect(await findSavedConversationForPage('chatgpt', 'https://chatgpt.com/')).toBeNull();
  });

  it('stops at the first matching chat in a source-scoped cursor instead of loading the provider list', async () => {
    const saved = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'old-match',
      url: 'https://chatgpt.com/c/target',
      lastActivityAt: 100,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'new-other',
      url: 'https://chatgpt.com/c/other',
      lastActivityAt: 200,
    });
    const getAll = vi.spyOn(IDBIndex.prototype, 'getAll');
    const openCursor = vi.spyOn(IDBIndex.prototype, 'openCursor');
    try {
      expect(await findSavedConversationForPage('chatgpt', 'https://chatgpt.com/c/target')).toMatchObject({
        id: saved.id,
      });
      expect(getAll).not.toHaveBeenCalled();
      expect(openCursor).toHaveBeenCalledWith(expect.anything(), 'prev');
    } finally {
      getAll.mockRestore();
      openCursor.mockRestore();
    }
  });

  it('does not mark unsupported or deleted pages as saved', async () => {
    const item = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/removed',
      url: 'https://example.com/removed',
    });
    for (const url of ['', 'javascript:alert(1)', 'file:///tmp/test', 'not-a-url']) {
      expect(await findSavedConversationForPage('web', url)).toBeNull();
    }
    expect(await findSavedConversationForPage('video', 'https://example.com/removed')).toBeNull();
    expect(await findSavedConversationForPage('web', 'https://example.com/removed')).toMatchObject({ id: item.id });
    await deleteConversationsByIds([item.id]);
    expect(await findSavedConversationForPage('web', 'https://example.com/removed')).toBeNull();
  });
});
