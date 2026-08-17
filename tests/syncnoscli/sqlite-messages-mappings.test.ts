import { afterEach, describe, expect, it } from 'vitest';

import { mergeConversationsWithinTransaction } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { readFactsRevision, runFactsTransaction } from '../../packages/syncnoscli/src/sqlite/revision';

import { createSqliteTestFixture } from './sqlite-test-fixture';

const fixture = createSqliteTestFixture('syncnoscli-messages-');

afterEach(fixture.cleanup);

describe('SQLite messages repository', () => {
  it('matches snapshot, incremental, and append persistence semantics while preserving opaque payload fields', async () => {
    const { conversations, handle, messages } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'messages',
        title: 'Messages',
        lastCapturedAt: 1,
      });
      expect(
        messages.syncConversationMessages(conversation.id, [
          {
            messageKey: 'm1',
            role: 'user',
            contentText: 'one',
            contentMarkdown: '**one**',
            sequence: 10,
            updatedAt: 1,
            opaqueField: { old: true },
          },
          { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20, updatedAt: 2 },
        ]),
      ).toEqual({ upserted: 2, deleted: 0 });

      expect(
        messages.syncConversationMessages(
          conversation.id,
          [
            {
              messageKey: 'm1',
              role: 'user',
              contentText: 'one changed',
              contentMarkdown: 'plain fallback',
              sequence: 0,
              updatedAt: 3,
              captureMergePolicy: 'preserve-existing-markdown',
              captureSequencePolicy: 'preserve-existing-tail',
              opaqueNewField: ['kept'],
            },
            {
              messageKey: 'm3',
              role: 'assistant',
              contentText: 'three',
              sequence: 999,
              captureSequencePolicy: 'preserve-existing-tail',
            },
          ],
          { mode: 'append', diff: { added: ['m3'], updated: ['m1'], removed: ['m2'] } },
        ),
      ).toEqual({ upserted: 2, deleted: 0 });

      expect(messages.getMessagesByConversationId(conversation.id)).toMatchObject([
        {
          messageKey: 'm1',
          contentText: 'one changed',
          contentMarkdown: '**one**',
          sequence: 10,
          opaqueField: { old: true },
          opaqueNewField: ['kept'],
        },
        { messageKey: 'm2', sequence: 20 },
        { messageKey: 'm3', sequence: 21 },
      ]);

      expect(
        messages.syncConversationMessages(
          conversation.id,
          [{ messageKey: 'm1', role: 'user', contentText: 'incremental', sequence: 10, updatedAt: 4 }],
          { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: ['m2'] } },
        ),
      ).toEqual({ upserted: 1, deleted: 1 });
      expect(messages.getMessagesByConversationId(conversation.id).map((item) => item.messageKey)).toEqual([
        'm1',
        'm3',
      ]);

      expect(
        messages.syncConversationMessages(
          conversation.id,
          [{ messageKey: 'ignored', role: 'assistant', contentText: 'ignored', sequence: 99 }],
          { mode: 'append', diff: null },
        ),
      ).toEqual({ upserted: 0, deleted: 0 });
      expect(messages.getMessagesTailByConversationId(conversation.id, 1).map((item) => item.messageKey)).toEqual([
        'm3',
      ]);
      expect(messages.getConversationTailWindowBySourceAndKey('chatgpt', 'messages', 2)).toMatchObject({
        conversation: { id: conversation.id },
        messages: [{ messageKey: 'm1' }, { messageKey: 'm3' }],
      });

      expect(
        messages.syncConversationMessages(conversation.id, [
          { messageKey: 'm3', role: 'assistant', contentText: 'snapshot', sequence: 5, updatedAt: 5 },
        ]),
      ).toEqual({ upserted: 1, deleted: 1 });
      expect(messages.getMessagesByConversationId(conversation.id).map((item) => item.messageKey)).toEqual(['m3']);
    } finally {
      handle.close();
    }
  });

  it('keeps snapshot messageKey identity exact instead of trimming and then deleting the inserted row', async () => {
    const { conversations, handle, messages } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'exact-message-key',
        title: 'Exact message key',
        lastCapturedAt: 1,
      });

      expect(
        messages.syncConversationMessages(conversation.id, [
          { messageKey: ' m1 ', role: 'assistant', contentText: 'kept', sequence: 1 },
        ]),
      ).toEqual({ upserted: 1, deleted: 0 });
      expect(messages.getMessagesByConversationId(conversation.id).map((message) => message.messageKey)).toEqual([' m1 ']);
    } finally {
      handle.close();
    }
  });

  it('rolls back a failed facts write without publishing a revision', async () => {
    const { conversations, database, handle, messages } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'rollback',
        title: 'Rollback',
        lastCapturedAt: 1,
      });
      const revisionBefore = readFactsRevision(database);
      database.exec(`
        CREATE TRIGGER reject_message_insert
        BEFORE INSERT ON messages
        BEGIN
          SELECT RAISE(ABORT, 'reject message');
        END;
      `);

      expect(() =>
        messages.syncConversationMessages(conversation.id, [
          { messageKey: 'm1', role: 'assistant', contentText: 'will fail', sequence: 1 },
        ]),
      ).toThrow();
      expect(messages.getMessagesByConversationId(conversation.id)).toEqual([]);
      expect(readFactsRevision(database)).toBe(revisionBefore);
    } finally {
      handle.close();
    }
  });
});

describe('SQLite sync mappings repository', () => {
  it('keeps cursor anchors conservative across a conversation merge and moves messages in the same facts transaction', async () => {
    const { conversations, database, handle, mappings, messages } = await fixture.open();
    try {
      const keep = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'keep',
        title: 'Keep',
        lastCapturedAt: 1,
      });
      const remove = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'remove',
        title: 'Remove',
        lastCapturedAt: 2,
      });
      messages.syncConversationMessages(remove.id, [
        { messageKey: 'move', role: 'assistant', contentText: 'move', sequence: 1, updatedAt: 1 },
      ]);
      mappings.setSyncCursor(keep.id, {
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
        lastSyncedAt: 100,
        notionSectionCursors: { body: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 } },
      });
      mappings.setSyncCursor(remove.id, {
        lastSyncedMessageKey: 'm2',
        lastSyncedSequence: 2,
        lastSyncedAt: 300,
        lastSyncedMessageUpdatedAt: 456,
        notionSectionCursors: { body: { lastSyncedMessageKey: 'm2', lastSyncedSequence: 2 } },
      });

      const result = runFactsTransaction(database, () =>
        mergeConversationsWithinTransaction(database, {
          keepConversationId: keep.id,
          removeConversationId: remove.id,
        }),
      ).result;
      expect(result).toMatchObject({ merged: true, movedMessages: 1 });
      expect(messages.getMessagesByConversationId(keep.id).map((message) => message.messageKey)).toEqual(['move']);
      const mapping = mappings.getSyncMappingByConversation(keep.id)?.mapping as Record<string, unknown>;
      expect(mapping).toMatchObject({
        source: 'chatgpt',
        conversationKey: 'keep',
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
        lastSyncedAt: 100,
      });
      expect(mapping.lastSyncedMessageUpdatedAt).toBeNull();
      expect((mapping.notionSectionCursors as Record<string, unknown>).body).toMatchObject({
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
      });
      expect(mappings.getSyncMappingByConversation(remove.id)).toBeNull();
    } finally {
      handle.close();
    }
  });

  it('patches provider metadata and nested sections without erasing opaque fields, then clears only cursor data', async () => {
    const { conversations, handle, mappings } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'mapping',
        title: 'Mapping',
        lastCapturedAt: 1,
      });
      mappings.patchSyncMapping(conversation.id, {
        feishuDocId: 'feishu-1',
        providerOpaque: { old: true },
        notionSections: { body: { digest: 'old', lastSyncedAt: 1 } },
      });
      mappings.patchSyncMapping(conversation.id, {
        providerOpaqueNew: ['new'],
        notionSections: { body: { digest: 'new' }, comments: { digest: 'comments' } },
      });
      mappings.setSyncCursor(conversation.id, {
        lastSyncedMessageKey: 'm9',
        lastSyncedSequence: 9,
        lastSyncedMessageUpdatedAt: 90,
        notionSectionDigests: { body: { digest: 'body' } },
      });
      const beforeClear = mappings.getSyncMappingByConversation(conversation.id)?.mapping as Record<string, unknown>;
      expect(beforeClear).toMatchObject({
        feishuDocId: 'feishu-1',
        providerOpaque: { old: true },
        providerOpaqueNew: ['new'],
        lastSyncedMessageKey: 'm9',
      });
      expect((beforeClear.notionSections as Record<string, any>).body).toMatchObject({
        digest: 'new',
        lastSyncedAt: 1,
      });
      expect((beforeClear.notionSections as Record<string, any>).comments).toMatchObject({ digest: 'comments' });
      expect(conversations.getConversationById(conversation.id)?.feishuDocId).toBe('feishu-1');

      mappings.clearSyncCursor(conversation.id);
      const cleared = mappings.getSyncMappingByConversation(conversation.id)?.mapping as Record<string, unknown>;
      expect(cleared).toMatchObject({
        lastSyncedMessageKey: '',
        lastSyncedSequence: null,
        lastSyncedAt: null,
        lastSyncedMessageUpdatedAt: null,
        providerOpaque: { old: true },
      });
      expect(cleared.notionSections).toEqual(beforeClear.notionSections);
    } finally {
      handle.close();
    }
  });

  it('uses stable references for message and mapping writes, rejecting a mismatched backend hint without a revision', async () => {
    const { conversations, database, handle, mappings, messages } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'stable-mapping',
        title: 'Stable mapping',
        lastCapturedAt: 1,
      });
      const reference = {
        source: 'chatgpt',
        conversationKey: 'stable-mapping',
        backendConversationId: conversation.id,
      };

      expect(
        conversations.syncConversationMessagesByReference(reference, [
          { messageKey: 'm1', role: 'assistant', contentText: 'one', sequence: 1 },
        ]),
      ).toEqual({ upserted: 1, deleted: 0 });
      expect(mappings.patchSyncMappingByReference(reference, { feishuDocId: 'feishu-stable' })).toBe(true);
      expect(mappings.setSyncCursorByReference(reference, { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 })).toBe(
        true,
      );
      expect(
        mappings.setConversationNotionPageIdByReference(reference, 'notion-stable', {
          notionPageUrl: 'https://notion.so/notion-stable',
        }),
      ).toBe(true);

      const beforeClear = mappings.getSyncMappingByConversation(conversation.id)?.mapping as Record<string, unknown>;
      expect(beforeClear).toMatchObject({
        feishuDocId: 'feishu-stable',
        notionPageId: 'notion-stable',
        lastSyncedMessageKey: 'm1',
      });
      expect(mappings.clearSyncCursorByReference(reference)).toBe(true);
      expect(mappings.getSyncMappingByConversation(conversation.id)?.mapping).toMatchObject({
        lastSyncedMessageKey: '',
        lastSyncedSequence: null,
      });
      expect(messages.getMessagesByConversationId(conversation.id).map((message) => message.messageKey)).toEqual([
        'm1',
      ]);

      const revisionBeforeStaleWrite = readFactsRevision(database);
      try {
        mappings.patchSyncMappingByReference(
          { ...reference, backendConversationId: conversation.id + 1 },
          { ignored: true },
        );
        throw new Error('expected stale reference');
      } catch (error) {
        expect(error).toMatchObject({ code: 'STALE_REFERENCE' });
      }
      expect(readFactsRevision(database)).toBe(revisionBeforeStaleWrite);
    } finally {
      handle.close();
    }
  });

  it('deletes mapping and messages with the conversation but leaves standalone facts to their own repositories', async () => {
    const { conversations, handle, mappings, messages } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'delete',
        title: 'Delete',
        lastCapturedAt: 1,
      });
      messages.syncConversationMessages(conversation.id, [
        { messageKey: 'm1', role: 'assistant', contentText: 'one', sequence: 1 },
      ]);
      mappings.setSyncCursor(conversation.id, { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 });
      expect(conversations.deleteConversationsByIds([conversation.id])).toEqual({
        deletedConversations: 1,
        deletedImageCache: 0,
        deletedMappings: 1,
        deletedMessages: 1,
      });
      expect(messages.getMessagesByConversationId(conversation.id)).toEqual([]);
      expect(mappings.getSyncMappingByConversation(conversation.id)).toBeNull();
    } finally {
      handle.close();
    }
  });
});
