import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
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

  it('keeps local file paths on the host side and strips them from Extension RPC params', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    const request = vi.fn();
    const requestFileExport = vi.fn(async (_method: string, _params: unknown, options: any) => ({
      protocolVersion: contract.protocolVersion,
      ok: true,
      data: { path: options.outputPath, byteSize: 10 },
      error: null,
    }));
    const requestFileImport = vi.fn(async (_method: string, _params: unknown, options: any) => ({
      protocolVersion: contract.protocolVersion,
      ok: true,
      data: { path: options.inputPath, conversationsAdded: 1 },
      error: null,
    }));
    const controller = await startNativeHostIpc({
      hello: {
        cliInstanceId: 'file-routing-instance',
        browserFamily: 'chromium',
        runtimeId: 'runtime-files',
        extensionVersion: '1.2.3',
      },
      runtimeRoot,
      protocol: { request, requestFileExport, requestFileImport },
    });
    try {
      const outputPath = '/tmp/export.zip';
      await expect(
        requestEndpoint(controller.endpoint, {
          method: 'export.markdown',
          params: { conversationIds: [7, 9], outputPath, force: true },
        }),
      ).resolves.toMatchObject({ ok: true, data: { path: outputPath } });
      expect(requestFileExport).toHaveBeenCalledTimes(1);
      expect(requestFileExport.mock.calls[0]?.[0]).toBe('export.markdown');
      expect(requestFileExport.mock.calls[0]?.[1]).toEqual({ conversationIds: [7, 9] });
      expect(requestFileExport.mock.calls[0]?.[2]).toMatchObject({ outputPath, force: true, timeoutMs: 0 });

      const inputPath = '/tmp/import.zip';
      await expect(
        requestEndpoint(controller.endpoint, { method: 'backup.import', params: { inputPath } }),
      ).resolves.toMatchObject({ ok: true, data: { path: inputPath, conversationsAdded: 1 } });
      expect(requestFileImport).toHaveBeenCalledTimes(1);
      expect(requestFileImport.mock.calls[0]?.[0]).toBe('backup.import');
      expect(requestFileImport.mock.calls[0]?.[1]).toEqual({});
      expect(requestFileImport.mock.calls[0]?.[2]).toMatchObject({ inputPath, timeoutMs: 0 });
      expect(request).not.toHaveBeenCalled();
    } finally {
      await controller.stop();
    }
  });

  it('cancels a no-deadline business RPC when the local CLI client disconnects', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    let capturedSignal: AbortSignal | null = null;
    const controller = await startNativeHostIpc({
      hello: {
        cliInstanceId: 'disconnect-instance',
        browserFamily: 'chromium',
        runtimeId: 'runtime-disconnect',
        extensionVersion: '1.2.3',
      },
      runtimeRoot,
      protocol: {
        request: vi.fn(
          async (_method: string, _params: unknown, options: { timeoutMs?: number; signal?: AbortSignal }) => {
            expect(options.timeoutMs).toBe(0);
            capturedSignal = options.signal ?? null;
            return await new Promise((_, reject) => {
              options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
            });
          },
        ),
      },
    });
    try {
      const socket = createConnection({ path: controller.endpoint });
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      socket.write('{"method":"conversation.search","params":{"query":"slow"}}\n');
      await vi.waitFor(() => expect(capturedSignal).not.toBeNull());
      socket.destroy();
      await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true));
      expect((capturedSignal as AbortSignal).reason).toMatchObject({ code: 'native_host_client_disconnected' });
    } finally {
      await controller.stop();
    }
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

  it('does not replace a malformed registry while the canonical endpoint is still live', async () => {
    const runtimeRoot = await mkdtemp('/tmp/snh-');
    const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot });
    const cliInstanceId = 'malformed-registry-live';
    const endpoint = socketPathForInstance(runtimeDir, cliInstanceId);
    const registryPath = registryPathForInstance(runtimeDir, cliInstanceId);
    const server = createServer((socket) => {
      socket.once('data', () => socket.end('{"ok":false,"error":{"code":"still_live"}}\n'));
    });
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await writeFile(registryPath, '{broken-json\n', 'utf8');
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
      ).rejects.toThrow('cli_instance_already_online');
      expect(await readFile(registryPath, 'utf8')).toBe('{broken-json\n');
      await expect(lstat(endpoint)).resolves.toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await removeFileIfExists(registryPath);
      await removeFileIfExists(endpoint);
    }
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
