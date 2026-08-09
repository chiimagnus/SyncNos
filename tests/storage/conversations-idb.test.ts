import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { openDb } from '../../src/platform/idb/schema';

import {
  __closeDbForTests,
  deleteConversationsByIds,
  getConversationById,
  getConversationTailWindowBySourceAndKey,
  getConversationListBootstrap,
  getMessagesByConversationId,
  getMessagesTailByConversationId,
  mergeConversationsByIds,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  await __closeDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  await __closeDbForTests();
});

async function listAllConversationsForTests() {
  const page = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 500 }, 500);
  return page.items;
}

describe('conversations storage-idb', () => {
  it('upserts conversation and lists conversations sorted by lastCapturedAt desc', async () => {
    await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k2',
      title: 'B',
      lastCapturedAt: 2,
    });

    const items = await listAllConversationsForTests();
    expect(items.length).toBe(2);
    expect(items[0].conversationKey).toBe('k2');
    expect(items[1].conversationKey).toBe('k1');
    expect(items[0].listSourceKey).toBe('debug');
    expect(items[0].listSiteKey).toBe('unknown');
  });

  it('syncs messages and cleans up removed messages', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const before = await getMessagesByConversationId(id);
    expect(before.map((m) => m.messageKey)).toEqual(['m1', 'm2']);

    // Re-sync with only one message; should delete m2.
    const res = await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 },
    ]);
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(1);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(['m1']);
  });

  it('syncs messages incrementally without snapshot cleanup', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    // Incremental update only provides m1 (e.g. partial render) and does not mark m2 as removed:
    // m2 should remain.
    const res1 = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 }],
      { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: [] } },
    );
    expect(res1.upserted).toBe(1);
    expect(res1.deleted).toBe(0);
    const after1 = await getMessagesByConversationId(id);
    expect(after1.map((m) => m.messageKey)).toEqual(['m1', 'm2']);
    expect(after1.find((m) => m.messageKey === 'm1')?.contentText).toBe('u2');

    // Incremental delete removes only explicitly removed keys.
    const res2 = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u3', sequence: 1, updatedAt: 4 }],
      { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: ['m2'] } },
    );
    expect(res2.upserted).toBe(1);
    expect(res2.deleted).toBe(1);
    const after2 = await getMessagesByConversationId(id);
    expect(after2.map((m) => m.messageKey)).toEqual(['m1']);
  });

  it('rejects an unknown persistence mode before mutating stored messages', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'unknown_mode',
      title: 'Mode',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [{ messageKey: 'm1', role: 'user', contentText: 'old', sequence: 0 }]);

    await expect(
      syncConversationMessages(id, [{ messageKey: 'm2', role: 'assistant', contentText: 'new', sequence: 1 }], {
        mode: 'snapshop' as any,
      }),
    ).rejects.toThrow('Unknown message persistence mode');
    expect((await getMessagesByConversationId(id)).map((message) => message.messageKey)).toEqual(['m1']);
  });

  it('syncs messages in append-only mode and never deletes even when removed is provided', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const res = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 }],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: ['m2'] } },
    );
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(0);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(['m1', 'm2']);
    expect(after.find((m) => m.messageKey === 'm1')?.contentText).toBe('u2');
  });

  it.each([
    ['null diff', null],
    ['empty diff', {}],
    ['malformed diff', { added: 'm1', updated: 12, removed: ['m2'] }],
  ])('keeps append non-destructive with %s', async (_label, diff) => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: `append_${_label}`,
      title: 'Append',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'old', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'keep', sequence: 2 },
    ]);

    const result = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'new', sequence: 1 }],
      { mode: 'append', diff: diff as any },
    );

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    const stored = await getMessagesByConversationId(id);
    expect(stored.map((message) => message.messageKey)).toEqual(['m1', 'm2']);
    expect(stored.find((message) => message.messageKey === 'm1')?.contentText).toBe('old');
  });

  it('treats unkeyed append input as a no-delete no-op', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_unkeyed',
      title: 'Append',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'old', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'keep', sequence: 2 },
    ]);

    const result = await syncConversationMessages(id, [{ role: 'user', contentText: 'ignored', sequence: 1 }], {
      mode: 'append',
      diff: null,
    });

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    expect((await getMessagesByConversationId(id)).map((message) => message.messageKey)).toEqual(['m1', 'm2']);
  });

  it('requires an explicit diff for incremental mode', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'incremental_no_diff',
      title: 'Incremental',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'old', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'keep', sequence: 2 },
    ]);

    const result = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'ignored', sequence: 1 }],
      { mode: 'incremental', diff: null },
    );

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    expect((await getMessagesByConversationId(id)).map((message) => message.contentText)).toEqual(['old', 'keep']);
  });

  it('preserves existing order and tail-assigns new virtual partial rows', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_tail',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 },
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20 },
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 30 },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm3',
          role: 'user',
          contentText: 'three updated',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm4',
          role: 'assistant',
          contentText: 'four',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm5',
          role: 'user',
          contentText: 'five',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m4', 'm5'], updated: ['m3'], removed: [] } },
    );

    const stored = await getMessagesByConversationId(id);
    expect(stored.map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 10],
      ['m2', 20],
      ['m3', 30],
      ['m4', 31],
      ['m5', 32],
    ]);
  });

  it('tail-assigns virtual partial rows in incoming order across added and updated diff groups', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_incoming_order',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm2',
          role: 'assistant',
          contentText: 'second',
          sequence: 99,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm1',
          role: 'user',
          contentText: 'first',
          sequence: 99,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m1'], updated: ['m2'], removed: [] } },
    );

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m2', 0],
      ['m1', 1],
    ]);
  });

  it('tail-assigns virtual partial rows from zero in an empty conversation', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_empty',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'user',
          contentText: 'one',
          sequence: 999,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm2',
          role: 'assistant',
          contentText: 'two',
          sequence: 999,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m1', 'm2'], updated: [], removed: [] } },
    );

    expect((await getMessagesByConversationId(id)).map((message) => message.sequence)).toEqual([0, 1]);
  });

  it('keeps unmarked append incoming sequence for autosave prefix reconciliation', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_unmarked',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20 },
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 30 },
    ]);

    await syncConversationMessages(id, [{ messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 }], {
      mode: 'append',
      diff: { added: ['m1'], updated: [], removed: [] },
    });

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 10],
      ['m2', 20],
      ['m3', 30],
    ]);
  });

  it('lets explicit replace clear stale markdown in append and snapshot modes', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'clear_markdown',
      title: 'Clear',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'assistant', contentText: 'old', contentMarkdown: '**old**', sequence: 0 },
    ]);

    await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'assistant', contentText: 'append plain', contentMarkdown: '', sequence: 0 }],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: [] } },
    );
    expect((await getMessagesByConversationId(id))[0].contentMarkdown).toBe('');

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'assistant', contentText: 'snapshot plain', contentMarkdown: '', sequence: 0 },
    ]);
    expect((await getMessagesByConversationId(id))[0].contentMarkdown).toBe('');
  });

  it('preserves existing markdown for protective append merge policy', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_preserve_markdown',
      title: 'Merge',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'old text',
        contentMarkdown: '![rich](data:image/png;base64,abc)',
        sequence: 5,
        updatedAt: 10,
      },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'new text',
          contentMarkdown: 'plain fallback',
          sequence: 0,
          updatedAt: 20,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-markdown',
        },
      ],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: [] } },
    );

    const [stored] = await getMessagesByConversationId(id);
    expect(stored).toMatchObject({
      contentText: 'new text',
      contentMarkdown: '![rich](data:image/png;base64,abc)',
      sequence: 5,
      updatedAt: 20,
    });
    expect(stored).not.toHaveProperty('captureMergePolicy');
    expect(stored).not.toHaveProperty('captureSequencePolicy');
  });

  it('allows a later complete AI image snapshot to replace an earlier protected fallback', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'googleaistudio',
      conversationKey: 'image_fallback_recovery',
      title: 'Images',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'fallback',
          contentMarkdown: 'fallback',
          sequence: 0,
          captureMergePolicy: 'preserve-existing-markdown',
        },
      ],
      { mode: 'append', diff: { added: ['m1'], updated: [], removed: [] } },
    );

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'complete',
          contentMarkdown: 'complete\n\n![](syncnos-asset://asset-1)',
          sequence: 0,
        },
      ],
      { mode: 'snapshot', diff: null },
    );

    const [stored] = await getMessagesByConversationId(id);
    expect(stored).toMatchObject({
      contentText: 'complete',
      contentMarkdown: 'complete\n\n![](syncnos-asset://asset-1)',
    });
    expect(stored).not.toHaveProperty('captureMergePolicy');
  });

  it('preserves existing content and zero timestamp while allowing first-time protective insert', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_preserve_content',
      title: 'Merge',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'hydrated report',
        contentMarkdown: '# Hydrated report',
        sequence: 3,
        updatedAt: 0,
      },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'placeholder',
          contentMarkdown: 'placeholder',
          sequence: 0,
          updatedAt: 20,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
        {
          messageKey: 'm2',
          role: 'assistant',
          contentText: 'first placeholder',
          contentMarkdown: 'first placeholder',
          sequence: 0,
          updatedAt: 30,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
      ],
      { mode: 'append', diff: { added: ['m2'], updated: ['m1'], removed: [] } },
    );

    const stored = await getMessagesByConversationId(id);
    expect(stored[0]).toMatchObject({
      messageKey: 'm1',
      contentText: 'hydrated report',
      contentMarkdown: '# Hydrated report',
      sequence: 3,
      updatedAt: 0,
    });
    expect(stored[1]).toMatchObject({
      messageKey: 'm2',
      contentText: 'first placeholder',
      contentMarkdown: 'first placeholder',
      sequence: 4,
      updatedAt: 30,
    });
  });

  it('keeps hydrated Deep Research content while inserting a first-time placeholder', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'deep_research_merge',
      title: 'Research',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      {
        messageKey: 'research-1',
        role: 'assistant',
        contentText: 'Complete report',
        contentMarkdown: '# Complete report',
        sequence: 0,
        updatedAt: 10,
      },
    ]);
    const placeholder = 'Deep Research (iframe): https://example.web-sandbox.oaiusercontent.com/report';

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'research-1',
          role: 'assistant',
          contentText: placeholder,
          contentMarkdown: placeholder,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
        {
          messageKey: 'research-2',
          role: 'assistant',
          contentText: placeholder,
          contentMarkdown: placeholder,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
      ],
      { mode: 'append', diff: { added: ['research-2'], updated: ['research-1'], removed: [] } },
    );

    const stored = await getMessagesByConversationId(id);
    expect(stored[0]).toMatchObject({ contentText: 'Complete report', contentMarkdown: '# Complete report' });
    expect(stored[1]).toMatchObject({ contentText: placeholder, contentMarkdown: placeholder });
  });

  it('reads message tails by conversation id with ascending sequence order', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'tail_k1',
      title: 'Tail',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      Array.from({ length: 300 }, (_, index) => {
        const sequence = index + 1;
        return {
          messageKey: `tail_${sequence}`,
          role: sequence % 2 === 0 ? 'assistant' : 'user',
          contentText: `content_${sequence}`,
          sequence,
          updatedAt: sequence,
        };
      }),
    );

    const tail = await getMessagesTailByConversationId(id, 200);
    expect(tail).toHaveLength(200);
    expect(tail[0]?.sequence).toBe(101);
    expect(tail[199]?.sequence).toBe(300);
    expect(tail[0]?.messageKey).toBe('tail_101');
    expect(tail[199]?.messageKey).toBe('tail_300');
  });

  it('reads conversation tail window by source and key', async () => {
    const missing = await getConversationTailWindowBySourceAndKey('debug', 'missing', 200);
    expect(missing.conversation).toBeNull();
    expect(missing.messages).toEqual([]);

    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'tail_window_k1',
      title: 'Window',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      Array.from({ length: 300 }, (_, index) => {
        const sequence = index + 1;
        return {
          messageKey: `window_${sequence}`,
          role: sequence % 2 === 0 ? 'assistant' : 'user',
          contentText: `content_${sequence}`,
          sequence,
          updatedAt: sequence,
        };
      }),
    );

    const windowResult = await getConversationTailWindowBySourceAndKey('debug', 'tail_window_k1', 200);
    expect(windowResult.conversation?.id).toBe(id);
    expect(windowResult.messages).toHaveLength(200);
    expect(windowResult.messages[0]?.sequence).toBe(101);
    expect(windowResult.messages[199]?.sequence).toBe(300);
  });

  it('deletes conversations, messages, and sync mappings', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
    ]);

    // Insert a mapping directly.
    const db = await openDb();
    const t = db.transaction(['sync_mappings'], 'readwrite');
    const store = t.objectStore('sync_mappings');
    await reqToPromise(
      store.add({ source: 'debug', conversationKey: 'k1', notionPageId: 'p1', updatedAt: Date.now() }),
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error('tx failed'));
      t.onabort = () => reject(t.error || new Error('tx aborted'));
    });
    db.close();

    const res = await deleteConversationsByIds([id]);
    expect(res.deletedConversations).toBe(1);
    expect(res.deletedMessages).toBe(1);
    expect(res.deletedMappings).toBe(1);

    const items = await listAllConversationsForTests();
    expect(items.length).toBe(0);
  });

  it('reuses and rewrites legacy article conversation rows by normalized url', async () => {
    const db = await openDb();
    const t = db.transaction(['conversations', 'sync_mappings'], 'readwrite');
    const conversations = t.objectStore('conversations');
    const mappings = t.objectStore('sync_mappings');

    const legacyId = await reqToPromise<number>(
      conversations.add({
        sourceType: 'article',
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        title: 'Legacy title',
        url: 'https://example.com/post#frag',
        notionPageId: 'page_old',
        warningFlags: [],
        lastCapturedAt: 1,
      }),
    );

    await reqToPromise(
      mappings.add({
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        notionPageId: 'page_old',
        updatedAt: 1,
      }),
    );
    await txDone(t);
    db.close();

    const conversation = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      title: 'New title',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });

    expect(Number(conversation.id)).toBe(legacyId);
    expect(conversation.source).toBe('web');
    expect(conversation.conversationKey).toBe('article:https://example.com/post');
    expect(conversation.url).toBe('https://example.com/post');

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['conversations', 'sync_mappings'], 'readonly');
    const verifyConversations = await reqToPromise<any[]>(verifyTx.objectStore('conversations').getAll());
    const verifyMappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    await txDone(verifyTx);
    reopened.close();

    expect(verifyConversations).toHaveLength(1);
    expect(verifyConversations[0]).toMatchObject({
      id: legacyId,
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      url: 'https://example.com/post',
      notionPageId: 'page_old',
    });
    expect(verifyMappings).toHaveLength(1);
    expect(verifyMappings[0]).toMatchObject({
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      notionPageId: 'page_old',
    });
  });

  it('merges conversations by ids and migrates messages + sync mappings', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'keep',
      title: '',
      url: 'https://example.com/a',
      notionPageId: '',
      warningFlags: ['w1'],
      lastCapturedAt: 10,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'remove',
      title: 'From remove',
      url: 'https://example.com/b',
      notionPageId: 'page_remove',
      warningFlags: ['w2'],
      lastCapturedAt: 20,
    });
    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    const keepKey = String(keep.conversationKey || '');
    const removeKey = String(remove.conversationKey || '');

    await syncConversationMessages(removeId, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    // Insert mapping for remove directly.
    const db = await openDb();
    const t = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      t.objectStore('sync_mappings').add({
        source: 'web',
        conversationKey: removeKey,
        notionPageId: 'page_remove',
        lastSyncedMessageKey: 'x',
        updatedAt: 1,
      }),
    );
    await txDone(t);
    db.close();

    const res = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });
    expect(res.keptConversationId).toBe(keepId);
    expect(res.removedConversationId).toBe(removeId);
    expect(res.merged).toBe(true);

    const items = await listAllConversationsForTests();
    expect(items.map((c) => c.conversationKey)).toEqual([keepKey]);
    expect(items[0]).toMatchObject({
      conversationKey: keepKey,
      title: 'From remove',
      notionPageId: 'page_remove',
    });
    expect(items[0].warningFlags).toEqual(['w1', 'w2']);
    expect(Number(items[0].lastCapturedAt)).toBe(20);

    const moved = await getMessagesByConversationId(keepId);
    expect(moved.map((m) => m.messageKey)).toEqual(['m1', 'm2']);

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['sync_mappings'], 'readonly');
    const verifyMappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    await txDone(verifyTx);
    reopened.close();

    expect(verifyMappings).toHaveLength(1);
    expect(verifyMappings[0]).toMatchObject({
      source: 'web',
      conversationKey: keepKey,
      notionPageId: 'page_remove',
      lastSyncedMessageKey: 'x',
    });
  });

  it('maintains listSourceKey/listSiteKey on upsert and merge writes', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'key_keep',
      title: 'keep',
      url: '',
      lastCapturedAt: 1,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'key_remove',
      title: 'remove',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });

    expect(keep.listSourceKey).toBe('web');
    expect(keep.listSiteKey).toBe('unknown');
    expect(remove.listSourceKey).toBe('web');
    expect(remove.listSiteKey).toBe('domain:example.com');

    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    const merged = await getConversationById(keepId);
    expect(merged).toBeTruthy();
    expect(merged?.listSourceKey).toBe('web');
    expect(merged?.listSiteKey).toBe('domain:example.com');
  });
});
