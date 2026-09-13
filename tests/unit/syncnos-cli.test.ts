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
  stop: () => Promise<void>;
};

async function startFakeInstance(
  runtimeRoot: string,
  id: string,
  browserFamily: 'chromium' | 'firefox',
  options: { revisionErrorCode?: string } = {},
): Promise<FakeInstance> {
  const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
  const endpoint = socketPathForInstance(runtimeDir, id);
  const registryPath = registryPathForInstance(runtimeDir, id);
  const server = createServer((socket) => {
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (!input.includes('\n')) return;
      const request = JSON.parse(input.trim());
      const method = String(request.method || '');
      const data =
        method === 'system.ping'
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
        method === 'revision.get' && options.revisionErrorCode ? options.revisionErrorCode : 'rpc_method_not_found';
      socket.end(
        `${JSON.stringify({
          kind: contract.frames.rpcResponse,
          protocolVersion: contract.protocolVersion,
          requestId: 'fake',
          ok: data !== null,
          data,
          error: data !== null ? null : { code: errorCode, message: 'failed' },
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

  it('selection helper encodes the public priority without recent-start heuristics', () => {
    const a = { entry: { cliInstanceId: 'a' } } as any;
    const b = { entry: { cliInstanceId: 'b' } } as any;
    expect(selectInstance([a, b], { explicitId: 'b', preferredId: 'a' })).toBe(b);
    expect(selectInstance([a, b], { preferredId: 'a' })).toBe(a);
    expect(selectInstance([b], { preferredId: 'offline' })).toBe(b);
    expect(() => selectInstance([a, b])).toThrowError(expect.objectContaining({ code: 'instance_ambiguous' }));
  });
});
