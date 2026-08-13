import { describe, expect, it } from 'vitest';

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  BROWSER_RUNTIME_FACTS_COMMANDS,
  CLI_FACTS_COMMANDS,
  HOST_FACTS_COMMANDS,
  IDB_FACTS_EPOCH,
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  MAX_CAPTURE_SNAPSHOT_BYTES,
  MAX_MIGRATION_PROFILE_QUEUE_ITEMS,
  MAX_MIGRATION_PROFILE_REFERENCE_PATCH_BYTES,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  MAX_SEARCH_QUERY_SCALARS,
  MAX_STREAM_FRAME_BYTES,
  MAX_ZIP_STREAM_BYTES,
  MIGRATION_JOURNAL_STAGES,
  MIGRATION_PROFILE_PROVIDERS,
  LocalDataContractError,
  assertFactsEpochMatches,
  assertStreamChunkWithinLimits,
  createBrowserRuntimeFactsSuccess,
  createCliJsonSuccess,
  createHostFactsSuccess,
  createLocalDataError,
  createSearchCursorBinding,
  normalizeSearchQuery,
  parseBrowserRuntimeFactsRequest,
  parseCliFactsRequest,
  parseMigrationJournalStage,
  parseMigrationProfileReferencePatch,
  parseMigrationStreamRequestPayload,
  parseLocalDataError,
  parseHostFactsRequest,
  parsePlainSnippetHighlights,
  parseStreamDescriptor,
  serializedJsonUtf8ByteLength,
  serializeMigrationProfileReferencePatch,
} from '@services/local-data/contracts';
import { FACT_STREAM_KINDS, createFactsManifest, parseFactsManifest } from '@services/local-data/facts-manifest';

const MIGRATION_A = '3b715c7d-3471-4aa4-8e7c-0c0b0a7afe7a';
const MIGRATION_B = '6fa05726-0691-421b-b0f6-8160b9d95aac';
const DIGEST = 'a'.repeat(64);
const REPOSITORY_ROOT = resolve(process.cwd());

function readSource(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8');
}

function moduleSpecifiers(path: string): string[] {
  const source = readSource(path);
  return Array.from(source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)).map(
    (match) => match[1] ?? match[2]!,
  );
}

function sourceFiles(path: string): string[] {
  const absolute = resolve(REPOSITORY_ROOT, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative(REPOSITORY_ROOT, child));
    return /\.(?:ts|tsx)$/.test(entry.name) ? [relative(REPOSITORY_ROOT, child)] : [];
  });
}

function envelope(command: string, payload: unknown, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: 'request-1',
    command,
    payload,
    ...extras,
  };
}

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

function manifestCounts(value: number): Record<(typeof FACT_STREAM_KINDS)[number], number> {
  return Object.fromEntries(FACT_STREAM_KINDS.map((kind) => [kind, value])) as Record<
    (typeof FACT_STREAM_KINDS)[number],
    number
  >;
}

describe('local data contracts', () => {
  it('owns an explicit command allowlist for browser, Host, and CLI surfaces', () => {
    expect(Object.isFrozen(BROWSER_RUNTIME_FACTS_COMMANDS)).toBe(true);
    expect(Object.isFrozen(HOST_FACTS_COMMANDS)).toBe(true);
    expect(Object.isFrozen(CLI_FACTS_COMMANDS)).toBe(true);
    expect(BROWSER_RUNTIME_FACTS_COMMANDS).toEqual([
      'GET_LOCAL_DATA_STATUS',
      'START_LOCAL_DATA_MIGRATION',
      'RESUME_LOCAL_DATA_MIGRATION',
      'GET_FACTS_REVISION',
      'CONVERSATION_BOOTSTRAP',
      'CONVERSATION_LOAD_MORE',
      'CONVERSATION_DETAIL',
      'CONVERSATION_TAIL',
      'SAVE_CONVERSATION_SNAPSHOT',
      'DELETE_CONVERSATION',
      'MERGE_CONVERSATIONS',
      'SYNC_CONVERSATION_MESSAGES',
      'GET_SYNC_MAPPING',
      'PATCH_SYNC_MAPPING',
      'CLEAR_SYNC_MAPPING',
      'UPDATE_ARTICLE_URL',
      'LIST_ARTICLE_COMMENTS',
      'ADD_ARTICLE_COMMENT',
      'ADD_ARTICLE_COMMENT_REPLY',
      'DELETE_ARTICLE_COMMENT',
      'MIGRATE_ARTICLE_COMMENT_URL',
      'ENSURE_ARTICLE_COMMENT_CONTEXT',
      'GET_IMAGE_ASSET',
      'PUT_IMAGE_ASSET',
      'BACKFILL_CONVERSATION_IMAGES',
      'FACTS_IMPORT',
      'FACTS_EXPORT',
      'BACKUP_IMPORT',
      'BACKUP_EXPORT',
      'GET_INSIGHT_STATS',
      'SEARCH_CONVERSATIONS',
      'GET_MIGRATION_RECEIPT',
    ]);
    expect(HOST_FACTS_COMMANDS).toContain('UPDATE_ARTICLE_URL');
    expect(HOST_FACTS_COMMANDS).toContain('IMPORT_FACTS');
    expect(HOST_FACTS_COMMANDS).toContain('SEARCH_CONVERSATIONS');
    expect(CLI_FACTS_COMMANDS).toEqual([
      'DOCTOR',
      'CONVERSATIONS_LIST',
      'CONVERSATIONS_GET',
      'STATS',
      'SEARCH_CONVERSATIONS',
    ]);
  });

  it('keeps browser profile epochs outside Host and CLI envelopes', () => {
    const stableBrowserRequest = parseBrowserRuntimeFactsRequest(
      envelope('CONVERSATION_DETAIL', { source: 'web', conversationKey: 'conversation-a' }),
    );
    expect(stableBrowserRequest).not.toHaveProperty('factsEpoch');

    expectErrorCode(
      () =>
        parseBrowserRuntimeFactsRequest(
          envelope('CONVERSATION_DETAIL', { source: 'web', conversationKey: 'conversation-a', conversationId: 10 }),
        ),
      'STALE_BACKEND_EPOCH',
    );

    const profileA = parseBrowserRuntimeFactsRequest(
      envelope(
        'CONVERSATION_DETAIL',
        { source: 'web', conversationKey: 'conversation-a', conversationId: 10 },
        { factsEpoch: `native:${MIGRATION_A}` },
      ),
    );
    const profileB = parseBrowserRuntimeFactsRequest(
      envelope(
        'CONVERSATION_DETAIL',
        { source: 'web', conversationKey: 'conversation-a', conversationId: 10 },
        { factsEpoch: `native:${MIGRATION_B}` },
      ),
    );
    expect(profileA.factsEpoch).toBe(`native:${MIGRATION_A}`);
    expect(profileB.factsEpoch).toBe(`native:${MIGRATION_B}`);
    expect(IDB_FACTS_EPOCH).toBe('idb-v1');
    expect(assertFactsEpochMatches(`native:${MIGRATION_A}`, profileA.factsEpoch)).toBe(`native:${MIGRATION_A}`);
    expectErrorCode(() => assertFactsEpochMatches(`native:${MIGRATION_A}`, profileB.factsEpoch), 'STALE_BACKEND_EPOCH');

    const hostRequest = parseHostFactsRequest(
      envelope('CONVERSATION_DETAIL', { source: 'web', conversationKey: 'conversation-a', backendConversationId: 91 }),
    );
    expect(hostRequest).not.toHaveProperty('factsEpoch');
    expect(hostRequest.payload).toEqual({
      source: 'web',
      conversationKey: 'conversation-a',
      backendConversationId: 91,
    });
    expect(
      parseHostFactsRequest(
        envelope('ADD_ARTICLE_COMMENT_REPLY', {
          context: {
            canonicalUrl: 'https://example.test/article',
            conversation: { source: 'web', conversationKey: 'conversation-a', backendConversationId: 91 },
          },
          commentText: 'reply',
          backendParentId: 17,
        }),
      ).payload,
    ).toEqual({
      context: {
        canonicalUrl: 'https://example.test/article',
        conversation: { source: 'web', conversationKey: 'conversation-a', backendConversationId: 91 },
      },
      commentText: 'reply',
      backendParentId: 17,
    });

    expectErrorCode(
      () =>
        parseHostFactsRequest(
          envelope(
            'CONVERSATION_DETAIL',
            { source: 'web', conversationKey: 'conversation-a', backendConversationId: 91 },
            { factsEpoch: `native:${MIGRATION_A}` },
          ),
        ),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(
      () =>
        parseHostFactsRequest(
          envelope('CONVERSATION_DETAIL', { source: 'web', conversationKey: 'conversation-a', conversationId: 10 }),
        ),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(
      () =>
        parseCliFactsRequest(
          envelope('SEARCH_CONVERSATIONS', { query: normalizeSearchQuery('syncnos') }, { factsEpoch: IDB_FACTS_EPOCH }),
        ),
      'INVALID_ARGUMENT',
    );
  });

  it('rejects unknown commands and command-control fields before a request reaches a backend', () => {
    expectErrorCode(() => parseBrowserRuntimeFactsRequest(envelope('DROP_DATABASE', {})), 'INVALID_ARGUMENT');
    expectErrorCode(
      () => parseHostFactsRequest(envelope('GET_STATUS', { origin: 'chrome-extension://attacker/' })),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(
      () => parseHostFactsRequest(envelope('GET_STATUS', { sql: 'DELETE FROM facts' })),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(
      () => parseHostFactsRequest(envelope('GET_STATUS', { path: '/tmp/syncnos.sqlite' })),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(() => parseHostFactsRequest(envelope('GET_STATUS', { shell: 'sh -c bad' })), 'INVALID_ARGUMENT');
    expectErrorCode(
      () => parseBrowserRuntimeFactsRequest(envelope('GET_LOCAL_DATA_STATUS', { profileJournal: {} })),
      'INVALID_ARGUMENT',
    );
  });

  it('starts a facts stream with only the migration identity and version pair', () => {
    expect(
      parseMigrationStreamRequestPayload({
        migrationId: MIGRATION_A,
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      }),
    ).toEqual({
      migrationId: MIGRATION_A,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    });
    expectErrorCode(
      () =>
        parseMigrationStreamRequestPayload({
          manifestDigest: DIGEST,
          migrationId: MIGRATION_A,
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
          transfer: { declaredTotalBytes: 1, operation: 'migration-fact-record' },
        }),
      'INVALID_ARGUMENT',
    );
  });

  it('keeps user comment text opaque while command fields remain allowlisted', () => {
    const request = parseBrowserRuntimeFactsRequest(
      envelope('ADD_ARTICLE_COMMENT', {
        context: { canonicalUrl: 'https://example.test/article' },
        quoteText: 'first line\nsecond line',
        commentText: 'a long comment\nwith its original line breaks',
        locator: { exact: 'first line', start: 0, end: 10 },
      }),
    );
    expect(request.payload).toMatchObject({
      quoteText: 'first line\nsecond line',
      commentText: 'a long comment\nwith its original line breaks',
    });
  });

  it('normalizes search once with NFC, Unicode scalar limits, and an escaped FTS phrase', () => {
    const normalized = normalizeSearchQuery('  Cafe\u0301\u00a0你好  ');
    expect(normalized).toEqual({
      literal: 'Café 你好',
      scalarCount: 7,
      mode: 'fts-phrase',
      ftsPhrase: '"Café 你好"',
    });
    expect(normalizeSearchQuery(' 你好 ')).toEqual({ literal: '你好', scalarCount: 2, mode: 'literal-fallback' });
    expect(normalizeSearchQuery('a"bc')).toMatchObject({ mode: 'fts-phrase', ftsPhrase: '"a""bc"' });
    expect(normalizeSearchQuery('😀'.repeat(MAX_SEARCH_QUERY_SCALARS))).toMatchObject({
      scalarCount: MAX_SEARCH_QUERY_SCALARS,
    });

    expectErrorCode(() => normalizeSearchQuery('sync\u0000nos'), 'INVALID_ARGUMENT');
    expectErrorCode(() => normalizeSearchQuery('sync\u0085nos'), 'INVALID_ARGUMENT');
    expectErrorCode(() => normalizeSearchQuery('sync\ud800'), 'INVALID_ARGUMENT');
    expectErrorCode(() => normalizeSearchQuery('😀'.repeat(MAX_SEARCH_QUERY_SCALARS + 1)), 'INVALID_ARGUMENT');

    const query = normalizeSearchQuery('SyncNos search');
    const cursor = createSearchCursorBinding(query, 'cursor-token');
    expect(
      parseCliFactsRequest(envelope('SEARCH_CONVERSATIONS', { query, cursor, sort: 'best', limit: 50 })),
    ).toMatchObject({ command: 'SEARCH_CONVERSATIONS', payload: { query, cursor } });
    expectErrorCode(
      () =>
        parseCliFactsRequest(
          envelope('SEARCH_CONVERSATIONS', {
            query,
            cursor: { literal: 'another query', token: 'cursor-token' },
          }),
        ),
      'STALE_SEARCH_CURSOR',
    );
    expectErrorCode(
      () =>
        parseCliFactsRequest(
          envelope('SEARCH_CONVERSATIONS', {
            query: { ...query, scalarCount: query.scalarCount + 1 },
          }),
        ),
      'INVALID_ARGUMENT',
    );
  });

  it('fixes plain-snippet highlights to UTF-16 half-open ranges without splitting surrogates', () => {
    expect(parsePlainSnippetHighlights('A😀B', [{ start: 1, end: 3 }])).toEqual([{ start: 1, end: 3 }]);
    expectErrorCode(() => parsePlainSnippetHighlights('A😀B', [{ start: 2, end: 3 }]), 'INVALID_ARGUMENT');
    expectErrorCode(
      () =>
        parsePlainSnippetHighlights('A😀B', [
          { start: 1, end: 3 },
          { start: 2, end: 4 },
        ]),
      'INVALID_ARGUMENT',
    );
  });

  it('enforces frame, declared-total, and accumulated-total limits before retaining stream data', () => {
    const capture = {
      operation: 'capture-snapshot' as const,
      declaredTotalBytes: MAX_CAPTURE_SNAPSHOT_BYTES,
      accumulatedBytes: MAX_CAPTURE_SNAPSHOT_BYTES - 1,
      incomingBytes: 1,
      serializedFrameBytes: MAX_STREAM_FRAME_BYTES,
    };
    expect(() => assertStreamChunkWithinLimits(capture)).not.toThrow();
    expectErrorCode(
      () => assertStreamChunkWithinLimits({ ...capture, serializedFrameBytes: MAX_STREAM_FRAME_BYTES + 1 }),
      'PAYLOAD_TOO_LARGE',
    );
    expectErrorCode(
      () => assertStreamChunkWithinLimits({ ...capture, declaredTotalBytes: MAX_CAPTURE_SNAPSHOT_BYTES + 1 }),
      'PAYLOAD_TOO_LARGE',
    );
    expectErrorCode(
      () =>
        assertStreamChunkWithinLimits({ ...capture, accumulatedBytes: MAX_CAPTURE_SNAPSHOT_BYTES, incomingBytes: 1 }),
      'PAYLOAD_TOO_LARGE',
    );
    expect(parseStreamDescriptor({ operation: 'zip-backup', declaredTotalBytes: MAX_ZIP_STREAM_BYTES })).toEqual({
      operation: 'zip-backup',
      declaredTotalBytes: MAX_ZIP_STREAM_BYTES,
    });
    expectErrorCode(
      () => parseStreamDescriptor({ operation: 'zip-backup', declaredTotalBytes: MAX_ZIP_STREAM_BYTES + 1 }),
      'PAYLOAD_TOO_LARGE',
    );
    expect(MAX_NATIVE_IMAGE_SLICE_BYTES).toBe(256 * 1024);
    expect(serializedJsonUtf8ByteLength({ text: '你好😀' })).toBe(
      new TextEncoder().encode('{"text":"你好😀"}').byteLength,
    );
  });

  it('emits safe stable error and response envelopes without leaking browser epochs into Host or CLI', () => {
    const error = createLocalDataError('PAYLOAD_TOO_LARGE', {
      operation: 'image-asset',
      actualBytes: 65,
      limitBytes: 64,
    });
    expect(error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The local data payload exceeds its safe limit.',
      retryable: false,
      diagnostics: { operation: 'image-asset', actualBytes: 65, limitBytes: 64 },
    });
    expectErrorCode(() => createLocalDataError('HOST_UNAVAILABLE', { path: '/private/data' }), 'INVALID_ARGUMENT');
    expectErrorCode(() => createLocalDataError('HOST_UNAVAILABLE', { field: '/private/data' }), 'INVALID_ARGUMENT');
    expect(parseLocalDataError(error)).toEqual(error);
    expectErrorCode(() => parseLocalDataError({ ...error, message: 'raw database path' }), 'INVALID_ARGUMENT');

    const browser = createBrowserRuntimeFactsSuccess('request-1', { items: [] }, `native:${MIGRATION_A}`);
    const host = createHostFactsSuccess('request-1', { items: [] });
    const cli = createCliJsonSuccess('request-1', { items: [] });
    expect(browser).toMatchObject({ ok: true, factsEpoch: `native:${MIGRATION_A}` });
    expect(host).not.toHaveProperty('factsEpoch');
    expect(cli).not.toHaveProperty('factsEpoch');
  });

  it('keeps profile migration patches bounded, reference-free, and canonically ordered', () => {
    expect(Object.isFrozen(MIGRATION_JOURNAL_STAGES)).toBe(true);
    expect(MIGRATION_JOURNAL_STAGES).toEqual([
      'not_started',
      'staging',
      'remote_committed',
      'profile_refs_pending',
      'cleanup_pending',
      'active',
    ]);
    expect(MIGRATION_PROFILE_PROVIDERS).toEqual(['notion', 'obsidian', 'feishu']);
    expect(parseMigrationJournalStage('cleanup_pending')).toBe('cleanup_pending');
    expectErrorCode(() => parseMigrationJournalStage('rollback'), 'INVALID_ARGUMENT');

    const patch = {
      version: 1,
      queues: {
        notion: [
          { source: 'chatgpt', conversationKey: 'conversation-z', dueAt: 50 },
          { source: 'chatgpt', conversationKey: 'conversation-a', dueAt: 10 },
        ],
        obsidian: [],
        feishu: [],
      },
      syncJobs: {
        notion: {
          provider: 'notion',
          status: 'aborted',
          startedAt: 1,
          updatedAt: 2,
          finishedAt: 3,
          okCount: 4,
          failCount: 5,
          abortedReason: 'local_data_migration',
        },
        obsidian: {
          provider: 'obsidian',
          status: 'done',
          startedAt: 1,
          updatedAt: 2,
          finishedAt: 3,
          okCount: 4,
          failCount: 5,
        },
        feishu: {
          provider: 'feishu',
          status: 'done',
          startedAt: 1,
          updatedAt: 2,
          finishedAt: 3,
          okCount: 4,
          failCount: 5,
        },
      },
    };
    const parsed = parseMigrationProfileReferencePatch(patch);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.queues.notion.map((entry) => entry.conversationKey)).toEqual(['conversation-a', 'conversation-z']);
    const serialized = serializeMigrationProfileReferencePatch(patch);
    expect(serialized).toBe(serializeMigrationProfileReferencePatch(parsed));
    expect(serialized).not.toMatch(/conversationId|backendConversationId|title|url|token|oauth|warning|result/i);

    expectErrorCode(
      () =>
        parseMigrationProfileReferencePatch({
          ...patch,
          queues: {
            ...patch.queues,
            notion: [...patch.queues.notion, { source: 'chatgpt', conversationKey: 'conversation-a', dueAt: 99 }],
          },
        }),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(
      () =>
        parseMigrationProfileReferencePatch({
          ...patch,
          queues: {
            ...patch.queues,
            notion: [{ ...patch.queues.notion[0], conversationId: 1 }],
          },
        }),
      'INVALID_ARGUMENT',
    );
    expectErrorCode(
      () =>
        parseMigrationProfileReferencePatch({
          ...patch,
          syncJobs: {
            ...patch.syncJobs,
            notion: { ...patch.syncJobs.notion, status: 'running' },
          },
        }),
      'INVALID_ARGUMENT',
    );

    const tooMany = structuredClone(patch);
    tooMany.queues.notion = Array.from({ length: MAX_MIGRATION_PROFILE_QUEUE_ITEMS + 1 }, (_, index) => ({
      source: 'chatgpt',
      conversationKey: `conversation-${index}`,
      dueAt: index + 1,
    }));
    expectErrorCode(() => parseMigrationProfileReferencePatch(tooMany), 'INVALID_ARGUMENT');

    const oversized = structuredClone(patch);
    for (const provider of MIGRATION_PROFILE_PROVIDERS) {
      oversized.queues[provider] = Array.from({ length: MAX_MIGRATION_PROFILE_QUEUE_ITEMS }, (_, index) => ({
        source: `source-${index}`,
        conversationKey: `${'😀'.repeat(1_020)}-${index}`,
        dueAt: index + 1,
      }));
    }
    expectErrorCode(() => parseMigrationProfileReferencePatch(oversized), 'PAYLOAD_TOO_LARGE');
    expect(MAX_MIGRATION_PROFILE_REFERENCE_PATCH_BYTES).toBe(2 * 1024 * 1024);
  });

  it('keeps P1 local-data pure and leaves transfer, cleanup, and local-mode admission disconnected from production callers', () => {
    const pureLocalDataFiles = [
      'src/services/local-data/contracts.ts',
      'src/services/local-data/digest.ts',
      'src/services/local-data/facts-manifest.ts',
      'src/services/local-data/native-wire.ts',
      'src/services/local-data/facts-archive.ts',
      'src/services/local-data/native-host-contract.ts',
    ];
    const allowedServiceImports = new Set([
      '@services/comments/domain/comment-locator',
      '@services/url-cleaning/http-url',
    ]);
    for (const path of pureLocalDataFiles) {
      const imports = moduleSpecifiers(path);
      expect(
        imports.some((specifier) => /^(?:@platform\/|@ui\/|@viewmodels\/|@entrypoints\/|node:)/.test(specifier)),
      ).toBe(false);
      expect(imports.every((specifier) => specifier.startsWith('./') || allowedServiceImports.has(specifier))).toBe(
        true,
      );
    }

    const forbiddenIdbConsumers = [
      ...sourceFiles('src/ui'),
      ...sourceFiles('src/viewmodels'),
      ...sourceFiles('src/services/local-data'),
    ].filter((path) => /(?:@platform\/idb|src\/platform\/idb|\/platform\/idb)/.test(readSource(path)));
    expect(forbiddenIdbConsumers).toEqual([]);

    const productionFiles = sourceFiles('src');
    for (const symbol of ['transferIndexedDbFacts', 'clearFacts', 'verifyFactsEmpty']) {
      const callers = productionFiles.filter((path) => new RegExp(`\\b${symbol}\\s*\\(`).test(readSource(path)));
      expect(callers).toEqual(['src/platform/idb/facts-transfer.ts']);
    }
    const journalEntrypoints = productionFiles.filter((path) => /\bbeginMigrationJournal\s*\(/.test(readSource(path)));
    expect(journalEntrypoints).toEqual(['src/platform/local-data/migration-journal.ts']);
  });

  it('keeps the migration manifest compact, ordered, and receipt-verifiable', () => {
    expect(Object.isFrozen(FACT_STREAM_KINDS)).toBe(true);
    expect(FACT_STREAM_KINDS).toEqual([
      'conversations',
      'sync_mappings',
      'messages',
      'image_cache',
      'article_comments',
    ]);
    const manifest = createFactsManifest({
      migrationId: MIGRATION_A,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      factCounts: manifestCounts(2),
      streamBytes: manifestCounts(128),
      orderedFrameDigest: DIGEST,
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.factCounts)).toBe(true);
    expect(manifest).toEqual({
      migrationId: MIGRATION_A,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      factCounts: manifestCounts(2),
      streamBytes: manifestCounts(128),
      orderedFrameDigest: DIGEST,
    });
    expect(Object.keys(manifest)).not.toContain('content');

    const missingKind = structuredClone(manifest) as Record<string, any>;
    delete missingKind.factCounts.messages;
    expectErrorCode(() => parseFactsManifest(missingKind), 'MIGRATION_VALIDATION_FAILED');
    expectErrorCode(() => parseFactsManifest({ ...manifest, extra: true }), 'MIGRATION_VALIDATION_FAILED');
  });
});
