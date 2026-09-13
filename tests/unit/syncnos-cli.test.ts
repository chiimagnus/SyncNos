import { createServer, type Server } from 'node:net';
import { lstat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { contract } from '../../cli/contract.mjs';
import {
  ensureRuntimeDir,
  registryPathForInstance,
  socketPathForInstance,
  writeRegistryEntry,
} from '../../cli/runtime-registry.mjs';
import { runCli, selectInstance } from '../../cli/syncnos.mjs';
import { setPreferredInstance } from '../../cli/user-config.mjs';

type FakeInstance = {
  id: string;
  endpoint: string;
  registryPath: string;
  server: Server;
  requests: any[];
  stop: () => Promise<void>;
};

async function startFakeInstance(
  runtimeRoot: string,
  id: string,
  browserFamily: 'chromium' | 'firefox',
  options: {
    revisionErrorCode?: string;
    onRequest?: (request: any) => {
      data?: unknown;
      errorCode?: string;
      errorMessage?: string;
      errorExtra?: unknown;
    } | null;
  } = {},
): Promise<FakeInstance> {
  const requests: any[] = [];
  const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
  const endpoint = socketPathForInstance(runtimeDir, id);
  const registryPath = registryPathForInstance(runtimeDir, id);
  const server = createServer((socket) => {
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (!input.includes('\n')) return;
      const request = JSON.parse(input.trim());
      requests.push(request);
      const method = String(request.method || '');
      const custom = options.onRequest?.(request) ?? null;
      const data =
        custom && Object.prototype.hasOwnProperty.call(custom, 'data')
          ? custom.data
          : method === 'system.ping'
            ? {
                alive: true,
                cliInstanceId: id,
                protocolVersion: contract.protocolVersion,
                runtimeId: `${id}-runtime`,
                extensionVersion: '1.2.3',
                browserFamily,
              }
            : method === 'revision.get' && !options.revisionErrorCode
              ? { conversations: id === 'helium-main' ? 11 : 22 }
              : null;
      const errorCode =
        custom?.errorCode ||
        (method === 'revision.get' && options.revisionErrorCode ? options.revisionErrorCode : 'rpc_method_not_found');
      const errorMessage = custom?.errorMessage || 'failed';
      socket.end(
        `${JSON.stringify({
          kind: contract.frames.rpcResponse,
          protocolVersion: contract.protocolVersion,
          requestId: 'fake',
          ok: data !== null,
          data,
          error:
            data !== null
              ? null
              : {
                  code: errorCode,
                  message: errorMessage,
                  ...(custom?.errorExtra == null ? null : { extra: custom.errorExtra }),
                },
        })}\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(endpoint, resolve));
  await writeRegistryEntry(registryPath, {
    cliInstanceId: id,
    endpoint,
    pid: process.pid,
    processNonce: `${id}-nonce`,
    browserFamily,
    runtimeId: `${id}-runtime`,
    extensionVersion: '1.2.3',
    protocolVersion: contract.protocolVersion,
    startedAt: Date.now(),
  });
  return {
    id,
    endpoint,
    registryPath,
    server,
    requests,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function run(argv: string[], runtimeRoot: string, homeDir: string) {
  let text = '';
  const stdout = {
    write(value: string) {
      text += String(value);
      return true;
    },
  } as any;
  const stderr = {
    write() {
      return true;
    },
  } as any;
  const exitCode = await runCli(argv, { stdout, stderr, runtimeRoot, homeDir });
  return { exitCode, text, json: text.trim().startsWith('{') ? JSON.parse(text) : null };
}

async function roots() {
  return {
    runtimeRoot: await mkdtemp('/tmp/snc-'),
    homeDir: await mkdtemp(join(tmpdir(), 'syncnos-cli-home-')),
  };
}

describe('syncnos CLI instance selection', () => {
  it('auto-selects the only online instance and reads revisions through its endpoint', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const helium = await startFakeInstance(runtimeRoot, 'helium-main', 'chromium');
    try {
      const status = await run(['status'], runtimeRoot, homeDir);
      expect(status.exitCode).toBe(0);
      expect(status.json.data.instance.cliInstanceId).toBe('helium-main');

      const revision = await run(['revision'], runtimeRoot, homeDir);
      expect(revision.exitCode).toBe(0);
      expect(revision.json.data.revision).toEqual({ conversations: 11 });
    } finally {
      await helium.stop();
    }
  });

  it('fails closed with two online browsers until a default is explicitly set', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const helium = await startFakeInstance(runtimeRoot, 'helium-main', 'chromium');
    const zen = await startFakeInstance(runtimeRoot, 'zen-secondary', 'firefox');
    try {
      const ambiguous = await run(['status'], runtimeRoot, homeDir);
      expect(ambiguous.exitCode).toBe(3);
      expect(ambiguous.json.error.code).toBe('instance_ambiguous');
      expect([...ambiguous.json.error.extra.candidates].sort()).toEqual(['helium-main', 'zen-secondary']);

      const setDefault = await run(['instances', '--set-default', 'helium-main'], runtimeRoot, homeDir);
      expect(setDefault.exitCode).toBe(0);
      expect(setDefault.json.data.preferredCliInstanceId).toBe('helium-main');

      const defaultStatus = await run(['status'], runtimeRoot, homeDir);
      expect(defaultStatus.json.data.instance.cliInstanceId).toBe('helium-main');
      expect(defaultStatus.json.data.instance.preferred).toBe(true);

      const explicitZen = await run(['revision', '--instance', 'zen-secondary'], runtimeRoot, homeDir);
      expect(explicitZen.exitCode).toBe(0);
      expect(explicitZen.json.data.instance.cliInstanceId).toBe('zen-secondary');
      expect(explicitZen.json.data.revision).toEqual({ conversations: 22 });
    } finally {
      await helium.stop();
      await zen.stop();
    }
  });

  it('keeps an offline preferred id but temporarily uses the only other online instance', async () => {
    const { runtimeRoot, homeDir } = await roots();
    await setPreferredInstance('helium-main', { homeDir });
    const zen = await startFakeInstance(runtimeRoot, 'zen-secondary', 'firefox');
    try {
      const status = await run(['status'], runtimeRoot, homeDir);
      expect(status.exitCode).toBe(0);
      expect(status.json.data.instance.cliInstanceId).toBe('zen-secondary');
      expect(status.json.data.instance.preferred).toBe(false);

      const instances = await run(['instances'], runtimeRoot, homeDir);
      expect(instances.json.data.preferredCliInstanceId).toBe('helium-main');
    } finally {
      await zen.stop();
    }
  });

  it('keeps ambiguity when the preferred instance is offline and multiple other instances are online', async () => {
    const { runtimeRoot, homeDir } = await roots();
    await setPreferredInstance('offline-main', { homeDir });
    const one = await startFakeInstance(runtimeRoot, 'browser-a', 'chromium');
    const two = await startFakeInstance(runtimeRoot, 'browser-b', 'firefox');
    try {
      const status = await run(['status'], runtimeRoot, homeDir);
      expect(status.exitCode).toBe(3);
      expect(status.json.error.code).toBe('instance_ambiguous');
    } finally {
      await one.stop();
      await two.stop();
    }
  });

  it('never falls back from an explicitly requested offline instance', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const online = await startFakeInstance(runtimeRoot, 'online-one', 'chromium');
    try {
      const status = await run(['status', '--instance', 'offline-one'], runtimeRoot, homeDir);
      expect(status.exitCode).toBe(3);
      expect(status.json.error.code).toBe('instance_offline');
    } finally {
      await online.stop();
    }
  });

  it('cleans confirmed stale registry entries but doctor can report them without cleanup', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
    const id = 'stale-one';
    const registryPath = registryPathForInstance(runtimeDir, id);
    await writeRegistryEntry(registryPath, {
      cliInstanceId: id,
      endpoint: socketPathForInstance(runtimeDir, id),
      pid: 999999,
      processNonce: 'stale-nonce',
      browserFamily: 'chromium',
      runtimeId: 'stale-runtime',
      extensionVersion: '1.0.0',
      protocolVersion: contract.protocolVersion,
      startedAt: Date.now(),
    });

    const doctor = await run(['doctor'], runtimeRoot, homeDir);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json.data.offline).toEqual([{ cliInstanceId: id, reason: 'ENOENT' }]);

    const instances = await run(['instances'], runtimeRoot, homeDir);
    expect(instances.exitCode).toBe(0);
    expect(instances.json.data.instances).toEqual([]);
    await expect(import('node:fs/promises').then(({ lstat }) => lstat(registryPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not delete a reachable registry whose endpoint returns malformed data', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
    const id = 'malformed-online';
    const endpoint = socketPathForInstance(runtimeDir, id);
    const registryPath = registryPathForInstance(runtimeDir, id);
    const server = createServer((socket) => {
      socket.once('data', () => socket.end('{not-json}\n'));
    });
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await writeRegistryEntry(registryPath, {
      cliInstanceId: id,
      endpoint,
      pid: process.pid,
      processNonce: 'malformed-online-nonce',
      browserFamily: 'chromium',
      runtimeId: 'runtime-malformed',
      extensionVersion: '1.2.3',
      protocolVersion: contract.protocolVersion,
      startedAt: Date.now(),
    });
    try {
      const instances = await run(['instances'], runtimeRoot, homeDir);
      expect(instances.exitCode).toBe(0);
      expect(instances.json.data.instances).toEqual([]);
      await expect(lstat(registryPath)).resolves.toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps transport/protocol failures in exit class 4 and business failures in exit class 5', async () => {
    const transportRoots = await roots();
    const transport = await startFakeInstance(transportRoots.runtimeRoot, 'transport-instance', 'chromium', {
      revisionErrorCode: 'transport_error',
    });
    try {
      const result = await run(['revision'], transportRoots.runtimeRoot, transportRoots.homeDir);
      expect(result.exitCode).toBe(4);
      expect(result.json.error.code).toBe('transport_error');
    } finally {
      await transport.stop();
    }

    const businessRoots = await roots();
    const business = await startFakeInstance(businessRoots.runtimeRoot, 'business-instance', 'chromium', {
      revisionErrorCode: 'revision_unavailable',
    });
    try {
      const result = await run(['revision'], businessRoots.runtimeRoot, businessRoots.homeDir);
      expect(result.exitCode).toBe(5);
      expect(result.json.error.code).toBe('revision_unavailable');
    } finally {
      await business.stop();
    }
  });

  it('serializes list cursor tokens and sends validated list filters to the selected instance', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'query-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'conversation.list') {
          return {
            data: {
              items: [{ id: 9 }],
              cursor: { lastActivityAt: 123.5, id: 9 },
              hasMore: true,
            },
          };
        }
        return null;
      },
    });
    try {
      const result = await run(
        ['list', '--source', 'web', '--site', 'domain:example.com', '--limit', '10', '--cursor', '456,12'],
        runtimeRoot,
        homeDir,
      );
      expect(result.exitCode).toBe(0);
      expect(result.json.data.cursor).toBe('123.5,9');
      expect(instance.requests.at(-1)).toEqual({
        method: 'conversation.list',
        params: {
          sourceKey: 'web',
          siteKey: 'domain:example.com',
          limit: 10,
          cursor: { lastActivityAt: 456, id: 12 },
        },
      });
    } finally {
      await instance.stop();
    }
  });

  it('rejects malformed list cursors before any business RPC is sent', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'query-instance', 'chromium');
    try {
      for (const cursor of ['bad', '1,0', 'nope,1', '1,1.5']) {
        const before = instance.requests.length;
        const result = await run(['list', '--cursor', cursor], runtimeRoot, homeDir);
        expect(result.exitCode).toBe(2);
        expect(result.json.error.code).toBe('usage_error');
        expect(instance.requests.length).toBe(before + 1);
        expect(instance.requests.at(-1).method).toBe('system.ping');
      }
    } finally {
      await instance.stop();
    }
  });

  it('routes get/search/stats with machine-safe arguments and output', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'query-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'conversation.get') {
          return { data: { conversation: { id: request.params.conversationId }, messages: [{ messageKey: 'm1' }] } };
        }
        if (request.method === 'conversation.search') {
          return { data: [{ conversation: { id: 7 }, hit: { field: 'message', snippet: 'needle' } }] };
        }
        if (request.method === 'conversation.stats') {
          return {
            data: {
              totalCount: 8,
              todayCount: 2,
              sources: [{ key: 'chatgpt', count: 5 }],
              sites: [{ key: 'domain:example.com', count: 3 }],
            },
          };
        }
        return null;
      },
    });
    try {
      const get = await run(['get', '42'], runtimeRoot, homeDir);
      expect(get.exitCode).toBe(0);
      expect(get.json.data).toEqual({ conversation: { id: 42 }, messages: [{ messageKey: 'm1' }] });
      expect(instance.requests.at(-1)).toEqual({ method: 'conversation.get', params: { conversationId: 42 } });

      const search = await run(
        [
          'search',
          'needle',
          'phrase',
          '--source',
          'chatgpt',
          '--site',
          'domain:example.com',
          '--after',
          '2026-09-01T00:00:00Z',
          '--before',
          '2026-09-13T00:00:00Z',
          '--limit',
          '999',
        ],
        runtimeRoot,
        homeDir,
      );
      expect(search.exitCode).toBe(0);
      expect(search.json.data).toEqual([{ conversation: { id: 7 }, hit: { field: 'message', snippet: 'needle' } }]);
      expect(instance.requests.at(-1)).toEqual({
        method: 'conversation.search',
        params: {
          query: 'needle phrase',
          sourceKey: 'chatgpt',
          siteKey: 'domain:example.com',
          after: Date.parse('2026-09-01T00:00:00Z'),
          before: Date.parse('2026-09-13T00:00:00Z'),
          limit: 100,
        },
      });

      const stats = await run(['stats'], runtimeRoot, homeDir);
      expect(stats.exitCode).toBe(0);
      expect(stats.json.data).toEqual({
        totalCount: 8,
        todayCount: 2,
        sources: [{ key: 'chatgpt', count: 5 }],
        sites: [{ key: 'domain:example.com', count: 3 }],
      });
    } finally {
      await instance.stop();
    }
  });

  it('rejects invalid query arguments before dispatching business RPC', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'query-instance', 'chromium');
    try {
      const invalidId = await run(['get', '0'], runtimeRoot, homeDir);
      expect(invalidId.exitCode).toBe(2);
      const invalidDate = await run(['search', 'needle', '--after', '2026-09-01'], runtimeRoot, homeDir);
      expect(invalidDate.exitCode).toBe(2);
      const invalidRange = await run(
        ['search', 'needle', '--after', '2026-09-13T00:00:00Z', '--before', '2026-09-01T00:00:00Z'],
        runtimeRoot,
        homeDir,
      );
      expect(invalidRange.exitCode).toBe(2);
      expect(instance.requests.every((request) => request.method === 'system.ping')).toBe(true);
    } finally {
      await instance.stop();
    }
  });

  it('routes mutation commands without mandatory read-back and resolves backfill URL only when needed', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'mutation-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'conversation.update-url') {
          if (String(request.params.url || '').includes('/target') && request.params.mergeExisting !== true) {
            return {
              errorCode: 'url_conflict',
              errorMessage: 'URL already belongs to another conversation',
              errorExtra: { conflictConversationId: 9 },
            };
          }
          return {
            data: {
              status: 'updated',
              conversationId: request.params.conversationId,
              changed: true,
              merged: request.params.mergeExisting,
              conflictConversationId: null,
            },
          };
        }
        if (request.method === 'conversation.merge') return { data: { merged: true } };
        if (request.method === 'conversation.delete')
          return { data: { deleted: request.params.conversationIds.length } };
        if (request.method === 'conversation.get') {
          return {
            data: {
              conversation: { id: request.params.conversationId, url: 'https://example.com/article' },
              messages: [],
            },
          };
        }
        if (request.method === 'conversation.images.backfill') return { data: { fetched: 2 } };
        return null;
      },
    });
    try {
      const update = await run(
        ['conversation', 'update-url', '7', 'https://example.com/new', '--merge-existing'],
        runtimeRoot,
        homeDir,
      );
      expect(update.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'conversation.update-url',
        params: { conversationId: 7, url: 'https://example.com/new', mergeExisting: true },
      });

      const merge = await run(['conversation', 'merge', '--keep', '7', '--remove', '9'], runtimeRoot, homeDir);
      expect(merge.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'conversation.merge',
        params: { keepConversationId: 7, removeConversationId: 9 },
      });

      const del = await run(['conversation', 'delete', '7', '9'], runtimeRoot, homeDir);
      expect(del.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'conversation.delete', params: { conversationIds: [7, 9] } });

      const conflict = await run(
        ['conversation', 'update-url', '7', 'https://example.com/target'],
        runtimeRoot,
        homeDir,
      );
      expect(conflict.exitCode).toBe(5);
      expect(conflict.json).toMatchObject({
        ok: false,
        error: { code: 'url_conflict', extra: { conflictConversationId: 9 } },
      });

      const mergedConflict = await run(
        ['conversation', 'update-url', '7', 'https://example.com/target', '--merge-existing'],
        runtimeRoot,
        homeDir,
      );
      expect(mergedConflict.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'conversation.update-url',
        params: { conversationId: 7, url: 'https://example.com/target', mergeExisting: true },
      });

      const beforeBackfill = instance.requests.length;
      const backfill = await run(['conversation', 'backfill-images', '7'], runtimeRoot, homeDir);
      expect(backfill.exitCode).toBe(0);
      expect(instance.requests.slice(beforeBackfill).map((request) => request.method)).toEqual([
        'system.ping',
        'conversation.get',
        'conversation.images.backfill',
      ]);
      expect(instance.requests.at(-1)).toEqual({
        method: 'conversation.images.backfill',
        params: { conversationId: 7, conversationUrl: 'https://example.com/article' },
      });

      const beforeLegacyForms = instance.requests.length;
      const legacyResults = await Promise.all([
        run(['update-url', '7', 'https://example.com/new'], runtimeRoot, homeDir),
        run(['merge', '7', '9'], runtimeRoot, homeDir),
        run(['delete', '7'], runtimeRoot, homeDir),
        run(['backfill-images', '7'], runtimeRoot, homeDir),
        run(['conversation', 'update-url', '7', 'https://example.com/new', '--merge-conflict'], runtimeRoot, homeDir),
      ]);
      expect(legacyResults.map((result) => result.exitCode)).toEqual([2, 2, 2, 2, 2]);
      expect(instance.requests.length).toBe(beforeLegacyForms);
    } finally {
      await instance.stop();
    }
  });

  it('routes capture through the single current-page RPC and rejects video-specific positional variants', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'capture-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'capture.current-page') {
          return {
            data: {
              kind: 'video',
              label: 'Video',
              collectorId: 'video:bilibili',
              conversationId: 77,
              isNew: false,
              subtitleStatus: 'empty',
            },
          };
        }
        return null;
      },
    });
    try {
      const capture = await run(['capture'], runtimeRoot, homeDir);
      expect(capture.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'capture.current-page', params: {} });
      expect(capture.json.data).toMatchObject({
        kind: 'video',
        conversationId: 77,
        subtitleStatus: 'empty',
      });

      const beforeInvalid = instance.requests.length;
      const videoSpecific = await run(['capture', 'video'], runtimeRoot, homeDir);
      expect(videoSpecific.exitCode).toBe(2);
      expect(videoSpecific.json.error.code).toBe('usage_error');
      expect(instance.requests.length).toBe(beforeInvalid);
    } finally {
      await instance.stop();
    }
  });

  it('routes comment and mention commands without any raw locator surface', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'comment-instance', 'chromium', {
      onRequest(request) {
        if (request.method.startsWith('comments.')) return { data: { ok: true } };
        if (request.method.startsWith('mention.')) return { data: { ok: true } };
        return null;
      },
    });
    try {
      const add = await run(['comments', 'add', '7', '--text', 'plain root'], runtimeRoot, homeDir);
      expect(add.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'comments.add',
        params: { conversationId: 7, text: 'plain root' },
      });
      expect(JSON.stringify(instance.requests.at(-1))).not.toContain('locator');

      const reply = await run(['comments', 'reply', '7', '3', '--text', 'plain reply'], runtimeRoot, homeDir);
      expect(reply.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'comments.reply',
        params: { conversationId: 7, parentId: 3, text: 'plain reply' },
      });
      expect(JSON.stringify(instance.requests.at(-1))).not.toContain('locator');

      const del = await run(['comments', 'delete', '9'], runtimeRoot, homeDir);
      expect(del.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'comments.delete',
        params: { commentId: 9 },
      });

      const mentionRecent = await run(['mention', 'search', '--limit', '20'], runtimeRoot, homeDir);
      expect(mentionRecent.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'mention.search', params: { query: '', limit: 20 } });

      const mentionSearch = await run(['mention', 'search', 'mcp', '--limit', '50'], runtimeRoot, homeDir);
      expect(mentionSearch.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'mention.search', params: { query: 'mcp', limit: 50 } });

      const mentionBuild = await run(['mention', 'build', '42'], runtimeRoot, homeDir);
      expect(mentionBuild.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'mention.build-insert-text', params: { conversationId: 42 } });

      const beforeLegacyForms = instance.requests.length;
      expect((await run(['comments', 'add', '7', 'legacy', 'text'], runtimeRoot, homeDir)).exitCode).toBe(2);
      expect((await run(['comments', 'delete', '7', '9'], runtimeRoot, homeDir)).exitCode).toBe(2);
      expect((await run(['mention', 'insert', '42'], runtimeRoot, homeDir)).exitCode).toBe(2);
      expect((await run(['comments', 'add', '7', '--locator', '{}'], runtimeRoot, homeDir)).exitCode).toBe(2);
      expect(instance.requests.length).toBe(beforeLegacyForms);
    } finally {
      await instance.stop();
    }
  });

  it('selection helper encodes the public priority without recent-start heuristics', () => {
    const a = { entry: { cliInstanceId: 'a' } } as any;
    const b = { entry: { cliInstanceId: 'b' } } as any;
    expect(selectInstance([a, b], { explicitId: 'b', preferredId: 'a' })).toBe(b);
    expect(selectInstance([a, b], { preferredId: 'a' })).toBe(a);
    expect(selectInstance([b], { preferredId: 'offline' })).toBe(b);
    expect(() => selectInstance([a, b])).toThrowError(expect.objectContaining({ code: 'instance_ambiguous' }));
  });
});
