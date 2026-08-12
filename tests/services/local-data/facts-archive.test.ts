import { describe, expect, it } from 'vitest';

import { MAX_MIGRATION_FACT_RECORD_BYTES, LocalDataContractError } from '@services/local-data/contracts';
import {
  MAX_CANONICAL_RECORD_JSON_CHUNK_BYTES,
  compareMigrationCommentFacts,
  createMigrationCommentFact,
  createMigrationCommentGraphValidator,
  createMigrationCommentOccurrenceTracker,
  createMigrationConversationFact,
  createMigrationFactReferenceValidator,
  createMigrationMessageFact,
  createMigrationSyncMappingFact,
  decodeCanonicalJson,
  decodeMigrationFactRecord,
  decideMigrationCommentMerge,
  digestMigrationImageBytes,
  encodeCanonicalJson,
  encodeMigrationFactRecord,
  materializeMigrationImageBytes,
  mergeMigrationConversationPayload,
  mergeMigrationMessagePayload,
  mergeMigrationSyncMappingPayload,
  prepareMigrationImageFact,
  splitCanonicalJsonText,
  verifyMigrationCommentFact,
} from '@services/local-data/facts-archive';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';

const conversationIdentities = new Map([
  [10, { source: 'web', conversationKey: 'article:https://example.com/a' }],
  [11, { source: 'web', conversationKey: 'article:https://example.com/b' }],
]);

function expectErrorCode(callback: () => unknown, code: LocalDataContractError['code']): void {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalDataContractError);
  expect((thrown as LocalDataContractError).code).toBe(code);
}

async function expectRejected(callback: () => Promise<unknown>, code: LocalDataContractError['code']): Promise<void> {
  let thrown: unknown;
  try {
    await callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalDataContractError);
  expect((thrown as LocalDataContractError).code).toBe(code);
}

function comment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    parentId: null,
    conversationId: 10,
    canonicalUrl: 'https://example.com/a',
    authorName: 'Chii',
    quoteText: 'quoted',
    commentText: 'comment',
    locator: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('local facts archive', () => {
  it('canonicalizes one JSON-compatible record with sorted keys, emoji-safe chunks, and exact decoding', () => {
    const canonical = encodeCanonicalJson({ z: '你好😀', a: { slash: '\\', quote: '"', nested: ['x', 1] } });
    expect(canonical.text).toBe('{"a":{"nested":["x",1],"quote":"\\\"","slash":"\\\\"},"z":"你好😀"}');
    expect(decodeCanonicalJson(canonical.bytes)).toEqual({
      a: { nested: ['x', 1], quote: '"', slash: '\\' },
      z: '你好😀',
    });

    const chunks = [...splitCanonicalJsonText(canonical, 9)];
    expect(chunks.join('')).toBe(canonical.text);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 9)).toBe(true);
    expect(MAX_CANONICAL_RECORD_JSON_CHUNK_BYTES).toBeLessThan(512 * 1024);

    expectErrorCode(
      () => decodeCanonicalJson(new TextEncoder().encode('{"z":1,"a":2}')),
      'MIGRATION_VALIDATION_FAILED',
    );
    expectErrorCode(() => encodeCanonicalJson({ bad: '\ud800' }), 'MIGRATION_VALIDATION_FAILED');
  });

  it('keeps unknown JSON fields while moving browser IDs into stream-local references', () => {
    const nested = 'x'.repeat(513 * 1024);
    const conversation = createMigrationConversationFact({
      sourceLocalId: 10,
      row: {
        id: 10,
        source: 'chatgpt',
        conversationKey: 'c1',
        title: '你好😀',
        unknown: { nested, flags: ['keep'] },
      },
    });
    const message = createMigrationMessageFact({
      sourceLocalId: 20,
      row: {
        id: 20,
        conversationId: 10,
        messageKey: 'm1',
        contentMarkdown: 'body',
        opaque: { locale: 'zh-CN' },
      },
    });
    const mapping = createMigrationSyncMappingFact({
      sourceLocalId: 30,
      row: { id: 30, source: 'chatgpt', conversationKey: 'c1', opaque: { local: true } },
    });

    expect(conversation.sourceLocalId).toBe('10');
    expect(conversation.payload).not.toHaveProperty('id');
    expect((conversation.payload.unknown as { nested: string }).nested).toBe(nested);
    expect(encodeMigrationFactRecord(conversation).bytes.byteLength).toBeGreaterThan(512 * 1024);
    expect(message.conversationSourceLocalId).toBe('10');
    expect(message.payload).not.toHaveProperty('conversationId');
    expect(mapping.payload).toMatchObject({ opaque: { local: true } });
    expect(decodeMigrationFactRecord(encodeMigrationFactRecord(message).bytes)).toEqual(message);
  });

  it('uses the existing conservative core and unions only non-conflicting opaque migration fields', () => {
    expect(
      mergeMigrationConversationPayload(
        { source: 'web', conversationKey: 'a', title: 'local', localOnly: 1, conflicting: 'local' },
        { source: 'web', conversationKey: 'a', title: 'remote', remoteOnly: 2, conflicting: 'remote' },
      ),
    ).toMatchObject({ title: 'local', localOnly: 1, remoteOnly: 2, conflicting: 'local' });
    expect(
      mergeMigrationMessagePayload(
        { messageKey: 'm', contentMarkdown: '', existingOnly: true },
        { messageKey: 'm', contentMarkdown: 'remote', incomingOnly: true },
      ),
    ).toMatchObject({ contentMarkdown: 'remote', existingOnly: true, incomingOnly: true });
    expect(
      mergeMigrationSyncMappingPayload(
        { source: 'web', conversationKey: 'a', notionPageId: 'local', existingOnly: true },
        { source: 'web', conversationKey: 'a', notionPageId: 'remote', incomingOnly: true },
      ),
    ).toMatchObject({ notionPageId: 'local', existingOnly: true, incomingOnly: true });
  });

  it('validates stream-local conversation references without retaining a full archive', () => {
    const validator = createMigrationFactReferenceValidator();
    const conversation = createMigrationConversationFact({
      sourceLocalId: 10,
      row: { id: 10, source: 'chatgpt', conversationKey: 'c1' },
    });
    const message = createMigrationMessageFact({
      sourceLocalId: 20,
      row: { id: 20, conversationId: 10, messageKey: 'm1' },
    });
    validator.add(conversation);
    validator.add(message);
    validator.finalize();

    const unknownOwner = createMigrationMessageFact({
      sourceLocalId: 21,
      row: { id: 21, conversationId: 999, messageKey: 'm2' },
    });
    expectErrorCode(() => validator.add(unknownOwner), 'MIGRATION_VALIDATION_FAILED');
  });

  it('normalizes Blob, data URL, ArrayBuffer, and view image sources without retaining legacy transport fields', async () => {
    const raw = new Uint8Array([0, 1, 2, 3, 255]);
    const rows = [
      {
        id: 1,
        conversationId: 10,
        url: 'https://example.com/blob.png',
        blob: new Blob([raw], { type: 'image/png' }),
        contentType: 'image/png',
        dataUrl: 'data:image/png;base64,AAECA/8=',
        unknown: { keep: true },
      },
      {
        id: 2,
        conversationId: 10,
        url: 'https://example.com/data.png',
        dataUrl: 'data:image/png;base64,AAECA/8=',
        contentType: 'image/png',
      },
      {
        id: 3,
        conversationId: 10,
        url: 'https://example.com/buffer.png',
        blob: raw.buffer.slice(0),
        contentType: 'image/png',
      },
      {
        id: 4,
        conversationId: 10,
        url: 'https://example.com/view.png',
        blob: new Uint8Array([9, ...raw, 8]).subarray(1, raw.byteLength + 1),
        contentType: 'image/png',
      },
    ];

    const prepared = rows.map((row) => prepareMigrationImageFact({ row, sourceLocalId: row.id }));
    for (const item of prepared) {
      expect(item.record.conversationSourceLocalId).toBe('10');
      expect(item.record.contentType).toBe('image/png');
      expect(item.record.byteLength).toBe(raw.byteLength);
      expect(item.record.payload).not.toHaveProperty('id');
      expect(item.record.payload).not.toHaveProperty('conversationId');
      expect(item.record.payload).not.toHaveProperty('blob');
      expect(item.record.payload).not.toHaveProperty('dataUrl');
      expect(await materializeMigrationImageBytes(item.bytes)).toEqual(raw);
      expect(await digestMigrationImageBytes(item.bytes, nodeDigestProvider)).toBe(
        await digestMigrationImageBytes(prepared[0]!.bytes, nodeDigestProvider),
      );
    }
    expect(prepared[0]!.record.payload).toMatchObject({ unknown: { keep: true } });

    const percentEncoded = prepareMigrationImageFact({
      sourceLocalId: 5,
      row: {
        id: 5,
        conversationId: 10,
        url: 'https://example.com/percent.png',
        dataUrl: 'data:image/png,%E4%BD%A0%E5%A5%BD',
        contentType: 'image/png',
        unknown: { nested: 'x'.repeat(513 * 1024) },
      },
    });
    expect(await materializeMigrationImageBytes(percentEncoded.bytes)).toEqual(new TextEncoder().encode('你好'));
    expect((percentEncoded.record.payload.unknown as { nested: string }).nested).toHaveLength(513 * 1024);
  });

  it('accepts one image exactly at the 64 MiB migration ceiling without creating an archive array', () => {
    const bytes = new ArrayBuffer(MAX_MIGRATION_FACT_RECORD_BYTES);
    const prepared = prepareMigrationImageFact({
      sourceLocalId: 44,
      row: {
        id: 44,
        conversationId: 10,
        url: 'https://example.com/limit.png',
        blob: bytes,
        contentType: 'image/png',
      },
    });
    expect(prepared.record.byteLength).toBe(MAX_MIGRATION_FACT_RECORD_BYTES);
    expect(prepared.bytes.kind).toBe('view');
  });

  it('creates versioned comment identities, preserves sibling occurrence and validates the cross-profile parent graph', async () => {
    const occurrences = createMigrationCommentOccurrenceTracker();
    const root = await createMigrationCommentFact({
      sourceLocalId: 1,
      row: comment(),
      conversations: conversationIdentities,
      digestProvider: nodeDigestProvider,
      occurrenceTracker: occurrences,
    });
    const sibling = await createMigrationCommentFact({
      sourceLocalId: 2,
      row: comment({ id: 2 }),
      conversations: conversationIdentities,
      digestProvider: nodeDigestProvider,
      occurrenceTracker: occurrences,
    });
    const reply = await createMigrationCommentFact({
      sourceLocalId: 3,
      row: comment({ id: 3, parentId: 1, commentText: 'reply' }),
      conversations: conversationIdentities,
      digestProvider: nodeDigestProvider,
      parentRootStructuralDigest: root.archiveIdentity.rootStructuralDigest,
      occurrenceTracker: occurrences,
    });

    expect(root.archiveIdentity.occurrence).toBe(0);
    expect(sibling.archiveIdentity.occurrence).toBe(1);
    expect(reply.parentSourceLocalId).toBe('1');
    expect(reply.conversationSourceLocalId).toBe('10');
    expect(root.archiveIdentity.context).toEqual({
      canonicalUrl: 'https://example.com/a',
      conversation: conversationIdentities.get(10),
    });
    expect(compareMigrationCommentFacts(root, sibling)).toBeLessThan(0);
    await verifyMigrationCommentFact(reply, nodeDigestProvider);

    const graph = createMigrationCommentGraphValidator();
    graph.add(root);
    graph.add(sibling);
    graph.add(reply);
    graph.finalize();

    await expectRejected(
      () =>
        verifyMigrationCommentFact(
          { ...root, archiveIdentity: { ...root.archiveIdentity, structuralDigest: '0'.repeat(64) } },
          nodeDigestProvider,
        ),
      'MIGRATION_VALIDATION_FAILED',
    );
  });

  it('fails closed for invalid comment locators, impossible parents, and ambiguous comment groups', async () => {
    await expectRejected(
      () =>
        createMigrationCommentFact({
          sourceLocalId: 1,
          row: comment({ locator: { v: 99 } }),
          conversations: conversationIdentities,
          digestProvider: nodeDigestProvider,
        }),
      'MIGRATION_VALIDATION_FAILED',
    );

    const root = await createMigrationCommentFact({
      sourceLocalId: 1,
      row: comment(),
      conversations: conversationIdentities,
      digestProvider: nodeDigestProvider,
    });
    const nestedReply = await createMigrationCommentFact({
      sourceLocalId: 2,
      row: comment({ id: 2, parentId: 1, commentText: 'reply' }),
      conversations: conversationIdentities,
      digestProvider: nodeDigestProvider,
      parentRootStructuralDigest: root.archiveIdentity.rootStructuralDigest,
    });
    const invalidNestedReply = await createMigrationCommentFact({
      sourceLocalId: 3,
      row: comment({ id: 3, parentId: 2, commentText: 'nested reply' }),
      conversations: conversationIdentities,
      digestProvider: nodeDigestProvider,
      parentRootStructuralDigest: root.archiveIdentity.rootStructuralDigest,
    });
    const graph = createMigrationCommentGraphValidator();
    graph.add(root);
    graph.add(nestedReply);
    graph.add(invalidNestedReply);
    expectErrorCode(() => graph.finalize(), 'MIGRATION_VALIDATION_FAILED');

    expect(decideMigrationCommentMerge({ incomingGroupCount: 1, targetGroupCount: 1 })).toEqual({
      action: 'merge',
      diagnostic: null,
    });
    expect(decideMigrationCommentMerge({ incomingGroupCount: 2, targetGroupCount: 1 })).toMatchObject({
      action: 'insert',
      diagnostic: { code: 'ambiguous_comment_signature' },
    });
    expect(decideMigrationCommentMerge({ incomingGroupCount: 1, targetGroupCount: 0 })).toEqual({
      action: 'insert',
      diagnostic: null,
    });
  });
});
