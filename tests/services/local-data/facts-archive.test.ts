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
  encodeCanonicalJson,
  encodeMigrationFactRecord,
  mergeMigrationConversationPayload,
  mergeMigrationMessagePayload,
  mergeMigrationSyncMappingPayload,
  prepareMigrationImageFact,
  splitCanonicalJsonText,
  streamMigrationImageBytes,
  type MigrationImageByteSource,
  verifyMigrationCommentFact,
} from '@services/local-data/facts-archive';
import { sha256Hex } from '@services/local-data/digest';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';
import {
  LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD,
  createLocalDataMigrationFixture,
} from '../../helpers/local-data-migration-fixture';

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

async function collectMigrationImageBytes(source: MigrationImageByteSource): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const slice of streamMigrationImageBytes(source)) {
    chunks.push(slice);
    byteLength += slice.byteLength;
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

describe('local facts archive', () => {
  it('canonicalizes one JSON-compatible record with sorted keys, emoji-safe chunks, and exact decoding', () => {
    const canonical = encodeCanonicalJson({ z: '你好😀', a: { slash: '\\', quote: '"', nested: ['x', 1] } });
    expect(canonical.text).toBe('{"a":{"nested":["x",1],"quote":"\\\"","slash":"\\\\"},"z":"你好😀"}');
    const decoded = decodeCanonicalJson(canonical.bytes) as {
      a: { nested: readonly unknown[]; quote: string; slash: string };
      z: string;
    };
    expect(decoded).toEqual({
      a: { nested: ['x', 1], quote: '"', slash: '\\' },
      z: '你好😀',
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.a)).toBe(true);
    expect(Object.isFrozen(decoded.a.nested)).toBe(true);
    expect(Reflect.set(decoded.a, 'quote', 'changed')).toBe(false);
    expect(decoded.a.quote).toBe('"');

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
    const fixture = createLocalDataMigrationFixture();
    const conversationRow = fixture.rows.conversations[0]!;
    const messageRow = fixture.rows.messages[0]!;
    const mappingRow = fixture.rows.syncMappings[0]!;
    const conversation = createMigrationConversationFact({
      sourceLocalId: conversationRow.id,
      row: conversationRow,
    });
    const message = createMigrationMessageFact({
      sourceLocalId: messageRow.id,
      row: messageRow,
    });
    const mapping = createMigrationSyncMappingFact({
      sourceLocalId: mappingRow.id,
      row: mappingRow,
    });

    expect(conversation.sourceLocalId).toBe('10');
    expect(conversation.payload).not.toHaveProperty('id');
    expect((conversation.payload.unknownConversationField as { large: string }).large).toBe(
      LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD,
    );
    expect(Object.isFrozen(conversation.payload)).toBe(true);
    expect(Object.isFrozen(conversation.payload.unknownConversationField)).toBe(true);
    expect(encodeMigrationFactRecord(conversation).bytes.byteLength).toBeGreaterThan(512 * 1024);
    expect(message.conversationSourceLocalId).toBe('10');
    expect(message.payload).not.toHaveProperty('conversationId');
    expect(mapping.payload).toMatchObject({ opaqueMappingField: ['keep'] });
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
    const fixture = createLocalDataMigrationFixture();
    const rows = fixture.rows.imageCache;
    const expectedBytes = [
      fixture.assets.blobBytes,
      fixture.assets.base64Bytes,
      fixture.assets.viewBytes,
      fixture.assets.percentBytes,
      fixture.assets.base64Bytes,
    ];

    const prepared = rows.map((row) => prepareMigrationImageFact({ row, sourceLocalId: row.id }));
    for (const [index, item] of prepared.entries()) {
      expect(item.record.conversationSourceLocalId).toBe('10');
      expect(item.record.contentType).toBe('image/png');
      expect(item.record.byteLength).toBe(expectedBytes[index]!.byteLength);
      expect(item.record.payload).not.toHaveProperty('id');
      expect(item.record.payload).not.toHaveProperty('conversationId');
      expect(item.record.payload).not.toHaveProperty('blob');
      expect(item.record.payload).not.toHaveProperty('dataUrl');
      expect(await collectMigrationImageBytes(item.bytes)).toEqual(expectedBytes[index]);
      expect(await sha256Hex(nodeDigestProvider, await collectMigrationImageBytes(item.bytes))).toBe(
        await sha256Hex(nodeDigestProvider, expectedBytes[index]!),
      );
    }
    expect(prepared[0]!.record.payload).toMatchObject({ unknownImageField: { keep: true } });
    expect((prepared[3]!.record.payload.unknownImageField as { nested: string }).nested).toBe(
      LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD,
    );
  });

  it('streams data URL bytes in bounded Base64 and UTF-8-safe percent slices', async () => {
    const base64 = prepareMigrationImageFact({
      sourceLocalId: 6,
      row: {
        id: 6,
        conversationId: 10,
        url: 'https://example.com/base64-stream.png',
        dataUrl: 'data:image/png;base64,AQID\nBAU',
        contentType: 'image/png',
      },
    });
    const percentText = '你好😀'.repeat(8);
    const percent = prepareMigrationImageFact({
      sourceLocalId: 7,
      row: {
        id: 7,
        conversationId: 10,
        url: 'https://example.com/percent-stream.png',
        dataUrl: `data:image/png,${encodeURIComponent(percentText)}`,
        contentType: 'image/png',
      },
    });

    const base64Slices: Uint8Array[] = [];
    for await (const slice of streamMigrationImageBytes(base64.bytes, 4)) base64Slices.push(slice);
    expect(base64Slices.every((slice) => slice.byteLength <= 4)).toBe(true);
    expect(Uint8Array.from(base64Slices.flatMap((slice) => [...slice]))).toEqual(Uint8Array.from([1, 2, 3, 4, 5]));

    const percentSlices: Uint8Array[] = [];
    for await (const slice of streamMigrationImageBytes(percent.bytes, 7)) percentSlices.push(slice);
    expect(percentSlices.every((slice) => slice.byteLength <= 7)).toBe(true);
    expect(percentSlices.map((slice) => new TextDecoder('utf-8', { fatal: true }).decode(slice)).join('')).toBe(
      percentText,
    );
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
    const fixture = createLocalDataMigrationFixture();
    const [rootRow, replyRow] = fixture.rows.articleComments;
    const conversations = new Map([[10, { source: 'chatgpt', conversationKey: 'conversation-a' }]]);
    const occurrences = createMigrationCommentOccurrenceTracker();
    const root = await createMigrationCommentFact({
      sourceLocalId: rootRow!.id,
      row: rootRow,
      conversations,
      digestProvider: nodeDigestProvider,
      occurrenceTracker: occurrences,
    });
    const sibling = await createMigrationCommentFact({
      sourceLocalId: 52,
      row: { ...rootRow, id: 52 },
      conversations,
      digestProvider: nodeDigestProvider,
      occurrenceTracker: occurrences,
    });
    const reply = await createMigrationCommentFact({
      sourceLocalId: replyRow!.id,
      row: replyRow,
      conversations,
      digestProvider: nodeDigestProvider,
      parentRootStructuralDigest: root.archiveIdentity.rootStructuralDigest,
      occurrenceTracker: occurrences,
    });

    expect(root.archiveIdentity.occurrence).toBe(0);
    expect(sibling.archiveIdentity.occurrence).toBe(1);
    expect(reply.parentSourceLocalId).toBe('50');
    expect(reply.conversationSourceLocalId).toBe('10');
    expect(root.archiveIdentity.context).toEqual({
      canonicalUrl: 'https://example.com/article',
      conversation: conversations.get(10),
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
