import { lstat, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { endianness } from 'node:os';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { requestEndpoint } from '../../cli/ipc.mjs';
import {
  NativeMessageParser,
  contract,
  encodeNativeMessage,
  runNativeHost,
  startNativeHostIpc,
} from '../../cli/native-host.mjs';
import {
  ensureRuntimeDir,
  readRegistryEntry,
  registryPathForInstance,
  removeFileIfExists,
  socketPathForInstance,
  writeRegistryEntry,
} from '../../cli/runtime-registry.mjs';

function lengthHeader(length: number) {
  const buffer = Buffer.alloc(4);
  if (endianness() === 'LE') buffer.writeUInt32LE(length, 0);
  else buffer.writeUInt32BE(length, 0);
  return buffer;
}

async function waitForMissing(path: string) {
  await vi.waitFor(async () => {
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
}

describe('native host local IPC lifecycle', () => {
  it('rejects an extension-to-host frame above the real 64 MiB boundary from its header alone', () => {
    const parser = new NativeMessageParser(contract.nativeMessaging.extensionToHostMaxBytes);
    expect(() => parser.push(lengthHeader(contract.nativeMessaging.extensionToHostMaxBytes + 1))).toThrow(
      'native_message_too_large',
    );
  });

  it('generates independent bridge request ids for concurrent clients', async () => {
    const written: any[] = [];
    const { createNativeHostProtocol } = await import('../../cli/native-host.mjs');
    const protocol = createNativeHostProtocol({ write: async (frame: unknown) => written.push(frame) });
    await protocol.handleMessage({ kind: contract.frames.hello, protocolVersion: contract.protocolVersion });
    const p1 = protocol.request('system.ping');
    const p2 = protocol.request('revision.get');
    await vi.waitFor(() => expect(written.length).toBe(3));
    const requests = written.slice(1);
    expect(new Set(requests.map((item) => item.requestId)).size).toBe(2);
    for (const request of requests) {
      await protocol.handleMessage({
        kind: contract.frames.rpcResponse,
        protocolVersion: contract.protocolVersion,
        requestId: request.requestId,
        ok: true,
        data: { method: request.method },
        error: null,
      });
    }
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      expect.objectContaining({ data: { method: 'system.ping' } }),
      expect.objectContaining({ data: { method: 'revision.get' } }),
    ]);
  });

  it('binds only after hello, round-trips RPC through Native Messaging, and removes registry/socket on EOF', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const extensionParser = new NativeMessageParser(contract.nativeMessaging.hostToExtensionMaxBytes);
    const seenRequests: any[] = [];

    output.on('data', (chunk) => {
      for (const frame of extensionParser.push(chunk)) {
        if (frame.kind !== contract.frames.rpcRequest) continue;
        seenRequests.push(frame);
        const data =
          frame.method === 'system.ping'
            ? { alive: true, cliInstanceId: 'instance-e2e', protocolVersion: contract.protocolVersion }
            : { conversations: 9 };
        input.write(
          encodeNativeMessage({
            kind: contract.frames.rpcResponse,
            protocolVersion: contract.protocolVersion,
            requestId: frame.requestId,
            ok: true,
            data,
            error: null,
          }),
        );
      }
    });

    runNativeHost({ input, output, error, runtimeRoot });
    const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
    const registryPath = registryPathForInstance(runtimeDir, 'instance-e2e');
    const endpoint = socketPathForInstance(runtimeDir, 'instance-e2e');
    await expect(lstat(registryPath)).rejects.toMatchObject({ code: 'ENOENT' });

    input.write(
      encodeNativeMessage({
        kind: contract.frames.hello,
        protocolVersion: contract.protocolVersion,
        cliInstanceId: 'instance-e2e',
        browserFamily: 'chromium',
        runtimeId: 'runtime-e2e',
        extensionVersion: '1.2.3',
      }),
    );
    await vi.waitFor(async () => expect((await lstat(endpoint)).mode & 0o777).toBe(0o600));
    await vi.waitFor(async () => expect((await lstat(registryPath)).mode & 0o777).toBe(0o600));

    await expect(requestEndpoint(endpoint, { method: 'system.ping', params: {} })).resolves.toMatchObject({
      ok: true,
      data: { cliInstanceId: 'instance-e2e' },
    });
    await expect(requestEndpoint(endpoint, { method: 'revision.get', params: {} })).resolves.toMatchObject({
      ok: true,
      data: { conversations: 9 },
    });
    expect(seenRequests).toHaveLength(2);
    expect(new Set(seenRequests.map((item) => item.requestId)).size).toBe(2);

    input.end();
    await waitForMissing(registryPath);
    await waitForMissing(endpoint);
    expect(error.read()?.toString() || '').toBe('');
  });

  it('does not unlink an endpoint after registry ownership changes to another process nonce', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    const controller = await startNativeHostIpc({
      hello: {
        cliInstanceId: 'ownership-instance',
        browserFamily: 'chromium',
        runtimeId: 'runtime-one',
        extensionVersion: '1.2.3',
      },
      runtimeRoot,
      processNonce: 'old-owner',
      protocol: {
        request: vi.fn(async () => ({ protocolVersion: contract.protocolVersion, ok: true, data: {}, error: null })),
      },
    });
    const replacement = {
      ...(await readRegistryEntry(controller.registryPath)),
      processNonce: 'new-owner',
    };
    await writeRegistryEntry(controller.registryPath, replacement);

    await controller.stop();
    await expect(readRegistryEntry(controller.registryPath)).resolves.toMatchObject({ processNonce: 'new-owner' });
    await removeFileIfExists(controller.registryPath);
    await removeFileIfExists(controller.endpoint);
  });

  it('does not replace a registry when an endpoint is reachable but returns malformed data', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
    const cliInstanceId = 'malformed-live-instance';
    const endpoint = socketPathForInstance(runtimeDir, cliInstanceId);
    const registryPath = registryPathForInstance(runtimeDir, cliInstanceId);
    const server = createServer((socket) => {
      socket.once('data', () => socket.end('{not-json}\n'));
    });
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await writeRegistryEntry(registryPath, {
      cliInstanceId,
      endpoint,
      pid: process.pid,
      processNonce: 'live-malformed-owner',
      browserFamily: 'chromium',
      runtimeId: 'runtime-live',
      extensionVersion: '1.2.3',
      protocolVersion: contract.protocolVersion,
      startedAt: Date.now(),
    });
    try {
      await expect(
        startNativeHostIpc({
          hello: {
            cliInstanceId,
            browserFamily: 'chromium',
            runtimeId: 'runtime-new',
            extensionVersion: '1.2.3',
          },
          runtimeRoot,
          protocol: { request: vi.fn() },
        }),
      ).rejects.toMatchObject({ code: 'ipc_invalid_json' });
      await expect(readRegistryEntry(registryPath)).resolves.toMatchObject({ processNonce: 'live-malformed-owner' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await removeFileIfExists(registryPath);
      await removeFileIfExists(endpoint);
    }
  });

  it('never steals a live registry entry even when the live endpoint returns an RPC error', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    const hello = {
      cliInstanceId: 'same-instance',
      browserFamily: 'chromium',
      runtimeId: 'runtime-one',
      extensionVersion: '1.2.3',
    };
    const first = await startNativeHostIpc({
      hello,
      runtimeRoot,
      protocol: {
        request: vi.fn(async () => ({
          protocolVersion: contract.protocolVersion,
          ok: false,
          data: null,
          error: { code: 'extension_ping_failed', message: 'still a live endpoint' },
        })),
      },
    });
    try {
      await expect(
        startNativeHostIpc({
          hello: { ...hello, runtimeId: 'runtime-two' },
          runtimeRoot,
          existingPingTimeoutMs: 100,
          protocol: { request: vi.fn() },
        }),
      ).rejects.toThrow('cli_instance_already_online');
    } finally {
      await first.stop();
    }
  });
});
