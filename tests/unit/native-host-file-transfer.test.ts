import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { contract, createNativeHostProtocol } from '../../cli/native-host.mjs';

function sha256(bytes: Uint8Array | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readyProtocol(write: (frame: any) => Promise<void> | void) {
  const protocol = createNativeHostProtocol({ write });
  await protocol.handleMessage({ kind: contract.frames.hello, protocolVersion: contract.protocolVersion });
  return protocol;
}

function rpcRequest(frames: any[]) {
  return frames.find((frame) => frame.kind === contract.frames.rpcRequest);
}

describe('native host file transfer', () => {
  it('receives extension export frames into a 0600 temp file and atomically publishes verified bytes', async () => {
    const dir = await mkdtemp('/tmp/snh-file-');
    const outputPath = join(dir, 'export.zip');
    const written: any[] = [];
    const protocol = await readyProtocol(async (frame) => {
      written.push(frame);
    });
    const bytes = Buffer.from('abcdef');
    const pending = protocol.requestFileExport('backup.export', {}, { outputPath, force: false, timeoutMs: 0 });
    await vi.waitFor(() => expect(rpcRequest(written)).toBeTruthy());
    const request = rpcRequest(written);
    const transferId = 'transfer-export';

    await protocol.handleMessage({
      kind: contract.frames.fileBegin,
      protocolVersion: contract.protocolVersion,
      requestId: request.requestId,
      transferId,
      direction: 'extension-to-host',
      totalBytes: bytes.length,
      suggestedFilename: 'backup.zip',
    });
    await protocol.handleMessage({
      kind: contract.frames.fileChunk,
      protocolVersion: contract.protocolVersion,
      requestId: request.requestId,
      transferId,
      seq: 0,
      data: bytes.subarray(0, 3).toString('base64'),
    });
    await protocol.handleMessage({
      kind: contract.frames.fileChunk,
      protocolVersion: contract.protocolVersion,
      requestId: request.requestId,
      transferId,
      seq: 1,
      data: bytes.subarray(3).toString('base64'),
    });
    await protocol.handleMessage({
      kind: contract.frames.fileEnd,
      protocolVersion: contract.protocolVersion,
      requestId: request.requestId,
      transferId,
      seq: 2,
      totalBytes: bytes.length,
      sha256: sha256(bytes),
    });
    await protocol.handleMessage({
      kind: contract.frames.rpcResponse,
      protocolVersion: contract.protocolVersion,
      requestId: request.requestId,
      ok: true,
      data: { format: 'backup', suggestedFilename: 'backup.zip' },
      error: null,
    });

    await expect(pending).resolves.toMatchObject({
      ok: true,
      data: { format: 'backup', path: outputPath, byteSize: bytes.length, sha256: sha256(bytes) },
    });
    expect(await readFile(outputPath)).toEqual(bytes);
    expect((await lstat(outputPath)).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).filter((name) => name.includes('.syncnos-'))).toEqual([]);
    expect(written.filter((frame) => frame.kind === contract.frames.fileAck).map((frame) => frame.seq)).toEqual([
      -1, 0, 1, 2,
    ]);
  });

  it('refuses an existing output before asking the extension to generate anything, and force safely replaces a regular file', async () => {
    const dir = await mkdtemp('/tmp/snh-file-');
    const outputPath = join(dir, 'existing.zip');
    await writeFile(outputPath, 'old');
    const written: any[] = [];
    const protocol = await readyProtocol(async (frame) => {
      written.push(frame);
    });

    await expect(protocol.requestFileExport('backup.export', {}, { outputPath, force: false })).rejects.toMatchObject({
      code: 'output_exists',
    });
    expect(written.some((frame) => frame.kind === contract.frames.rpcRequest)).toBe(false);
    expect(await readFile(outputPath, 'utf8')).toBe('old');

    const bytes = Buffer.from('new');
    const forced = protocol.requestFileExport('backup.export', {}, { outputPath, force: true, timeoutMs: 0 });
    await vi.waitFor(() => expect(rpcRequest(written)).toBeTruthy());
    const request = rpcRequest(written);
    await protocol.handleMessage({
      kind: contract.frames.fileBegin,
      protocolVersion: 1,
      requestId: request.requestId,
      transferId: 'force-transfer',
      direction: 'extension-to-host',
      totalBytes: bytes.length,
    });
    await protocol.handleMessage({
      kind: contract.frames.fileChunk,
      protocolVersion: 1,
      requestId: request.requestId,
      transferId: 'force-transfer',
      seq: 0,
      data: bytes.toString('base64'),
    });
    await protocol.handleMessage({
      kind: contract.frames.fileEnd,
      protocolVersion: 1,
      requestId: request.requestId,
      transferId: 'force-transfer',
      seq: 1,
      totalBytes: bytes.length,
      sha256: sha256(bytes),
    });
    await protocol.handleMessage({
      kind: contract.frames.rpcResponse,
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      data: {},
      error: null,
    });
    await forced;
    expect(await readFile(outputPath, 'utf8')).toBe('new');
  });

  it('aborts bad sequence/hash exports and removes every temp file without publishing partial output', async () => {
    const dir = await mkdtemp('/tmp/snh-file-');
    const outputPath = join(dir, 'bad.zip');
    const written: any[] = [];
    const protocol = await readyProtocol(async (frame) => written.push(frame));
    const pending = protocol.requestFileExport('backup.export', {}, { outputPath, timeoutMs: 0 });
    await vi.waitFor(() => expect(rpcRequest(written)).toBeTruthy());
    const request = rpcRequest(written);
    await protocol.handleMessage({
      kind: contract.frames.fileBegin,
      protocolVersion: 1,
      requestId: request.requestId,
      transferId: 'bad-transfer',
      direction: 'extension-to-host',
      totalBytes: 1,
    });
    await protocol.handleMessage({
      kind: contract.frames.fileChunk,
      protocolVersion: 1,
      requestId: request.requestId,
      transferId: 'bad-transfer',
      seq: 1,
      data: Buffer.from('x').toString('base64'),
    });

    await expect(pending).rejects.toMatchObject({ code: 'file_transfer_sequence' });
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.waitFor(async () => expect((await readdir(dir)).filter((name) => name.includes('.syncnos-'))).toEqual([]));
    expect(written.at(-1)).toMatchObject({ kind: contract.frames.fileAbort, code: 'file_transfer_sequence' });
  });

  it('cancels an in-flight export on local client abort and removes the temp file', async () => {
    const dir = await mkdtemp('/tmp/snh-file-');
    const outputPath = join(dir, 'cancelled.zip');
    const written: any[] = [];
    const protocol = await readyProtocol(async (frame) => written.push(frame));
    const controller = new AbortController();
    const pending = protocol.requestFileExport(
      'backup.export',
      {},
      {
        outputPath,
        timeoutMs: 0,
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(rpcRequest(written)).toBeTruthy());
    const error = Object.assign(new Error('local client disconnected'), { code: 'native_host_client_disconnected' });
    controller.abort(error);
    await expect(pending).rejects.toMatchObject({ code: 'native_host_client_disconnected' });
    await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await vi.waitFor(async () => expect((await readdir(dir)).filter((name) => name.includes('.syncnos-'))).toEqual([]));
    protocol.close();
  });

  it('times out a stalled extension export after file-begin and removes the temp file', async () => {
    const originalTimeout = contract.fileTransfer.ackTimeoutMs;
    contract.fileTransfer.ackTimeoutMs = 20;
    const dir = await mkdtemp('/tmp/snh-file-');
    const outputPath = join(dir, 'stalled.zip');
    const written: any[] = [];
    const protocol = await readyProtocol(async (frame) => written.push(frame));
    try {
      const pending = protocol.requestFileExport('backup.export', {}, { outputPath, timeoutMs: 0 });
      await vi.waitFor(() => expect(rpcRequest(written)).toBeTruthy());
      const request = rpcRequest(written);
      await protocol.handleMessage({
        kind: contract.frames.fileBegin,
        protocolVersion: 1,
        requestId: request.requestId,
        transferId: 'stalled-transfer',
        direction: 'extension-to-host',
        totalBytes: 10,
      });
      await expect(pending).rejects.toMatchObject({ code: 'file_transfer_timeout' });
      await expect(lstat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await vi.waitFor(async () =>
        expect((await readdir(dir)).filter((name) => name.includes('.syncnos-'))).toEqual([]),
      );
    } finally {
      contract.fileTransfer.ackTimeoutMs = originalTimeout;
      protocol.close();
    }
  });

  it('streams one input file to the extension with per-chunk ACKs and returns only metadata/stats', async () => {
    const dir = await mkdtemp('/tmp/snh-file-');
    const inputPath = join(dir, 'input.zip');
    const bytes = Buffer.alloc(contract.fileTransfer.chunkBytes + 7, 0x5a);
    await writeFile(inputPath, bytes);
    const written: any[] = [];
    let protocol: ReturnType<typeof createNativeHostProtocol>;
    protocol = await readyProtocol(async (frame) => {
      written.push(frame);
      if (
        frame.kind === contract.frames.fileBegin ||
        frame.kind === contract.frames.fileChunk ||
        frame.kind === contract.frames.fileEnd
      ) {
        const seq = frame.kind === contract.frames.fileBegin ? -1 : frame.seq;
        queueMicrotask(() => {
          void protocol.handleMessage({
            kind: contract.frames.fileAck,
            protocolVersion: contract.protocolVersion,
            requestId: frame.requestId,
            transferId: frame.transferId,
            seq,
          });
          if (frame.kind === contract.frames.fileEnd) {
            void protocol.handleMessage({
              kind: contract.frames.rpcResponse,
              protocolVersion: contract.protocolVersion,
              requestId: frame.requestId,
              ok: true,
              data: { conversationsAdded: 2 },
              error: null,
            });
          }
        });
      }
    });

    const result = await protocol.requestFileImport('backup.import', {}, { inputPath, timeoutMs: 0 });
    expect(result).toMatchObject({
      ok: true,
      data: { conversationsAdded: 2, path: inputPath, byteSize: bytes.length, sha256: sha256(bytes) },
    });
    const chunks = written.filter((frame) => frame.kind === contract.frames.fileChunk);
    expect(chunks).toHaveLength(2);
    expect(Buffer.concat(chunks.map((frame) => Buffer.from(frame.data, 'base64')))).toEqual(bytes);
    expect(written.find((frame) => frame.kind === contract.frames.fileBegin)).toMatchObject({
      direction: 'host-to-extension',
      totalBytes: bytes.length,
      suggestedFilename: 'input.zip',
    });
  });

  it('rejects non-absolute input paths and directories before sending backup.import', async () => {
    const dir = await mkdtemp('/tmp/snh-file-');
    const written: any[] = [];
    const protocol = await readyProtocol(async (frame) => written.push(frame));
    await expect(protocol.requestFileImport('backup.import', {}, { inputPath: 'relative.zip' })).rejects.toMatchObject({
      code: 'path_not_absolute',
    });
    await expect(protocol.requestFileImport('backup.import', {}, { inputPath: dir })).rejects.toMatchObject({
      code: 'input_not_regular',
    });
    expect(written.some((frame) => frame.kind === contract.frames.rpcRequest)).toBe(false);
  });
});
