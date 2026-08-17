import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  normalizeSearchQuery,
  parseCliFactsRequest,
  type CliFactsCommand,
  type CliFactsRequest,
} from '@services/local-data/contracts';

import { runConversations } from '../../packages/syncnoscli/src/commands/conversations';
import { runCli } from '../../packages/syncnoscli/src/cli';
import {
  createConversationsRepository,
  createSqliteConversationListScope,
  encodeSqliteConversationListCursor,
} from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

function output() {
  const chunks: string[] = [];
  return Object.freeze({
    chunks,
    stdout: Object.freeze({ write: (chunk: string) => (chunks.push(chunk), true) }),
  });
}

function cliRequest<TCommand extends CliFactsCommand>(command: TCommand, payload: unknown) {
  return parseCliFactsRequest({
    command,
    payload,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    requestId: 'cli:test',
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  }) as Extract<CliFactsRequest, Readonly<{ command: TCommand }>>;
}

async function initializedPaths() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-readonly-'));
  temporaryRoots.push(root);
  const paths = resolveSyncNosRuntimePaths({ homeDirectory: root });
  const handle = await openReadWriteForHost({ paths });
  try {
    const conversations = createConversationsRepository(handle.database);
    const messages = createMessagesRepository(handle.database);
    const recent = conversations.upsertConversation({
      conversationKey: 'recent-needle',
      lastCapturedAt: 200,
      source: 'chatgpt',
      sourceType: 'chat',
      title: 'Recent needle conversation',
    });
    messages.syncConversationMessages(recent.id, [
      {
        contentText: 'A needle appears in this recent message.',
        messageKey: 'recent-message',
        role: 'assistant',
        sequence: 1,
        updatedAt: 200,
      },
    ]);
    const older = conversations.upsertConversation({
      conversationKey: 'older-needle',
      lastCapturedAt: 100,
      source: 'web',
      sourceType: 'article',
      title: 'Older needle article',
      url: 'https://example.com/needle',
    });
    messages.syncConversationMessages(older.id, [
      {
        contentText: 'Needle body.',
        messageKey: 'older-message',
        role: 'assistant',
        sequence: 1,
        updatedAt: 100,
      },
    ]);
    return Object.freeze({ olderId: older.id, paths, recentId: recent.id });
  } finally {
    handle.close();
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos read-only CLI', () => {
  it('never serializes a browser Native cursor as a SQLite CLI cursor', () => {
    expect(() =>
      encodeSqliteConversationListCursor(
        { nativeCursor: 'host:opaque' },
        createSqliteConversationListScope({ sourceKey: 'chatgpt' }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('uses one existing database for paged list, detail, stats, and search without changing its bytes', async () => {
    const { paths, recentId } = await initializedPaths();
    const before = await readFile(paths.databasePath);

    const listOutput = output();
    await expect(
      runCli(['conversations', 'list', '--page-size', '1'], { database: { paths }, stdout: listOutput.stdout }),
    ).resolves.toBe(0);
    const firstList = JSON.parse(listOutput.chunks.join('')).data as {
      cursor: string | null;
      items: Array<{ id: number }>;
    };
    expect(firstList.items[0]).toMatchObject({ id: recentId });
    expect(firstList.cursor).toEqual(expect.any(String));

    const mismatchedListOutput = output();
    await expect(
      runCli(['conversations', 'list', '--source', 'chatgpt', '--cursor', firstList.cursor!], {
        database: { paths },
        stdout: mismatchedListOutput.stdout,
      }),
    ).resolves.toBe(1);
    expect(JSON.parse(mismatchedListOutput.chunks.join(''))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });

    const nextListOutput = output();
    await expect(
      runCli(['conversations', 'list', '--page-size', '1', '--cursor', firstList.cursor!], {
        database: { paths },
        stdout: nextListOutput.stdout,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(nextListOutput.chunks.join('')).data.items).toHaveLength(1);

    const detailOutput = output();
    await expect(
      runCli(['conversations', 'get', String(recentId)], { database: { paths }, stdout: detailOutput.stdout }),
    ).resolves.toBe(0);
    expect(JSON.parse(detailOutput.chunks.join('')).data).toMatchObject({
      conversation: { id: recentId, conversationKey: 'recent-needle' },
      messages: [{ messageKey: 'recent-message' }],
    });

    const statsOutput = output();
    await expect(runCli(['stats'], { database: { paths }, stdout: statsOutput.stdout })).resolves.toBe(0);
    expect(JSON.parse(statsOutput.chunks.join('')).data).toMatchObject({
      counts: { articleComments: 0, conversations: 2, imageCache: 0, messages: 2, syncMappings: 0 },
      factsRevision: expect.any(Number),
    });

    const searchOutput = output();
    await expect(
      runCli(['search', 'needle', '--sort', 'recent', '--page-size', '1'], {
        database: { paths },
        stdout: searchOutput.stdout,
      }),
    ).resolves.toBe(0);
    const firstSearch = JSON.parse(searchOutput.chunks.join('')).data as {
      cursor: string | null;
      items: Array<{ conversationKey: string }>;
    };
    expect(firstSearch.items[0]).toMatchObject({ conversationKey: 'recent-needle' });
    expect(firstSearch.cursor).toEqual(expect.any(String));

    const nextSearchOutput = output();
    await expect(
      runCli(['search', 'needle', '--sort', 'recent', '--page-size', '1', '--cursor', firstSearch.cursor!], {
        database: { paths },
        stdout: nextSearchOutput.stdout,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(nextSearchOutput.chunks.join('')).data.items).toHaveLength(1);

    const tableOutput = output();
    await expect(
      runCli(['search', 'needle', '--sort', 'recent', '--format', 'table'], {
        database: { paths },
        stdout: tableOutput.stdout,
      }),
    ).resolves.toBe(0);
    expect(tableOutput.chunks.join('')).toMatch(
      /^ID \| SOURCE \| SITE \| SCORE \| LAST_CAPTURED_AT \| TITLE \| SNIPPET\n/m,
    );
    await expect(readFile(paths.databasePath)).resolves.toEqual(before);
  });

  it('uses the shared search normalizer and formats only after the same query has run', async () => {
    const payloads: unknown[] = [];
    const page = Object.freeze({
      cursor: null,
      factsRevision: 4,
      facets: Object.freeze({ sites: [], sources: [] }),
      hasMore: false,
      items: Object.freeze([
        Object.freeze({
          backendConversationId: 7,
          conversationKey: 'needle',
          highlights: [],
          lastCapturedAt: 5,
          score: null,
          siteKey: 'all',
          snippet: '😀 needle',
          source: 'chatgpt',
          sourceType: 'chat',
          title: 'Needle',
          url: '',
        }),
      ]),
      truncatedByScanLimit: false,
    });
    const runSearch = vi.fn(async (input: Readonly<{ request: CliFactsRequest }>) => {
      payloads.push(input.request.payload);
      return page;
    });

    const jsonOutput = output();
    await expect(
      runCli(['search', '  😀 needle  ', '--sort', 'recent'], { runSearch, stdout: jsonOutput.stdout }),
    ).resolves.toBe(0);
    const tableOutput = output();
    await expect(
      runCli(['search', '  😀 needle  ', '--sort', 'recent', '--format', 'table'], {
        runSearch,
        stdout: tableOutput.stdout,
      }),
    ).resolves.toBe(0);

    expect(payloads).toEqual([
      { query: normalizeSearchQuery('  😀 needle  '), sort: 'recent' },
      { query: normalizeSearchQuery('  😀 needle  '), sort: 'recent' },
    ]);
    expect(JSON.parse(jsonOutput.chunks.join(''))).toMatchObject({ ok: true, requestId: 'cli:search' });
    expect(tableOutput.chunks.join('')).toContain('7 | chatgpt | all |  | 5 | Needle | 😀 needle');
  });

  it('escapes page-controlled terminal control characters only in table rendering', async () => {
    const hostileTitle = 'title\u001b]52;c;clipboard\u0007\u007f\u009b31m\tline\nnext';
    const hostileSnippet = 'snippet\u0000\u001f\u0085|\\tail';
    const page = Object.freeze({
      cursor: null,
      factsRevision: 4,
      facets: Object.freeze({ sites: [], sources: [] }),
      hasMore: false,
      items: Object.freeze([
        Object.freeze({
          backendConversationId: 7,
          conversationKey: 'hostile',
          highlights: [],
          lastCapturedAt: 5,
          score: null,
          siteKey: 'all',
          snippet: hostileSnippet,
          source: 'chatgpt',
          sourceType: 'chat',
          title: hostileTitle,
          url: '',
        }),
      ]),
      truncatedByScanLimit: false,
    });
    const runSearch = vi.fn(async () => page);

    const jsonOutput = output();
    await expect(runCli(['search', 'needle'], { runSearch, stdout: jsonOutput.stdout })).resolves.toBe(0);
    expect(JSON.parse(jsonOutput.chunks.join('')).data.items[0]).toMatchObject({
      title: hostileTitle,
      snippet: hostileSnippet,
    });
    expect(jsonOutput.chunks.join('')).not.toContain('\u001b');

    const tableOutput = output();
    await expect(
      runCli(['search', 'needle', '--format', 'table'], { runSearch, stdout: tableOutput.stdout }),
    ).resolves.toBe(0);
    const rendered = tableOutput.chunks.join('');
    expect(rendered).toContain('title\\x1b]52;c;clipboard\\x07\\x7f\\x9b31m\\tline\\nnext');
    expect(rendered).toContain('snippet\\x00\\x1f\\x85\\|\\\\tail');
    for (const control of ['\u001b', '\u0007', '\u007f', '\u009b', '\u0000', '\u001f', '\u0085', '\t', '\r']) {
      expect(rendered).not.toContain(control);
    }
  });

  it('returns structured parser failures and refuses a malformed list cursor before opening SQLite', async () => {
    const runConversationsCommand = vi.fn(async () => null);
    const runSearchCommand = vi.fn(async () => null);
    for (const argv of [
      ['conversations', 'list', '--sql', 'SELECT 1'],
      ['conversations', 'delete', '1'],
      ['write'],
      ['search', ''],
      ['search', 'x'.repeat(513)],
      ['search', 'needle', '--provider', 'notion'],
      ['stats', '--format', 'table'],
    ]) {
      const cliOutput = output();
      await expect(
        runCli(argv, {
          runConversations: runConversationsCommand,
          runSearch: runSearchCommand,
          stdout: cliOutput.stdout,
        }),
      ).resolves.toBe(2);
      expect(JSON.parse(cliOutput.chunks.join(''))).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(runConversationsCommand).not.toHaveBeenCalled();
    expect(runSearchCommand).not.toHaveBeenCalled();

    const openReadOnly = vi.fn(async () => {
      throw new Error('must not open');
    });
    await expect(
      runConversations({
        openReadOnly,
        request: cliRequest('CONVERSATIONS_LIST', { cursor: 'not-a-cursor' }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' } satisfies Partial<LocalDataContractError>);
    expect(openReadOnly).not.toHaveBeenCalled();
  });

  it('reports an absent database for every data command without creating the runtime directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-missing-'));
    temporaryRoots.push(root);
    const paths = resolveSyncNosRuntimePaths({ homeDirectory: root });
    for (const argv of [['conversations', 'list'], ['conversations', 'get', '1'], ['stats'], ['search', 'needle']]) {
      const cliOutput = output();
      await expect(runCli(argv, { database: { paths }, stdout: cliOutput.stdout })).resolves.toBe(1);
      expect(JSON.parse(cliOutput.chunks.join(''))).toMatchObject({
        ok: false,
        error: { code: 'DATABASE_NOT_INITIALIZED' },
      });
    }
    await expect(access(paths.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
