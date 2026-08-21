import { describe, expect, it } from 'vitest';

import { mergeSyncMappingForImport, stripSyncMappingLocalId } from '@platform/idb/sync-mapping-record';

function notionState(input: {
  pageId: string;
  syncedAt?: number;
  key: string;
  sequence: number;
  heading: string;
  digest: string;
}) {
  return {
    notionPageId: input.pageId,
    notionPageUrl: `https://notion.so/${input.pageId}`,
    notionWorkspaceSlug: `ws-${input.pageId}`,
    lastSyncedMessageKey: input.key,
    lastSyncedSequence: input.sequence,
    ...(input.syncedAt == null ? {} : { lastSyncedAt: input.syncedAt }),
    lastSyncedMessageUpdatedAt: input.sequence * 10,
    notionSections: { conversations: { headingBlockId: input.heading } },
    notionSectionCursors: {
      conversations: {
        lastSyncedMessageKey: input.key,
        lastSyncedSequence: input.sequence,
        lastSyncedMessageUpdatedAt: input.sequence * 10,
      },
    },
    notionSectionDigests: { article: { digest: input.digest, lastSyncedAt: input.syncedAt ?? 0 } },
  };
}

describe('sync mapping persistence record', () => {
  it('strips only the browser-local id without mutating the source', () => {
    const source = { id: 7, source: 'chatgpt', conversationKey: 'c1', nested: { value: 1 } };
    const stripped = stripSyncMappingLocalId(source);

    expect(stripped).toEqual({ source: 'chatgpt', conversationKey: 'c1', nested: { value: 1 } });
    expect(source.id).toBe(7);
  });

  it('fresh import preserves complete provider continuity and unknown metadata', () => {
    const incoming = {
      id: 99,
      source: 'chatgpt',
      conversationKey: 'c1',
      ...notionState({ pageId: 'page-a', syncedAt: 100, key: 'm2', sequence: 2, heading: 'h-a', digest: 'd-a' }),
      feishuDocId: 'doc-a',
      feishuLastContentHash: 'hash-a',
      futureProviderMetadata: { opaque: true },
      updatedAt: 200,
    };

    const merged = mergeSyncMappingForImport(null, incoming);

    expect(merged).toMatchObject({
      notionPageId: 'page-a',
      notionSections: { conversations: { headingBlockId: 'h-a' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm2', lastSyncedSequence: 2 } },
      notionSectionDigests: { article: { digest: 'd-a' } },
      feishuDocId: 'doc-a',
      feishuLastContentHash: 'hash-a',
      futureProviderMetadata: { opaque: true },
    });
    expect(merged.id).toBeUndefined();
  });

  it('same Notion page uses the later lastSyncedAt as one complete snapshot', () => {
    const local = {
      ...notionState({ pageId: 'page-a', syncedAt: 300, key: 'local', sequence: 3, heading: 'h-local', digest: 'd-local' }),
      updatedAt: 1,
    };
    const incoming = {
      ...notionState({ pageId: 'page-a', syncedAt: 200, key: 'incoming', sequence: 9, heading: 'h-in', digest: 'd-in' }),
      updatedAt: 999,
    };

    const merged = mergeSyncMappingForImport(local, incoming);

    expect(merged.notionPageId).toBe('page-a');
    expect(merged.lastSyncedMessageKey).toBe('local');
    expect(merged.lastSyncedSequence).toBe(3);
    expect(merged.notionSections).toEqual({ conversations: { headingBlockId: 'h-local' } });
    expect(merged.notionSectionDigests).toEqual({ article: { digest: 'd-local', lastSyncedAt: 300 } });
    expect(merged.updatedAt).toBe(999);
  });

  it('same Notion page uses incoming as the stable tie-break when time is equal or missing', () => {
    const local = notionState({ pageId: 'page-a', syncedAt: 100, key: 'local', sequence: 1, heading: 'h-local', digest: 'd-local' });
    const incomingEqual = notionState({
      pageId: 'page-a',
      syncedAt: 100,
      key: 'incoming-equal',
      sequence: 2,
      heading: 'h-equal',
      digest: 'd-equal',
    });
    const incomingMissing = notionState({
      pageId: 'page-a',
      key: 'incoming-missing',
      sequence: 3,
      heading: 'h-missing',
      digest: 'd-missing',
    });

    expect(mergeSyncMappingForImport(local, incomingEqual).lastSyncedMessageKey).toBe('incoming-equal');
    const missingMerged = mergeSyncMappingForImport(local, incomingMissing);
    expect(missingMerged.lastSyncedMessageKey).toBe('incoming-missing');
    expect(missingMerged.notionSections).toEqual({ conversations: { headingBlockId: 'h-missing' } });
  });

  it('different Notion pages keep the complete local provider state', () => {
    const local = notionState({ pageId: 'page-local', syncedAt: 100, key: 'local', sequence: 1, heading: 'h-local', digest: 'd-local' });
    const incoming = notionState({
      pageId: 'page-incoming',
      syncedAt: 999,
      key: 'incoming',
      sequence: 9,
      heading: 'h-incoming',
      digest: 'd-incoming',
    });

    const merged = mergeSyncMappingForImport(local, incoming);

    expect(merged.notionPageId).toBe('page-local');
    expect(merged.lastSyncedMessageKey).toBe('local');
    expect(merged.lastSyncedSequence).toBe(1);
    expect(merged.notionSections).toEqual({ conversations: { headingBlockId: 'h-local' } });
    expect(merged.notionSectionCursors).toEqual(local.notionSectionCursors);
    expect(merged.notionSectionDigests).toEqual(local.notionSectionDigests);
  });

  it('keeps Feishu doc/hash atomic across same and different targets', () => {
    const local = { feishuDocId: 'doc-local', feishuLastContentHash: 'hash-local' };

    expect(
      mergeSyncMappingForImport(local, { feishuDocId: 'doc-local', feishuLastContentHash: 'hash-incoming' }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-incoming' });

    expect(
      mergeSyncMappingForImport(local, { feishuDocId: 'doc-other', feishuLastContentHash: 'hash-other' }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-local' });

    expect(
      mergeSyncMappingForImport({}, { feishuDocId: 'doc-incoming', feishuLastContentHash: 'hash-incoming' }),
    ).toMatchObject({ feishuDocId: 'doc-incoming', feishuLastContentHash: 'hash-incoming' });
  });

  it('keeps local unknown metadata and only fills missing unknown keys from incoming', () => {
    const merged = mergeSyncMappingForImport(
      { custom: 'local', localOnly: 1 },
      { custom: 'incoming', incomingOnly: 2 },
    );

    expect(merged.custom).toBe('local');
    expect(merged.localOnly).toBe(1);
    expect(merged.incomingOnly).toBe(2);
  });

  it('does not mutate either input while replacing provider groups', () => {
    const local = {
      id: 1,
      ...notionState({ pageId: 'page-a', syncedAt: 10, key: 'local', sequence: 1, heading: 'h-local', digest: 'd-local' }),
    };
    const incoming = {
      id: 2,
      ...notionState({ pageId: 'page-a', syncedAt: 20, key: 'incoming', sequence: 2, heading: 'h-in', digest: 'd-in' }),
    };
    const localBefore = structuredClone(local);
    const incomingBefore = structuredClone(incoming);

    mergeSyncMappingForImport(local, incoming);

    expect(local).toEqual(localBefore);
    expect(incoming).toEqual(incomingBefore);
  });
});
