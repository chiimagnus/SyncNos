import { afterEach, describe, expect, it } from 'vitest';

import { conversationKinds } from '@services/protocols/conversation-kinds';
import {
  cacheNotionManagedDatabaseId,
  getNotionDatabaseId,
  getNotionSettingsConfig,
  resetNotionDatabaseId,
  saveNotionSettingsConfig,
} from '@services/sync/notion/settings-store';

function installStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  // @ts-expect-error test global
  globalThis.browser = undefined;
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: string[], callback: (value: Record<string, unknown>) => void) {
          callback(Object.fromEntries((keys || []).map((key) => [key, store[key]])));
        },
        set(payload: Record<string, unknown>, callback: () => void) {
          Object.assign(store, payload || {});
          callback();
        },
        remove(keys: string[], callback: () => void) {
          for (const key of keys || []) delete store[key];
          callback();
        },
      },
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).browser;
});

describe('Notion settings store', () => {
  it('clears every managed database override only when the parent page id changes', async () => {
    const [chatKey, articleKey, videoKey] = ['chat', 'article', 'video'].map((kindId) => {
      const storageKey = conversationKinds.getNotionDbSpecByKindId(kindId)?.storageKey;
      if (!storageKey) throw new Error(`missing Notion storage key for ${kindId}`);
      return storageKey;
    });
    const store = installStorage({
      notion_parent_page_id: 'parent-a',
      notion_parent_page_title: 'Parent A',
      [chatKey]: '1'.repeat(32),
      [articleKey]: '2'.repeat(32),
      [videoKey]: '3'.repeat(32),
    });

    await saveNotionSettingsConfig({ id: 'parent-a', title: 'Renamed A' }, {});
    expect(store[chatKey]).toBe('1'.repeat(32));
    expect(store[articleKey]).toBe('2'.repeat(32));
    expect(store[videoKey]).toBe('3'.repeat(32));

    const changed = await saveNotionSettingsConfig({ id: 'parent-b', title: 'Parent B' }, {});
    expect(changed).toEqual({
      parentPageId: 'parent-b',
      parentPageTitle: 'Parent B',
      databaseIds: { chat: '', article: '', video: '' },
    });
    expect(store[chatKey]).toBe('');
    expect(store[articleKey]).toBe('');
    expect(store[videoKey]).toBe('');
  });

  it('saves a new parent and all database bindings together, or leaves them unchanged on invalid input', async () => {
    const store = installStorage({ notion_parent_page_id: 'parent-a', notion_parent_page_title: 'Parent A' });
    const parent = { id: 'parent-b', title: 'Parent B' };
    const ids = { chat: 'a'.repeat(32), article: 'b'.repeat(32), video: 'c'.repeat(32) };
    await expect(saveNotionSettingsConfig(parent, ids)).resolves.toEqual({
      parentPageId: parent.id,
      parentPageTitle: parent.title,
      databaseIds: ids,
    });
    const snapshot = { ...store };
    await expect(
      saveNotionSettingsConfig(
        { id: 'parent-c', title: 'Parent C' },
        {
          chat: 'd'.repeat(32),
          article: 'invalid',
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_notion_database_id' });
    expect(store).toEqual(snapshot);
  });

  it('preserves database overrides when only the parent ID representation changes', async () => {
    const compact = '0123456789abcdef0123456789abcdef';
    const dashed = '01234567-89ab-cdef-0123-456789abcdef';
    installStorage({ notion_parent_page_id: compact });
    await cacheNotionManagedDatabaseId('chat', 'a'.repeat(32));
    const config = await saveNotionSettingsConfig({ id: dashed, title: 'Same page' }, {});
    expect(config.databaseIds.chat).toBe('a'.repeat(32));
  });

  it('normalizes database ids, rejects invalid ids, and resets by kind', async () => {
    installStorage({ notion_parent_page_id: 'parent-a', notion_parent_page_title: 'Parent A' });
    const rawId = '01234567-89AB-CDEF-0123-456789ABCDEF';
    const normalized = '0123456789abcdef0123456789abcdef';

    await expect(
      cacheNotionManagedDatabaseId('chat', `https://www.notion.so/Workspace-${rawId}?v=${'f'.repeat(32)}`),
    ).resolves.toBe(normalized);
    await expect(getNotionDatabaseId('chat')).resolves.toBe(normalized);
    await expect(cacheNotionManagedDatabaseId('article', 'not-a-notion-id')).rejects.toMatchObject({
      code: 'invalid_notion_database_id',
    });
    await expect(cacheNotionManagedDatabaseId('video', 'db1')).rejects.toMatchObject({
      code: 'invalid_notion_database_id',
    });
    await expect(cacheNotionManagedDatabaseId('video', rawId)).resolves.toBe(normalized);
    await expect(getNotionDatabaseId('video')).resolves.toBe(normalized);

    await resetNotionDatabaseId('chat');
    await expect(getNotionDatabaseId('chat')).resolves.toBe('');
    expect((await getNotionSettingsConfig()).databaseIds.chat).toBe('');
  });
});
