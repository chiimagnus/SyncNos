import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  normalizeSearchQuery,
} from '@services/local-data/contracts';
import {
  createMigrationCommentFact,
  createMigrationConversationFact,
  createMigrationMessageFact,
  createMigrationSyncMappingFact,
  encodeMigrationFactRecord,
  prepareMigrationImageFact,
  type MigrationFactRecord,
} from '@services/local-data/facts-archive';
import { FactsManifestAccumulator, type FactStreamKind } from '@services/local-data/facts-manifest';
import { OrderedFrameDigestAccumulator, sha256Hex } from '@services/local-data/digest';
import { createNativeWireDataFrame, createNativeWireRecordJsonFrame } from '@services/local-data/native-wire';
import {
  createStagedFactsImporter,
  getFactsMigrationReceipt,
  type StagedFactsImporter,
} from '../../packages/syncnoscli/src/sqlite/archive-import';
import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import { createImagesRepository } from '../../packages/syncnoscli/src/sqlite/images-repository';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { readFactsRevision } from '../../packages/syncnoscli/src/sqlite/revision';
import { createSearchRepository } from '../../packages/syncnoscli/src/sqlite/search';
import { nodeDigestProvider } from '../../packages/syncnoscli/src/runtime/node-digest';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

type Emission = Readonly<{
  addFact: (kind: FactStreamKind) => void;
  appendFrame: (input: Readonly<{ byteLength: number; digest: string; kind: FactStreamKind }>) => Promise<void>;
  finalize: () => ReturnType<FactsManifestAccumulator['finalize']>;
}>;

async function openDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-archive-import-'));
  temporaryRoots.push(root);
  return await openReadWriteForHost({ paths: resolveSyncNosRuntimePaths({ homeDirectory: root }) });
}

async function createEmission(migrationId: string): Promise<Emission> {
  const manifest = await FactsManifestAccumulator.create({ migrationId, provider: nodeDigestProvider });
  let sequence = 0;
  return Object.freeze({
    addFact: (kind) => manifest.addFact(kind),
    appendFrame: async ({ byteLength, digest, kind }) => {
      await manifest.appendFrame({ byteLength, digest, kind, manifestSequence: sequence++ });
    },
    finalize: () => manifest.finalize(),
  });
}

function splitBytes(bytes: Uint8Array, chunkBytes = 128 * 1024): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    chunks.push(bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkBytes)));
  }
  return chunks;
}

async function emitRecord(
  importer: StagedFactsImporter,
  emission: Emission,
  record: MigrationFactRecord,
  chunks = splitBytes(encodeMigrationFactRecord(record).bytes),
): Promise<void> {
  const canonical = encodeMigrationFactRecord(record);
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  expect(byteLength).toBe(canonical.bytes.byteLength);
  const sessionId = randomUUID();
  const recordDigest = await sha256Hex(nodeDigestProvider, canonical.bytes);
  const sessionDigest = await OrderedFrameDigestAccumulator.create(nodeDigestProvider);
  let offset = 0;
  let sequence = 0;
  emission.addFact(record.kind);
  await importer.acceptFrame({
    declaredTotalBytes: canonical.bytes.byteLength,
    operation: 'migration-fact-record',
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence: sequence++,
    sessionId,
    type: 'begin',
  });
  await importer.acceptFrame({
    byteLength: canonical.bytes.byteLength,
    digest: recordDigest,
    kind: record.kind,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence: sequence++,
    sessionId,
    sourceLocalId: record.sourceLocalId,
    type: 'record-begin',
  });
  for (const chunk of chunks) {
    const frame = await createNativeWireRecordJsonFrame({
      bytes: chunk,
      offset,
      provider: nodeDigestProvider,
      sequence,
      sessionId,
    });
    await sessionDigest.append({ byteLength: chunk.byteLength, digest: frame.chunkDigest, sequence });
    await emission.appendFrame({ byteLength: chunk.byteLength, digest: frame.chunkDigest, kind: record.kind });
    await importer.acceptFrame(frame);
    offset += chunk.byteLength;
    sequence += 1;
  }
  await importer.acceptFrame({
    digest: recordDigest,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence: sequence++,
    sessionId,
    type: 'record-end',
  });
  await importer.acceptFrame({
    digest: sessionDigest.finalize(),
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence: sequence++,
    sessionId,
    type: 'end',
  });
  await importer.acceptFrame({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence,
    sessionId,
    status: 'ok',
    type: 'terminal',
  });
}

async function emitImage(
  importer: StagedFactsImporter,
  emission: Emission,
  bytes: Uint8Array,
  chunks = splitBytes(bytes),
): Promise<void> {
  const sessionId = randomUUID();
  const sessionDigest = await OrderedFrameDigestAccumulator.create(nodeDigestProvider);
  let offset = 0;
  let sequence = 0;
  await importer.acceptFrame({
    declaredTotalBytes: bytes.byteLength,
    operation: 'migration-image-asset',
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence: sequence++,
    sessionId,
    type: 'begin',
  });
  for (const chunk of chunks) {
    const frame = await createNativeWireDataFrame({
      bytes: chunk,
      offset,
      provider: nodeDigestProvider,
      sequence,
      sessionId,
    });
    await sessionDigest.append({ byteLength: chunk.byteLength, digest: frame.sliceDigest, sequence });
    await emission.appendFrame({ byteLength: chunk.byteLength, digest: frame.sliceDigest, kind: 'image_cache' });
    await importer.acceptFrame(frame);
    offset += chunk.byteLength;
    sequence += 1;
  }
  await importer.acceptFrame({
    digest: sessionDigest.finalize(),
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence: sequence++,
    sessionId,
    type: 'end',
  });
  await importer.acceptFrame({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sequence,
    sessionId,
    status: 'ok',
    type: 'terminal',
  });
}

async function importerFor(database: Parameters<typeof createStagedFactsImporter>[0]['database'], migrationId: string) {
  return await createStagedFactsImporter({
    database,
    request: {
      migrationId,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    },
  });
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SQLite staged facts import', () => {
  it('imports P1 facts in order, remaps image URLs and comment graphs, and makes a receipt idempotent', async () => {
    const handle = await openDatabase();
    try {
      const migrationId = randomUUID();
      const importer = await importerFor(handle.database, migrationId);
      const emission = await createEmission(migrationId);
      const articleUrl = 'https://example.com/article';
      const conversation = createMigrationConversationFact({
        row: {
          conversationKey: `article:${articleUrl}`,
          futureConversationField: { source: 'first-browser' },
          id: 1,
          lastCapturedAt: 10,
          source: 'web',
          sourceType: 'article',
          title: 'Article',
          url: articleUrl,
        },
        sourceLocalId: 1,
      });
      const mapping = createMigrationSyncMappingFact({
        row: {
          conversationKey: `article:${articleUrl}`,
          futureMappingField: 'preserved',
          id: 2,
          lastSyncedMessageKey: 'message-a',
          source: 'web',
          updatedAt: 11,
        },
        sourceLocalId: 2,
      });
      const message = createMigrationMessageFact({
        row: {
          contentMarkdown: '![asset](syncnos-asset://4)',
          contentText: 'asset',
          conversationId: 1,
          futureMessageField: 'preserved',
          id: 3,
          messageKey: 'message-a',
          role: 'assistant',
          sequence: 0,
          updatedAt: 12,
        },
        sourceLocalId: 3,
      });
      const imageBytes = Uint8Array.from([1, 2, 3, 4]);
      const image = prepareMigrationImageFact({
        row: {
          blob: imageBytes,
          contentType: 'image/png',
          conversationId: 1,
          futureImageField: 'preserved',
          id: 4,
          url: 'https://example.com/asset.png',
        },
        sourceLocalId: 4,
      });
      const root = await createMigrationCommentFact({
        conversations: new Map([[1, { conversationKey: `article:${articleUrl}`, source: 'web' }]]),
        digestProvider: nodeDigestProvider,
        row: {
          authorName: null,
          canonicalUrl: articleUrl,
          commentText: 'root',
          conversationId: 1,
          createdAt: 0,
          futureCommentField: 'preserved',
          id: 5,
          locator: null,
          quoteText: '',
          updatedAt: 0,
        },
        sourceLocalId: 5,
      });
      const reply = await createMigrationCommentFact({
        conversations: new Map([[1, { conversationKey: `article:${articleUrl}`, source: 'web' }]]),
        digestProvider: nodeDigestProvider,
        parentRootStructuralDigest: root.archiveIdentity.rootStructuralDigest,
        row: {
          authorName: null,
          canonicalUrl: articleUrl,
          commentText: 'reply',
          conversationId: 1,
          createdAt: 0,
          id: 6,
          locator: null,
          parentId: 5,
          quoteText: '',
          updatedAt: 0,
        },
        sourceLocalId: 6,
      });

      await emitRecord(importer, emission, conversation);
      await emitRecord(importer, emission, mapping);
      await emitRecord(importer, emission, message);
      await emitRecord(importer, emission, image.record);
      await emitImage(importer, emission, imageBytes);
      await emitRecord(importer, emission, root);
      await emitRecord(importer, emission, reply);

      const result = await importer.complete(emission.finalize());
      expect(result).toMatchObject({
        alreadyCommitted: false,
        factCounts: {
          article_comments: 2,
          conversations: 1,
          image_cache: 1,
          messages: 1,
          sync_mappings: 1,
        },
        factsRevision: 1,
      });
      expect(getFactsMigrationReceipt(handle.database, migrationId)).toMatchObject({
        alreadyCommitted: true,
        factsRevision: 1,
        migrationId,
      });
      expect(getFactsMigrationReceipt(handle.database, randomUUID())).toBeNull();
      const imageRow = handle.database.prepare('SELECT id FROM image_cache').get() as { id: number };
      const messageRow = handle.database.prepare('SELECT content_markdown, payload_json FROM messages').get() as {
        content_markdown: string;
        payload_json: string;
      };
      expect(messageRow.content_markdown).toBe(`![asset](syncnos-asset://${imageRow.id})`);
      expect(messageRow.payload_json).toContain('futureMessageField');
      expect(
        createSearchRepository(handle.database)
          .searchConversations({ query: normalizeSearchQuery('asset') })
          .items.map((item) => item.conversationKey),
      ).toEqual([`article:${articleUrl}`]);
      expect(handle.database.prepare('SELECT payload_json FROM conversations').get()).toMatchObject({
        payload_json: expect.stringContaining('futureConversationField'),
      });
      const comments = handle.database
        .prepare('SELECT id, parent_comment_id, created_at, payload_json FROM article_comments ORDER BY id ASC')
        .all() as Array<{ created_at: number; id: number; parent_comment_id: number | null; payload_json: string }>;
      expect(comments).toHaveLength(2);
      expect(comments[0]).toMatchObject({ created_at: 0, parent_comment_id: null });
      expect(comments[1]?.parent_comment_id).toBe(comments[0]?.id);
      expect(comments[0]?.payload_json).toContain('futureCommentField');

      importer.cleanup();
      const duplicate = await importerFor(handle.database, migrationId);
      const duplicateEmission = await createEmission(migrationId);
      await emitRecord(duplicate, duplicateEmission, conversation);
      await emitRecord(duplicate, duplicateEmission, mapping);
      await emitRecord(duplicate, duplicateEmission, message);
      await emitRecord(duplicate, duplicateEmission, image.record);
      await emitImage(duplicate, duplicateEmission, imageBytes);
      await emitRecord(duplicate, duplicateEmission, root);
      await emitRecord(duplicate, duplicateEmission, reply);
      expect(await duplicate.complete(duplicateEmission.finalize())).toMatchObject({
        alreadyCommitted: true,
        factsRevision: 1,
      });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM article_comments').get()).toEqual({ count: 2 });
      duplicate.cleanup();

      const mismatch = await importerFor(handle.database, migrationId);
      const mismatchEmission = await createEmission(migrationId);
      await emitRecord(
        mismatch,
        mismatchEmission,
        createMigrationConversationFact({
          row: {
            conversationKey: `article:${articleUrl}`,
            id: 1,
            lastCapturedAt: 10,
            source: 'web',
            sourceType: 'article',
            title: 'Changed archive',
            url: articleUrl,
          },
          sourceLocalId: 1,
        }),
      );
      await expectRejected(() => mismatch.complete(mismatchEmission.finalize()), 'MIGRATION_RECEIPT_MISMATCH');
      mismatch.cleanup();
    } finally {
      handle.close();
    }
  });

  it('commits facts, mappings, receipt, and revision when only the derived FTS rebuild fails', async () => {
    const handle = await openDatabase();
    try {
      const migrationId = randomUUID();
      const importer = await importerFor(handle.database, migrationId);
      const emission = await createEmission(migrationId);
      const conversation = createMigrationConversationFact({
        row: {
          conversationKey: 'fts-import-failure',
          id: 1,
          lastCapturedAt: 1,
          source: 'chatgpt',
          sourceType: 'chat',
          title: 'Imported while FTS is unavailable',
        },
        sourceLocalId: 1,
      });
      const mapping = createMigrationSyncMappingFact({
        row: {
          conversationKey: 'fts-import-failure',
          id: 2,
          notionPageId: 'mapping-survives',
          source: 'chatgpt',
          updatedAt: 1,
        },
        sourceLocalId: 2,
      });
      await emitRecord(importer, emission, conversation);
      await emitRecord(importer, emission, mapping);

      const originalPrepare = handle.database.prepare.bind(handle.database);
      const ftsFailure = vi.spyOn(handle.database, 'prepare').mockImplementation(((sql: string) => {
        if (sql.includes('INSERT INTO conversation_fts')) {
          throw Object.assign(new Error('fts rebuild failed'), { code: 'SQLITE_ERROR' });
        }
        return originalPrepare(sql);
      }) as typeof handle.database.prepare);
      let result: Awaited<ReturnType<StagedFactsImporter['complete']>>;
      try {
        result = await importer.complete(emission.finalize());
      } finally {
        ftsFailure.mockRestore();
      }

      expect(result!).toMatchObject({ alreadyCommitted: false, factsRevision: 1 });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toEqual({ count: 1 });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM sync_mappings').get()).toEqual({ count: 1 });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM migration_receipts').get()).toEqual({ count: 1 });
      expect(readFactsRevision(handle.database)).toBe(1);
      expect(handle.database.prepare("SELECT value FROM meta WHERE key = 'fts_status'").get()).toEqual({
        value: 'unavailable',
      });
      expect(handle.database.prepare("SELECT value FROM meta WHERE key = 'fts_index_status'").get()).toEqual({
        value: 'needs-rebuild',
      });
      importer.cleanup();
    } finally {
      handle.close();
    }
  });

  it('accepts a large record split inside an emoji UTF-8 sequence without materializing an archive', async () => {
    const handle = await openDatabase();
    try {
      const migrationId = randomUUID();
      const importer = await importerFor(handle.database, migrationId);
      const emission = await createEmission(migrationId);
      const title = `before-${'😀'.repeat(140_000)}-after`;
      const record = createMigrationConversationFact({
        row: { conversationKey: 'large', id: 1, source: 'web', title },
        sourceLocalId: 1,
      });
      const bytes = encodeMigrationFactRecord(record).bytes;
      expect(bytes.byteLength).toBeGreaterThan(512 * 1024);
      const emojiStart = bytes.findIndex((value, index) => value === 0xf0 && bytes[index + 1] === 0x9f);
      expect(emojiStart).toBeGreaterThan(0);
      const chunks = [bytes.slice(0, emojiStart + 2), ...splitBytes(bytes.slice(emojiStart + 2))];
      await emitRecord(importer, emission, record, chunks);
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM staging_records').get()).toEqual({ count: 1 });
      await importer.complete(emission.finalize());
      expect(handle.database.prepare('SELECT title FROM conversations').get()).toEqual({ title });
      importer.cleanup();
    } finally {
      handle.close();
    }
  });

  it('keeps ambiguous comment siblings and records a bounded diagnostic instead of collapsing them', async () => {
    const handle = await openDatabase();
    try {
      const articleUrl = 'https://example.com/comments';
      const conversations = new Map([[1, { conversationKey: `article:${articleUrl}`, source: 'web' }]]);
      const conversation = createMigrationConversationFact({
        row: { conversationKey: `article:${articleUrl}`, id: 1, source: 'web', sourceType: 'article', url: articleUrl },
        sourceLocalId: 1,
      });
      const root = async (id: number) =>
        await createMigrationCommentFact({
          conversations,
          digestProvider: nodeDigestProvider,
          row: {
            authorName: null,
            canonicalUrl: articleUrl,
            commentText: 'same text',
            conversationId: 1,
            createdAt: 0,
            id,
            locator: null,
            quoteText: '',
            updatedAt: 0,
          },
          sourceLocalId: id,
        });

      const firstMigrationId = randomUUID();
      const first = await importerFor(handle.database, firstMigrationId);
      const firstEmission = await createEmission(firstMigrationId);
      await emitRecord(first, firstEmission, conversation);
      await emitRecord(first, firstEmission, await root(2));
      await first.complete(firstEmission.finalize());
      first.cleanup();

      const secondMigrationId = randomUUID();
      const second = await importerFor(handle.database, secondMigrationId);
      const secondEmission = await createEmission(secondMigrationId);
      await emitRecord(second, secondEmission, conversation);
      await emitRecord(second, secondEmission, await root(2));
      await emitRecord(second, secondEmission, await root(3));
      expect(await second.complete(secondEmission.finalize())).toMatchObject({
        commentAmbiguity: {
          groupCount: 1,
          samples: [{ code: 'ambiguous_comment_signature', incomingGroupCount: 2, targetGroupCount: 1 }],
        },
      });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM article_comments').get()).toEqual({ count: 3 });
      second.cleanup();
    } finally {
      handle.close();
    }
  });

  it('never rewrites an existing message body when P1 merge keeps it over an older imported message', async () => {
    const handle = await openDatabase();
    try {
      const conversations = createConversationsRepository(handle.database);
      const images = createImagesRepository(handle.database);
      const messages = createMessagesRepository(handle.database);
      const articleUrl = 'https://example.com/existing-message';
      const localConversation = conversations.upsertConversation({
        conversationKey: `article:${articleUrl}`,
        lastCapturedAt: 100,
        source: 'web',
        sourceType: 'article',
        url: articleUrl,
      });
      const localAsset = await images.putImageAsset({
        bytes: Uint8Array.of(1),
        contentType: 'image/png',
        conversationId: localConversation.id,
        url: 'https://example.com/local.png',
      });
      messages.syncConversationMessages(localConversation.id, [
        {
          contentMarkdown: `![local](syncnos-asset://${localAsset.id})`,
          contentText: 'local',
          messageKey: 'same-message',
          role: 'assistant',
          sequence: 0,
          updatedAt: 100,
        },
      ]);

      const migrationId = randomUUID();
      const importer = await importerFor(handle.database, migrationId);
      const emission = await createEmission(migrationId);
      const conversation = createMigrationConversationFact({
        row: {
          conversationKey: `article:${articleUrl}`,
          id: 1,
          lastCapturedAt: 1,
          source: 'web',
          sourceType: 'article',
          url: articleUrl,
        },
        sourceLocalId: 1,
      });
      const message = createMigrationMessageFact({
        row: {
          contentMarkdown: '![old](syncnos-asset://3)',
          contentText: 'old',
          conversationId: 1,
          id: 2,
          messageKey: 'same-message',
          role: 'assistant',
          sequence: 0,
          updatedAt: 1,
        },
        sourceLocalId: 2,
      });
      const importedImage = prepareMigrationImageFact({
        row: {
          blob: Uint8Array.of(9),
          contentType: 'image/png',
          conversationId: 1,
          id: 3,
          url: 'https://example.com/imported.png',
        },
        sourceLocalId: 3,
      });
      await emitRecord(importer, emission, conversation);
      await emitRecord(importer, emission, message);
      await emitRecord(importer, emission, importedImage.record);
      await emitImage(importer, emission, Uint8Array.of(9));
      await importer.complete(emission.finalize());
      expect(handle.database.prepare('SELECT content_markdown FROM messages').get()).toEqual({
        content_markdown: `![local](syncnos-asset://${localAsset.id})`,
      });
      importer.cleanup();
    } finally {
      handle.close();
    }
  });

  it('moves a mapping onto the imported conversation identity after article canonicalization', async () => {
    const handle = await openDatabase();
    try {
      const migrationId = randomUUID();
      const importer = await importerFor(handle.database, migrationId);
      const emission = await createEmission(migrationId);
      const legacyUrl = 'https://example.com/mapped#fragment';
      const canonicalUrl = 'https://example.com/mapped';
      await emitRecord(
        importer,
        emission,
        createMigrationConversationFact({
          row: {
            conversationKey: `article:${legacyUrl}`,
            id: 1,
            source: 'web',
            sourceType: 'article',
            url: legacyUrl,
          },
          sourceLocalId: 1,
        }),
      );
      await emitRecord(
        importer,
        emission,
        createMigrationSyncMappingFact({
          row: {
            conversationKey: `article:${legacyUrl}`,
            id: 2,
            notionPageId: 'page-1',
            source: 'web',
            updatedAt: 1,
          },
          sourceLocalId: 2,
        }),
      );
      await importer.complete(emission.finalize());
      expect(handle.database.prepare('SELECT source, conversation_key FROM sync_mappings').get()).toEqual({
        conversation_key: `article:${canonicalUrl}`,
        source: 'web',
      });
      importer.cleanup();
    } finally {
      handle.close();
    }
  });

  it('cleans staged rows on an invalid continuation and rolls every facts row back if import fails', async () => {
    const handle = await openDatabase();
    try {
      const migrationId = randomUUID();
      const importer = await importerFor(handle.database, migrationId);
      const record = createMigrationConversationFact({
        row: { conversationKey: 'bad-continuation', id: 1, source: 'web' },
        sourceLocalId: 1,
      });
      const bytes = encodeMigrationFactRecord(record).bytes;
      const sessionId = randomUUID();
      const digest = await sha256Hex(nodeDigestProvider, bytes);
      await importer.acceptFrame({
        declaredTotalBytes: bytes.byteLength,
        operation: 'migration-fact-record',
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sequence: 0,
        sessionId,
        type: 'begin',
      });
      await importer.acceptFrame({
        byteLength: bytes.byteLength,
        digest,
        kind: record.kind,
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sequence: 1,
        sessionId,
        sourceLocalId: record.sourceLocalId,
        type: 'record-begin',
      });
      const valid = await createNativeWireRecordJsonFrame({
        bytes,
        offset: 0,
        provider: nodeDigestProvider,
        sequence: 2,
        sessionId,
      });
      await importer.acceptFrame(valid);
      await expectRejected(() => importer.acceptFrame(valid), 'MIGRATION_VALIDATION_FAILED');
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM staging_records').get()).toEqual({ count: 0 });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toEqual({ count: 0 });

      const rollbackId = randomUUID();
      const rollbackImporter = await importerFor(handle.database, rollbackId);
      const emission = await createEmission(rollbackId);
      const conversation = createMigrationConversationFact({
        row: { conversationKey: 'rollback', id: 1, source: 'web' },
        sourceLocalId: 1,
      });
      const imageBytes = Uint8Array.of(9, 8, 7);
      const image = prepareMigrationImageFact({
        row: {
          blob: imageBytes,
          contentType: 'image/png',
          conversationId: 1,
          id: 2,
          url: 'https://example.com/rollback.png',
        },
        sourceLocalId: 2,
      });
      await emitRecord(rollbackImporter, emission, conversation);
      await emitRecord(rollbackImporter, emission, image.record);
      await emitImage(rollbackImporter, emission, imageBytes);
      handle.database.exec(
        "CREATE TRIGGER reject_imported_image BEFORE INSERT ON image_cache BEGIN SELECT RAISE(ABORT, 'image blocked'); END;",
      );
      await expectRejected(() => rollbackImporter.complete(emission.finalize()), 'INVALID_ARGUMENT');
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toEqual({ count: 0 });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM image_cache').get()).toEqual({ count: 0 });
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM migration_receipts').get()).toEqual({ count: 0 });
      expect(readFactsRevision(handle.database)).toBe(0);
      expect(handle.database.prepare('SELECT COUNT(*) AS count FROM staging_records').get()).toEqual({ count: 0 });
    } finally {
      handle.close();
    }
  });
});
