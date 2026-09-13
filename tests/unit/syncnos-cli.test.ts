import { createServer, type Server } from 'node:net';
import { chmod, lstat, mkdtemp, readFile } from 'node:fs/promises';
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
    responseProtocolVersion?: number;
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
                protocolVersion: options.responseProtocolVersion ?? contract.protocolVersion,
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
          protocolVersion: options.responseProtocolVersion ?? contract.protocolVersion,
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

async function run(argv: string[], runtimeRoot: string, homeDir: string, extra: Record<string, unknown> = {}) {
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
  const exitCode = await runCli(argv, { stdout, stderr, runtimeRoot, homeDir, ...extra });
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

  it('auto-discovers installed browsers, deduplicates registrations, and reports the split evidence', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const browserPathExists = async (path: string) =>
      path === '/Applications/Helium.app' || path === '/Applications/Zen.app';

    const installed = await run(['install'], runtimeRoot, homeDir, { platform: 'darwin', browserPathExists });
    expect(installed.exitCode).toBe(0);
    expect(installed.json.data.detectedBrowsers.map((item: any) => item.id)).toEqual(['helium', 'zen']);
    expect(installed.json.data.registeredTargets).toEqual([
      expect.objectContaining({ registrationId: 'chrome', sharedByBrowsers: ['helium'] }),
      expect.objectContaining({ registrationId: 'mozilla', sharedByBrowsers: ['zen'] }),
    ]);
    expect(installed.json.data.notDetected).toEqual(expect.arrayContaining(['chrome', 'firefox']));

    const doctor = await run(['doctor'], runtimeRoot, homeDir, { platform: 'darwin', browserPathExists });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json.data.installation.detectedBrowsers.map((item: any) => item.id)).toEqual(['helium', 'zen']);
    expect(doctor.json.data.installation.registrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ registrationId: 'chrome', present: true, valid: true }),
        expect.objectContaining({ registrationId: 'mozilla', present: true, valid: true }),
      ]),
    );
    expect(doctor.json.data.installationHealthy).toBe(true);

    const removed = await run(['uninstall'], runtimeRoot, homeDir, { platform: 'darwin' });
    expect(removed.exitCode).toBe(0);
    expect(removed.json.data.launcherRemoved).toBe(true);
    for (const target of installed.json.data.registeredTargets) {
      await expect(lstat(target.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('installs/uninstalls a selected browser in temp HOME and doctor reports only provable reachability state', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const installed = await run(['install', '--browser', 'chrome'], runtimeRoot, homeDir, { platform: 'darwin' });
    expect(installed.exitCode).toBe(0);
    expect(installed.json.data).toMatchObject({ browser: 'chrome', productionIdentity: true });
    const manifest = JSON.parse(await readFile(installed.json.data.manifestPath, 'utf8'));
    expect(manifest.allowed_origins).toEqual([
      'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/',
      'chrome-extension://ijkpghlfmkbjcgafapjcjahaikmnjncl/',
    ]);

    const doctor = await run(['doctor'], runtimeRoot, homeDir, {
      platform: 'darwin',
      browserPathExists: async () => false,
    });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json.data.healthy).toBe(false);
    expect(doctor.json.data.installationHealthy).toBe(true);
    expect(doctor.json.data.diagnosis).toEqual({
      code: 'extension_unreachable',
      message: 'Native Messaging is installed, but no SyncNos browser instance is currently reachable.',
      candidateReasons: [
        'browser_not_running',
        'local_cli_integration_disabled',
        'native_messaging_permission_not_granted_or_revoked',
      ],
    });
    expect(doctor.json.data.installation.registrations).toEqual([
      expect.objectContaining({ registrationId: 'chrome', present: true, valid: true }),
    ]);

    const removed = await run(['uninstall', '--browser', 'chrome'], runtimeRoot, homeDir, { platform: 'darwin' });
    expect(removed.exitCode).toBe(0);
    expect(removed.json.data.launcherRemoved).toBe(true);
    await expect(lstat(installed.json.data.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(installed.json.data.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps doctor healthy with one online instance even when another supported browser manifest is absent', async () => {
    const { runtimeRoot, homeDir } = await roots();
    await run(['install', '--browser', 'chrome'], runtimeRoot, homeDir, { platform: 'darwin' });
    const instance = await startFakeInstance(runtimeRoot, 'doctor-online', 'chromium');
    try {
      const doctor = await run(['doctor'], runtimeRoot, homeDir, {
        platform: 'darwin',
        browserPathExists: async (path: string) =>
          path === '/Applications/Helium.app' || path === '/Applications/Zen.app',
      });
      expect(doctor.exitCode).toBe(0);
      expect(doctor.json.data.healthy).toBe(true);
      expect(doctor.json.data.diagnosis.code).toBe('ok');
      expect(doctor.json.data.selectedCliInstanceId).toBe('doctor-online');
      expect(
        doctor.json.data.installation.registrations.find((item: any) => item.registrationId === 'mozilla'),
      ).toMatchObject({ present: false });
    } finally {
      await instance.stop();
    }
  });

  it('diagnoses protocol mismatch ahead of generic extension_unreachable', async () => {
    const { runtimeRoot, homeDir } = await roots();
    await run(['install', '--browser', 'chrome'], runtimeRoot, homeDir, { platform: 'darwin' });
    const instance = await startFakeInstance(runtimeRoot, 'protocol-old', 'chromium', {
      responseProtocolVersion: contract.protocolVersion + 1,
    });
    try {
      const doctor = await run(['doctor'], runtimeRoot, homeDir, { platform: 'darwin' });
      expect(doctor.exitCode).toBe(0);
      expect(doctor.json.data.healthy).toBe(false);
      expect(doctor.json.data.diagnosis.code).toBe('protocol_mismatch');
      expect(doctor.json.data.offline).toEqual([{ cliInstanceId: 'protocol-old', reason: 'protocol_mismatch' }]);
    } finally {
      await instance.stop();
    }
  });

  it('diagnoses stale manifest permissions as an invalid native-host install', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const installed = await run(['install', '--browser', 'chrome'], runtimeRoot, homeDir, { platform: 'darwin' });
    await chmod(installed.json.data.manifestPath, 0o644);
    const doctor = await run(['doctor'], runtimeRoot, homeDir, {
      platform: 'darwin',
      browserPathExists: async () => false,
    });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json.data.installationHealthy).toBe(false);
    expect(doctor.json.data.diagnosis.code).toBe('native_host_install_invalid');
    expect(
      doctor.json.data.installation.registrations.find((item: any) => item.registrationId === 'chrome'),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['manifest_mode']),
    });
  });

  it('rejects install/uninstall/doctor-only syntax before touching instance discovery', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const missingBrowser = await run(['install'], runtimeRoot, homeDir, {
      platform: 'darwin',
      browserPathExists: async () => false,
    });
    expect(missingBrowser.exitCode).toBe(5);
    expect(missingBrowser.json.error.code).toBe('browser_not_found');

    const autoExtensionId = await run(
      ['install', '--extension-id', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      runtimeRoot,
      homeDir,
      { platform: 'darwin', browserPathExists: async () => false },
    );
    expect(autoExtensionId.exitCode).toBe(2);
    expect(autoExtensionId.json.error.code).toBe('usage_error');

    const uninstallExtensionId = await run(
      ['uninstall', '--extension-id', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      runtimeRoot,
      homeDir,
      { platform: 'darwin' },
    );
    expect(uninstallExtensionId.exitCode).toBe(2);
    expect(uninstallExtensionId.json.error.code).toBe('usage_error');

    const doctorBrowser = await run(['doctor', '--browser', 'chrome'], runtimeRoot, homeDir, { platform: 'darwin' });
    expect(doctorBrowser.exitCode).toBe(2);
    expect(doctorBrowser.json.error.code).toBe('usage_error');
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

  it('rejects invalid provider syntax before attempting browser instance discovery', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const invalidAction = await run(['notion', 'nonsense'], runtimeRoot, homeDir);
    expect(invalidAction.exitCode).toBe(2);
    expect(invalidAction.json.error.code).toBe('usage_error');

    const invalidKey = await run(['feishu', 'config', 'set', 'raw-storage-key', 'value'], runtimeRoot, homeDir);
    expect(invalidKey.exitCode).toBe(2);
    expect(invalidKey.json.error.code).toBe('usage_error');
  });

  it('returns canonical capabilities offline without discovering or pinging a browser instance', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const result = await run(['capabilities'], runtimeRoot, homeDir);
    expect(result.exitCode).toBe(0);
    expect(result.json.data).toEqual({
      protocolVersion: contract.protocolVersion,
      publicMethods: contract.publicMethods,
      browserRequired: contract.browserRequired,
    });
    expect(result.json.data.browserRequired).toEqual([
      {
        capability: 'comments.selection-locator',
        reason: 'Requires live webpage DOM selection context.',
      },
      {
        capability: 'oauth.user-approval',
        providers: ['notion', 'feishu', 'github'],
        reason: 'Requires browser-mediated user approval.',
      },
    ]);

    for (const entry of contract.browserRequired) {
      const attempted = await run([entry.capability], runtimeRoot, homeDir);
      expect(attempted.exitCode).toBe(2);
      expect(attempted.json.error.code).toBe('usage_error');
    }
  });

  it('routes open resolve/launch only through declared target providers and never accepts a caller URL', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'open-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'open.resolve') {
          return {
            data: {
              targets: [
                {
                  provider: request.params.target || 'source',
                  available: true,
                  kind: 'external-url',
                  target: 'https://current.example/item',
                  availabilityState: 'ready',
                },
              ],
            },
          };
        }
        if (request.method === 'open.launch') {
          return {
            data: {
              launched: true,
              target: {
                provider: request.params.target,
                available: true,
                kind: 'external-url',
                target: 'https://current.example/item',
                availabilityState: 'ready',
              },
            },
          };
        }
        return null;
      },
    });
    try {
      const all = await run(['open', '7'], runtimeRoot, homeDir);
      expect(all.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'open.resolve', params: { conversationId: 7 } });

      const notion = await run(['open', '7', '--target', 'notion'], runtimeRoot, homeDir);
      expect(notion.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'open.resolve',
        params: { conversationId: 7, target: 'notion' },
      });

      const launched = await run(['open', '7', '--target', 'source', '--launch'], runtimeRoot, homeDir);
      expect(launched.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'open.launch',
        params: { conversationId: 7, target: 'source' },
      });
      expect(JSON.stringify(instance.requests.at(-1))).not.toContain('current.example');
    } finally {
      await instance.stop();
    }
  });

  it('rejects unsafe/incomplete open syntax before attempting browser discovery', async () => {
    const { runtimeRoot, homeDir } = await roots();
    for (const argv of [
      ['open', '7', '--launch'],
      ['open', '7', '--target', 'javascript:alert(1)'],
      ['open', '7', 'https://attacker.example/', '--target', 'source', '--launch'],
      ['open'],
    ]) {
      const result = await run(argv, runtimeRoot, homeDir);
      expect(result.exitCode).toBe(2);
      expect(result.json.error.code).toBe('usage_error');
    }
  });

  it('routes settings through schema-driven public RPCs and rejects raw/invalid values before settings.set', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const schema = [
      { key: 'capture.ai-chat-auto-save', type: 'boolean', default: true },
      { key: 'reader.prefs', type: 'object', clamp: true },
      { key: 'reader.tts.ai-api-key', type: 'secret', writeOnly: true, present: false },
    ];
    const instance = await startFakeInstance(runtimeRoot, 'settings-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'settings.schema') return { data: schema };
        if (request.method === 'settings.get') {
          return { data: request.params.key ? { key: request.params.key, value: true } : { all: true } };
        }
        if (request.method === 'settings.set') {
          if (request.params.key === 'reader.tts.ai-api-key')
            return { data: { key: request.params.key, value: { present: true } } };
          return { data: { key: request.params.key, value: request.params.value } };
        }
        return null;
      },
    });
    try {
      const schemaResult = await run(['settings', 'schema'], runtimeRoot, homeDir);
      expect(schemaResult.exitCode).toBe(0);
      expect(schemaResult.json.data).toEqual(schema);
      expect(instance.requests.at(-1)).toEqual({ method: 'settings.schema', params: {} });

      const getAll = await run(['settings', 'get'], runtimeRoot, homeDir);
      expect(getAll.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'settings.get', params: {} });

      const getOne = await run(['settings', 'get', 'capture.ai-chat-auto-save'], runtimeRoot, homeDir);
      expect(getOne.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'settings.get',
        params: { key: 'capture.ai-chat-auto-save' },
      });

      const booleanWrite = await run(['settings', 'set', 'capture.ai-chat-auto-save', 'false'], runtimeRoot, homeDir);
      expect(booleanWrite.exitCode).toBe(0);
      expect(instance.requests.slice(-2)).toEqual([
        { method: 'settings.schema', params: {} },
        { method: 'settings.set', params: { key: 'capture.ai-chat-auto-save', value: false } },
      ]);

      const objectWrite = await run(
        ['settings', 'set', 'reader.prefs', '{"fontSize":24,"tts":{"rate":1.25}}'],
        runtimeRoot,
        homeDir,
      );
      expect(objectWrite.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'settings.set',
        params: { key: 'reader.prefs', value: { fontSize: 24, tts: { rate: 1.25 } } },
      });

      const secretWrite = await run(
        ['settings', 'set', 'reader.tts.ai-api-key', 'secret-sentinel'],
        runtimeRoot,
        homeDir,
      );
      expect(secretWrite.exitCode).toBe(0);
      expect(secretWrite.json.data).toEqual({ key: 'reader.tts.ai-api-key', value: { present: true } });
      expect(JSON.stringify(secretWrite.json)).not.toContain('secret-sentinel');
      expect(instance.requests.at(-1)).toEqual({
        method: 'settings.set',
        params: { key: 'reader.tts.ai-api-key', value: 'secret-sentinel' },
      });

      const beforeUnknown = instance.requests.length;
      const unknown = await run(['settings', 'set', 'cli-integration-enabled', 'true'], runtimeRoot, homeDir);
      expect(unknown.exitCode).toBe(5);
      expect(unknown.json.error.code).toBe('settings_unknown_key');
      expect(instance.requests.length).toBe(beforeUnknown + 2);
      expect(instance.requests.slice(-2).map((request) => request.method)).toEqual(['system.ping', 'settings.schema']);

      const beforeInvalidBoolean = instance.requests.length;
      const invalidBoolean = await run(['settings', 'set', 'capture.ai-chat-auto-save', 'yes'], runtimeRoot, homeDir);
      expect(invalidBoolean.exitCode).toBe(2);
      expect(invalidBoolean.json.error.code).toBe('usage_error');
      expect(instance.requests.length).toBe(beforeInvalidBoolean + 2);
      expect(instance.requests.slice(-2).map((request) => request.method)).toEqual(['system.ping', 'settings.schema']);

      const beforeInvalidJson = instance.requests.length;
      const invalidJson = await run(['settings', 'set', 'reader.prefs', '{bad'], runtimeRoot, homeDir);
      expect(invalidJson.exitCode).toBe(2);
      expect(invalidJson.json.error.code).toBe('usage_error');
      expect(instance.requests.length).toBe(beforeInvalidJson + 2);
      expect(instance.requests.slice(-2).map((request) => request.method)).toEqual(['system.ping', 'settings.schema']);
    } finally {
      await instance.stop();
    }
  });

  it('rejects incomplete settings syntax before attempting browser instance discovery', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const result = await run(['settings', 'set', 'theme.mode'], runtimeRoot, homeDir);
    expect(result.exitCode).toBe(2);
    expect(result.json.error.code).toBe('usage_error');
  });

  it('routes export/backup file commands with explicit absolute host paths and metadata-only stdout', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const outputPath = join(homeDir, 'selected.zip');
    const inputPath = join(homeDir, 'restore.zip');
    const instance = await startFakeInstance(runtimeRoot, 'file-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'export.markdown') {
          return {
            data: { format: 'markdown', path: request.params.outputPath, byteSize: 12, sha256: 'a'.repeat(64) },
          };
        }
        if (request.method === 'export.json') {
          return { data: { format: 'json', path: request.params.outputPath, byteSize: 13, sha256: 'b'.repeat(64) } };
        }
        if (request.method === 'backup.export') {
          return { data: { format: 'backup', path: request.params.outputPath, byteSize: 14, sha256: 'c'.repeat(64) } };
        }
        if (request.method === 'backup.import') {
          return {
            data: { path: request.params.inputPath, byteSize: 15, sha256: 'd'.repeat(64), conversationsAdded: 2 },
          };
        }
        return null;
      },
    });
    try {
      const markdown = await run(
        ['export', 'markdown', '7', '9', '--output', outputPath, '--force'],
        runtimeRoot,
        homeDir,
      );
      expect(markdown.exitCode).toBe(0);
      expect(markdown.json.data).toEqual({
        format: 'markdown',
        path: outputPath,
        byteSize: 12,
        sha256: 'a'.repeat(64),
      });
      expect(JSON.stringify(markdown.json)).not.toMatch(/base64|file-chunk/i);
      expect(instance.requests.at(-1)).toEqual({
        method: 'export.markdown',
        params: { conversationIds: [7, 9], outputPath, force: true },
      });

      const json = await run(['export', 'json', '7', '--output', outputPath], runtimeRoot, homeDir);
      expect(json.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'export.json',
        params: { conversationIds: [7], outputPath, force: false },
      });

      const backupExport = await run(['backup', 'export', '--output', outputPath], runtimeRoot, homeDir);
      expect(backupExport.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'backup.export',
        params: { outputPath, force: false },
      });

      const backupImport = await run(['backup', 'import', inputPath], runtimeRoot, homeDir);
      expect(backupImport.exitCode).toBe(0);
      expect(backupImport.json.data).toMatchObject({ path: inputPath, conversationsAdded: 2 });
      expect(instance.requests.at(-1)).toEqual({ method: 'backup.import', params: { inputPath } });
    } finally {
      await instance.stop();
    }
  });

  it('rejects incomplete file command syntax before browser instance discovery', async () => {
    const { runtimeRoot, homeDir } = await roots();
    for (const argv of [
      ['export', 'markdown', '1'],
      ['export', 'json', '--output', 'out.zip'],
      ['backup', 'export'],
      ['backup', 'import'],
    ]) {
      const result = await run(argv, runtimeRoot, homeDir);
      expect(result.exitCode).toBe(2);
      expect(result.json.error.code).toBe('usage_error');
    }
  });

  it('routes provider auth/config commands through safe public RPCs', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'provider-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'notion.auth.start') return { data: { started: true, browserOpened: true } };
        if (request.method === 'feishu.config.get') {
          return {
            data: {
              auth: { clientId: 'app-id', clientSecretPresent: true, tokenExchangeProxyUrl: '' },
              paths: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
            },
          };
        }
        if (request.method === 'feishu.config.set') return { data: { auth: { clientSecretPresent: true } } };
        if (request.method === 'obsidian.config.set') return { data: { apiKeyPresent: true, apiKeyMasked: '***' } };
        if (request.method === 'github.auth.poll') return { data: { state: 'pending', userCode: 'ABCD-EFGH' } };
        return null;
      },
    });
    try {
      const notionStart = await run(['notion', 'auth', 'start'], runtimeRoot, homeDir);
      expect(notionStart.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'notion.auth.start', params: {} });
      expect(JSON.stringify(notionStart.json)).not.toContain('state');

      const feishuGet = await run(['feishu', 'config', 'get'], runtimeRoot, homeDir);
      expect(feishuGet.exitCode).toBe(0);
      expect(feishuGet.json.data.auth).toEqual({
        clientId: 'app-id',
        clientSecretPresent: true,
        tokenExchangeProxyUrl: '',
      });
      expect(feishuGet.json.data.auth).not.toHaveProperty('clientSecret');

      const feishuSecret = await run(
        ['feishu', 'config', 'set', 'client-secret', 'replacement-secret'],
        runtimeRoot,
        homeDir,
      );
      expect(feishuSecret.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'feishu.config.set',
        params: { clientSecret: 'replacement-secret' },
      });

      const obsidianSecret = await run(
        ['obsidian', 'config', 'set', 'api-key', 'obsidian-secret'],
        runtimeRoot,
        homeDir,
      );
      expect(obsidianSecret.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({
        method: 'obsidian.config.set',
        params: { apiKey: 'obsidian-secret' },
      });
      expect(obsidianSecret.json.data).not.toHaveProperty('apiKey');

      const githubPoll = await run(['github', 'auth', 'poll'], runtimeRoot, homeDir);
      expect(githubPoll.exitCode).toBe(0);
      expect(instance.requests.at(-1)).toEqual({ method: 'github.auth.poll', params: {} });
    } finally {
      await instance.stop();
    }
  });

  it('waits for the exact accepted sync job instead of accepting an older terminal snapshot', async () => {
    const { runtimeRoot, homeDir } = await roots();
    let statusReads = 0;
    const instance = await startFakeInstance(runtimeRoot, 'sync-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'sync.start') {
          return { data: { started: true, provider: 'notion', jobId: 'accepted-job' } };
        }
        if (request.method === 'sync.status') {
          statusReads += 1;
          if (statusReads === 1) {
            return { data: { provider: 'notion', active: true, job: { id: 'older-job', status: 'done' } } };
          }
          if (statusReads === 2) {
            return { data: { provider: 'notion', active: true, job: { id: 'accepted-job', status: 'running' } } };
          }
          return { data: { provider: 'notion', active: false, job: { id: 'accepted-job', status: 'done' } } };
        }
        return null;
      },
    });
    try {
      const result = await run(['sync', '7', '9', '--to', 'notion', '--timeout', '5'], runtimeRoot, homeDir);
      expect(result.exitCode).toBe(0);
      expect(result.json.data).toMatchObject({
        provider: 'notion',
        jobId: 'accepted-job',
        active: false,
        job: { id: 'accepted-job', status: 'done' },
      });
      expect(statusReads).toBe(3);
      expect(instance.requests.find((request) => request.method === 'sync.start')).toEqual({
        method: 'sync.start',
        params: { provider: 'notion', conversationIds: [7, 9] },
      });
    } finally {
      await instance.stop();
    }
  });

  it('reports sync_start_failed when the accepted job never becomes durable, and supports no-wait', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'sync-start-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'sync.start') {
          return { data: { started: true, provider: 'github', jobId: 'accepted-job' } };
        }
        if (request.method === 'sync.status') {
          return { data: { provider: 'github', active: false, job: { id: 'older-job', status: 'done' } } };
        }
        return null;
      },
    });
    try {
      const failed = await run(['sync', '7', '--to', 'github'], runtimeRoot, homeDir);
      expect(failed.exitCode).toBe(5);
      expect(failed.json.error.code).toBe('sync_start_failed');
      expect(failed.json.error.extra.jobId).toBe('accepted-job');

      const statusCount = instance.requests.filter((request) => request.method === 'sync.status').length;
      const noWait = await run(['sync', '7', '--to', 'github', '--no-wait'], runtimeRoot, homeDir);
      expect(noWait.exitCode).toBe(0);
      expect(noWait.json.data).toEqual({ started: true, provider: 'github', jobId: 'accepted-job' });
      expect(instance.requests.filter((request) => request.method === 'sync.status')).toHaveLength(statusCount);
    } finally {
      await instance.stop();
    }
  });

  it('times out waiting without sending a cancel or clear request', async () => {
    const { runtimeRoot, homeDir } = await roots();
    const instance = await startFakeInstance(runtimeRoot, 'sync-timeout-instance', 'chromium', {
      onRequest(request) {
        if (request.method === 'sync.start') {
          return { data: { started: true, provider: 'obsidian', jobId: 'long-job' } };
        }
        if (request.method === 'sync.status') {
          return { data: { provider: 'obsidian', active: true, job: { id: 'long-job', status: 'running' } } };
        }
        return null;
      },
    });
    try {
      const result = await run(['sync', '7', '--to', 'obsidian', '--timeout', '1'], runtimeRoot, homeDir);
      expect(result.exitCode).toBe(5);
      expect(result.json.error.code).toBe('sync_wait_timeout');
      expect(result.json.error.extra.jobId).toBe('long-job');
      expect(instance.requests.some((request) => /cancel|clear/i.test(request.method))).toBe(false);
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
