import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseHostFactsRequest,
} from '@services/local-data/contracts';
import { nativeHostContract } from '@services/local-data/native-host-contract';
import { NativeWireSessionReceiver } from '@services/local-data/native-wire';

import { runNativeHost } from '../../packages/syncnoscli/src/native-host/main';
import {
  NativeHostLaunchError,
  createNativeHostImportSession,
  validateNativeHostLaunch,
} from '../../packages/syncnoscli/src/native-host/session';
import { encodeNativeMessage, readNativeMessages } from '../../packages/syncnoscli/src/native-host/stdio';
import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadOnly, openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import {
  cleanupStaleHostImportStaging,
  createStagedFactsImporter,
  type StagedFactsImporter,
} from '../../packages/syncnoscli/src/sqlite/archive-import';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { nodeDigestProvider } from '../../packages/syncnoscli/src/runtime/node-digest';
import type { SyncNosSqliteDatabase } from '../../packages/syncnoscli/src/sqlite/schema';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];
const MIGRATION_ID = '7b3e6b4e-4c4d-4fa2-92cd-43c6b5b1e9f1';
const SESSION_ID = '42b0f5d3-3b42-4c90-a05b-2c729248fb4e';
const DIGEST = '0'.repeat(64);
const STALE_OWNER_TOKEN = 'ac183244-7f09-4c31-8e77-d405167490e1';
const repoRoot = resolve(__dirname, '../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function manifest() {
  return {
    migrationId: MIGRATION_ID,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: {
      conversations: 0,
      sync_mappings: 0,
      messages: 0,
      image_cache: 0,
      article_comments: 0,
    },
    streamBytes: {
      conversations: 0,
      sync_mappings: 0,
      messages: 0,
      image_cache: 0,
      article_comments: 0,
    },
    orderedFrameDigest: DIGEST,
  };
}

function importRequest(migrationId = MIGRATION_ID) {
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: 'import-1',
    command: 'IMPORT_FACTS',
    payload: {
      migrationId,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    },
  };
}

async function* frames(values: readonly unknown[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield encodeNativeMessage(value);
}

async function decodedMessages(values: readonly Uint8Array[]): Promise<unknown[]> {
  async function* output(): AsyncGenerator<Uint8Array> {
    for (const value of values) yield value;
  }
  const result: unknown[] = [];
  for await (const value of readNativeMessages(output())) result.push(value);
  return result;
}

async function decodeHostJsonStream(values: readonly unknown[]): Promise<unknown> {
  const [header, ...wire] = values;
  expect(header).toMatchObject({ ok: true, data: { stream: { operation: 'host-json' } } });
  const begin = wire[0] as { sessionId?: string } | undefined;
  expect(begin?.sessionId).toEqual(expect.any(String));
  const receiver = await NativeWireSessionReceiver.create(begin!.sessionId!, nodeDigestProvider);
  const chunks: Uint8Array[] = [];
  for (const frame of wire) {
    const event = await receiver.accept(frame);
    if (event?.kind === 'data') chunks.push(event.bytes);
  }
  expect(receiver.closed).toBe(true);
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function outputCollector(input: { abort?: () => void } = {}) {
  const frames: Uint8Array[] = [];
  return {
    frames,
    output: {
      write(chunk: Uint8Array, callback?: (error?: Error | null) => void) {
        frames.push(Uint8Array.from(chunk));
        if (frames.length === 1) input.abort?.();
        callback?.();
        return true;
      },
    },
  };
}

async function expectStagingEmpty(paths: ReturnType<typeof resolveSyncNosRuntimePaths>): Promise<void> {
  const handle = await openReadOnly({ paths });
  try {
    const row = handle.database.prepare('SELECT COUNT(*) AS count FROM staging_metadata').get() as { count: number };
    expect(row.count).toBe(0);
  } finally {
    handle.close();
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('Native Host session', () => {
  it('keeps browser roots Node-free and rejects SQL, path, and origin request fields before opening a connection', () => {
    const browserSources = [
      ...sourceFiles(resolve(repoRoot, 'src/ui')),
      ...sourceFiles(resolve(repoRoot, 'src/viewmodels')),
      ...sourceFiles(resolve(repoRoot, 'src/services')),
      ...sourceFiles(resolve(repoRoot, 'src/collectors')),
      ...sourceFiles(resolve(repoRoot, 'src/entrypoints')),
    ];
    for (const file of browserSources) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/(?:from\s+|require\()['"](?:node:[^'"]+|better-sqlite3(?:\/[^'"]*)?)['"]/);
    }

    for (const field of ['sql', 'path', 'origin']) {
      expect(() =>
        parseHostFactsRequest({
          command: 'GET_STATUS',
          payload: { [field]: 'untrusted' },
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          requestId: `forbidden-${field}`,
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        }),
      ).toThrow(LocalDataContractError);
    }

    const registrar = readFileSync(resolve(repoRoot, 'packages/syncnoscli/src/install/host-registration.ts'), 'utf8');
    expect(registrar).not.toMatch(/\bdatabase(?:Path|WalPath|ShmPath)\b/);
  });

  it('accepts only exact Chromium argv and a registrar-approved Firefox manifest path', async () => {
    await expect(validateNativeHostLaunch([nativeHostContract.browsers.chrome.origin], 'darwin')).resolves.toEqual({
      browser: 'chrome',
    });
    await expect(
      validateNativeHostLaunch([nativeHostContract.browsers.edge.origin, '--parent-window=42'], 'win32'),
    ).resolves.toEqual({ browser: 'edge' });
    await expect(
      validateNativeHostLaunch([nativeHostContract.browsers.chrome.origin, '--parent-window=042'], 'win32'),
    ).rejects.toMatchObject({ code: 'INVALID_LAUNCH' } satisfies Partial<NativeHostLaunchError>);
    await expect(
      validateNativeHostLaunch([nativeHostContract.browsers.chrome.origin, 'extra'], 'linux'),
    ).rejects.toMatchObject({ code: 'INVALID_LAUNCH' } satisfies Partial<NativeHostLaunchError>);

    const firefoxManifest =
      '/Users/chii/Library/Application Support/Mozilla/NativeMessagingHosts/app.syncnos.localdata.json';
    const isOwnedFirefoxManifest = vi.fn(async (path: string) => path === firefoxManifest);
    await expect(
      validateNativeHostLaunch([firefoxManifest, nativeHostContract.browsers.firefox.geckoId], 'darwin', {
        isOwnedFirefoxManifest,
      }),
    ).resolves.toEqual({ browser: 'firefox', firefoxManifestPath: firefoxManifest });
    expect(isOwnedFirefoxManifest).toHaveBeenCalledWith(firefoxManifest);
    await expect(
      validateNativeHostLaunch([firefoxManifest, nativeHostContract.browsers.firefox.geckoId], 'darwin'),
    ).rejects.toMatchObject({ code: 'INVALID_LAUNCH' } satisfies Partial<NativeHostLaunchError>);
  });

  it('never reads stdin or opens a database for spoofed, missing, or extra launch argv', async () => {
    const read = vi.fn();
    const stdin: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({ next: read }),
    };
    const openReadOnly = vi.fn();
    const openReadWriteForHost = vi.fn();
    const stderr: string[] = [];
    const output = outputCollector();

    await expect(
      runNativeHost({
        argv: ['chrome-extension://spoofed/'],
        openReadOnly,
        openReadWriteForHost,
        platform: 'darwin',
        stderr: { write: (chunk) => (stderr.push(chunk), true) },
        stdin,
        stdout: output.output,
      }),
    ).resolves.toBe(1);
    expect(read).not.toHaveBeenCalled();
    expect(openReadOnly).not.toHaveBeenCalled();
    expect(openReadWriteForHost).not.toHaveBeenCalled();
    expect(output.frames).toHaveLength(0);
    expect(stderr.join('')).toContain('rejected');
  });

  it('routes complete connected reads through a read-only repository session and strict JSON wire', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-native-host-read-'));
    temporaryRoots.push(root);
    const paths = resolveSyncNosRuntimePaths({ homeDirectory: root, platform: 'darwin' });
    const writeHandle = await openReadWriteForHost({ paths });
    let conversationId = 0;
    try {
      const conversations = createConversationsRepository(writeHandle.database);
      const messages = createMessagesRepository(writeHandle.database);
      const older = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'older',
        title: 'Older',
        lastCapturedAt: 10,
      });
      const newer = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'newer',
        title: 'Newer',
        lastCapturedAt: 20,
      });
      conversationId = newer.id;
      messages.syncConversationMessages(newer.id, [
        { messageKey: 'm1', role: 'user', contentText: 'first', sequence: 1 },
        { messageKey: 'm2', role: 'assistant', contentText: 'second', sequence: 2 },
      ]);
      expect(older.id).toBeGreaterThan(0);
    } finally {
      writeHandle.close();
    }

    const openReadOnlyConnection = vi.fn(async () => await openReadOnly({ paths }));
    const openReadWriteConnection = vi.fn();
    const bootstrapOutput = outputCollector();
    await expect(
      runNativeHost({
        argv: [nativeHostContract.browsers.chrome.origin],
        openReadOnly: openReadOnlyConnection,
        openReadWriteForHost: openReadWriteConnection,
        platform: 'darwin',
        stderr: { write: () => true },
        stdin: frames([
          {
            protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            requestId: 'bootstrap-1',
            command: 'CONVERSATION_BOOTSTRAP',
            payload: { limit: 1 },
          },
        ]),
        stdout: bootstrapOutput.output,
      }),
    ).resolves.toBe(0);
    expect(openReadOnlyConnection).toHaveBeenCalledTimes(1);
    expect(openReadWriteConnection).not.toHaveBeenCalled();

    const bootstrap = await decodeHostJsonStream(await decodedMessages(bootstrapOutput.frames));
    expect(bootstrap).toMatchObject({ items: [{ conversationKey: 'newer' }], hasMore: true });
    const cursor = (bootstrap as { cursor?: unknown }).cursor;
    expect(typeof cursor).toBe('string');

    const loadMoreOutput = outputCollector();
    await expect(
      runNativeHost({
        argv: [nativeHostContract.browsers.chrome.origin],
        openReadOnly: openReadOnlyConnection,
        openReadWriteForHost: openReadWriteConnection,
        platform: 'darwin',
        stderr: { write: () => true },
        stdin: frames([
          {
            protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            requestId: 'page-2',
            command: 'CONVERSATION_LOAD_MORE',
            payload: { cursor, limit: 1 },
          },
        ]),
        stdout: loadMoreOutput.output,
      }),
    ).resolves.toBe(0);
    await expect(decodeHostJsonStream(await decodedMessages(loadMoreOutput.frames))).resolves.toMatchObject({
      items: [{ conversationKey: 'older' }],
      hasMore: false,
    });

    const mismatchedScopeOutput = outputCollector();
    await expect(
      runNativeHost({
        argv: [nativeHostContract.browsers.chrome.origin],
        openReadOnly: openReadOnlyConnection,
        openReadWriteForHost: openReadWriteConnection,
        platform: 'darwin',
        stderr: { write: () => true },
        stdin: frames([
          {
            protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            requestId: 'page-rejected',
            command: 'CONVERSATION_LOAD_MORE',
            payload: { cursor, sourceKey: 'web' },
          },
        ]),
        stdout: mismatchedScopeOutput.output,
      }),
    ).resolves.toBe(1);
    await expect(decodedMessages(mismatchedScopeOutput.frames)).resolves.toMatchObject([
      { ok: false, error: { code: 'INVALID_ARGUMENT' } },
    ]);

    const tailOutput = outputCollector();
    await expect(
      runNativeHost({
        argv: [nativeHostContract.browsers.chrome.origin],
        openReadOnly: openReadOnlyConnection,
        openReadWriteForHost: openReadWriteConnection,
        platform: 'darwin',
        stderr: { write: () => true },
        stdin: frames([
          {
            protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            requestId: 'tail-1',
            command: 'CONVERSATION_TAIL',
            payload: {
              conversation: { source: 'chatgpt', conversationKey: 'newer', backendConversationId: conversationId },
              afterMessageKey: 'm1',
              limit: 1,
            },
          },
        ]),
        stdout: tailOutput.output,
      }),
    ).resolves.toBe(0);
    await expect(decodeHostJsonStream(await decodedMessages(tailOutput.frames))).resolves.toMatchObject({
      conversationId,
      messages: [{ messageKey: 'm2' }],
    });
  });

  it('routes typed conversation mutations through one read-write Host session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-native-host-write-'));
    temporaryRoots.push(root);
    const paths = resolveSyncNosRuntimePaths({ homeDirectory: root, platform: 'darwin' });
    const seed = await openReadWriteForHost({ paths });
    let conversationId = 0;
    let retainedConversationId = 0;
    try {
      const conversations = createConversationsRepository(seed.database);
      conversationId = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'delete-me',
        title: 'Delete me',
        lastCapturedAt: 1,
      }).id;
      retainedConversationId = conversations.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'retain-me',
        title: 'Retain me',
        lastCapturedAt: 2,
      }).id;
    } finally {
      seed.close();
    }

    const openReadOnlyConnection = vi.fn(async () => await openReadOnly({ paths }));
    const openReadWriteConnection = vi.fn(async () => await openReadWriteForHost({ paths }));
    const staleOutput = outputCollector();
    await expect(
      runNativeHost({
        argv: [nativeHostContract.browsers.chrome.origin],
        openReadOnly: openReadOnlyConnection,
        openReadWriteForHost: openReadWriteConnection,
        platform: 'darwin',
        stderr: { write: () => true },
        stdin: frames([
          {
            protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            requestId: 'delete-stale',
            command: 'DELETE_CONVERSATIONS',
            payload: {
              conversations: [
                { source: 'chatgpt', conversationKey: 'delete-me', backendConversationId: conversationId },
                {
                  source: 'chatgpt',
                  conversationKey: 'retain-me',
                  backendConversationId: retainedConversationId + 1,
                },
              ],
            },
          },
        ]),
        stdout: staleOutput.output,
      }),
    ).resolves.toBe(1);
    await expect(decodedMessages(staleOutput.frames)).resolves.toMatchObject([
      { ok: false, error: { code: 'STALE_REFERENCE' } },
    ]);

    const verifyStale = await openReadOnly({ paths });
    try {
      const conversations = createConversationsRepository(verifyStale.database);
      expect(conversations.getConversationById(conversationId)).not.toBeNull();
      expect(conversations.getConversationById(retainedConversationId)).not.toBeNull();
    } finally {
      verifyStale.close();
    }

    const output = outputCollector();
    await expect(
      runNativeHost({
        argv: [nativeHostContract.browsers.chrome.origin],
        openReadOnly: openReadOnlyConnection,
        openReadWriteForHost: openReadWriteConnection,
        platform: 'darwin',
        stderr: { write: () => true },
        stdin: frames([
          {
            protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
            schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
            requestId: 'delete-1',
            command: 'DELETE_CONVERSATIONS',
            payload: {
              conversations: [
                { source: 'chatgpt', conversationKey: 'delete-me', backendConversationId: conversationId },
              ],
            },
          },
        ]),
        stdout: output.output,
      }),
    ).resolves.toBe(0);

    expect(openReadOnlyConnection).not.toHaveBeenCalled();
    expect(openReadWriteConnection).toHaveBeenCalledTimes(2);
    await expect(decodeHostJsonStream(await decodedMessages(output.frames))).resolves.toMatchObject({
      deletedConversations: 1,
    });

    const verify = await openReadOnly({ paths });
    try {
      expect(createConversationsRepository(verify.database).getConversationById(conversationId)).toBeNull();
    } finally {
      verify.close();
    }
  });

  it('reclaims only provably dead Host-owned staging and preserves legacy or live sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-native-host-stale-'));
    temporaryRoots.push(root);
    const paths = resolveSyncNosRuntimePaths({ homeDirectory: root, platform: 'darwin' });
    const handle = await openReadWriteForHost({ paths });
    try {
      const legacy = await createStagedFactsImporter({
        database: handle.database,
        request: importRequest('e8fc2d83-fd10-4a15-8fe5-92721799245a').payload,
      });
      const live = await createStagedFactsImporter({
        database: handle.database,
        owner: { processId: 12345, token: '1024e2ad-d5d8-48d3-bf50-4c02b0a0e3ea' },
        request: importRequest('4bff8dd9-0f3a-42d0-b75b-9ce101cf6b0b').payload,
      });
      const dead = await createStagedFactsImporter({
        database: handle.database,
        owner: { processId: 67890, token: '1f1b68ee-00e4-4cdc-acfe-bd0ecffd395e' },
        request: importRequest('d37c9d08-a998-46d5-b246-c65e87182a44').payload,
      });
      expect(cleanupStaleHostImportStaging(handle.database, { isProcessAlive: (pid) => pid === 12345 })).toBe(1);
      expect(
        handle.database.prepare('SELECT migration_id FROM staging_metadata ORDER BY migration_id ASC').all(),
      ).toEqual([
        { migration_id: '4bff8dd9-0f3a-42d0-b75b-9ce101cf6b0b' },
        { migration_id: 'e8fc2d83-fd10-4a15-8fe5-92721799245a' },
      ]);
      legacy.cleanup();
      live.cleanup();
      dead.cleanup();
    } finally {
      handle.close();
    }
  });

  it('accepts only P1 frames and cleans SQLite staging after EOF, cancellation, bad digests, and SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-native-host-'));
    temporaryRoots.push(root);
    const paths = resolveSyncNosRuntimePaths({ homeDirectory: root, platform: 'darwin' });
    const launch = [nativeHostContract.browsers.chrome.origin];
    const staleHandle = await openReadWriteForHost({ paths });
    await createStagedFactsImporter({
      database: staleHandle.database,
      owner: { processId: 987654, token: STALE_OWNER_TOKEN },
      request: importRequest().payload,
    });
    staleHandle.close();

    const runs: Array<readonly unknown[]> = [
      [importRequest()],
      [
        importRequest(),
        {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: SESSION_ID,
          sequence: 0,
          type: 'begin',
          operation: 'migration-fact-record',
          declaredTotalBytes: 2,
        },
        {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: SESSION_ID,
          sequence: 1,
          type: 'cancel',
          reason: 'cancelled',
        },
      ],
      [
        importRequest(),
        {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: SESSION_ID,
          sequence: 0,
          type: 'begin',
          operation: 'migration-fact-record',
          declaredTotalBytes: 2,
        },
        {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: SESSION_ID,
          sequence: 1,
          type: 'record-begin',
          kind: 'conversations',
          sourceLocalId: 'conversation:one',
          byteLength: 2,
          digest: DIGEST,
        },
        {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: SESSION_ID,
          sequence: 2,
          type: 'record-json',
          encoding: 'base64',
          data: 'e30=',
          byteLength: 2,
          offset: 0,
          chunkDigest: 'f'.repeat(64),
        },
      ],
    ];

    for (const values of runs) {
      const output = outputCollector();
      await expect(
        runNativeHost({
          argv: launch,
          isProcessAlive: () => false,
          openReadWriteForHost: async () => await openReadWriteForHost({ paths }),
          platform: 'darwin',
          stderr: { write: () => true },
          stdin: frames(values),
          stdout: output.output,
        }),
      ).resolves.toBe(1);
      const responses = await decodedMessages(output.frames);
      expect(responses[0]).toMatchObject({ ok: true, requestId: 'import-1', data: { accepted: true } });
      expect(responses.at(-1)).toMatchObject({ ok: false, requestId: 'import-1' });
      await expectStagingEmpty(paths);
    }

    const controller = new AbortController();
    const output = outputCollector({ abort: () => controller.abort() });
    await expect(
      runNativeHost({
        argv: launch,
        isProcessAlive: () => false,
        openReadWriteForHost: async () => await openReadWriteForHost({ paths }),
        platform: 'darwin',
        signal: controller.signal,
        stderr: { write: () => true },
        stdin: frames([importRequest()]),
        stdout: output.output,
      }),
    ).resolves.toBe(1);
    await expectStagingEmpty(paths);
  });

  it('keeps completion control separate from wire frames and cleans its importer exactly once', async () => {
    const acceptFrame = vi.fn(async () => undefined);
    const cleanup = vi.fn();
    const complete = vi.fn(async () => ({
      alreadyCommitted: false,
      commentAmbiguity: { groupCount: 0, samples: [] },
      factCounts: manifest().factCounts,
      factsRevision: 1,
      manifestDigest: DIGEST,
      migrationId: MIGRATION_ID,
    }));
    const session = await createNativeHostImportSession({
      database: {} as SyncNosSqliteDatabase,
      request: parseHostFactsRequest(importRequest()),
      createImporter: async () => ({ abort: cleanup, acceptFrame, cleanup, complete }) as StagedFactsImporter,
    });

    await expect(session.accept({ type: 'begin' })).resolves.toEqual({ kind: 'continue' });
    await expect(session.accept({ type: 'complete', manifest: manifest() })).resolves.toMatchObject({
      kind: 'complete',
    });
    expect(acceptFrame).toHaveBeenCalledWith({ type: 'begin' });
    expect(complete).toHaveBeenCalledWith(manifest());
    session.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);

    const rejectedCleanup = vi.fn();
    const rejected = await createNativeHostImportSession({
      database: {} as SyncNosSqliteDatabase,
      request: parseHostFactsRequest(importRequest()),
      createImporter: async () =>
        ({
          abort: rejectedCleanup,
          acceptFrame,
          cleanup: rejectedCleanup,
          complete,
        }) as StagedFactsImporter,
    });
    await expect(rejected.accept({ type: 'complete', manifest: {}, unexpected: true })).rejects.toBeInstanceOf(
      LocalDataContractError,
    );
    expect(rejectedCleanup).toHaveBeenCalledTimes(1);
  });
});
