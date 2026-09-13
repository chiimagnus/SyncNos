import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createExtensionFileTransferController } from '@services/cli/file-transfer';
import { IncrementalSha256 } from '@services/cli/sha256';

const frames = {
  fileBegin: 'file-begin',
  fileChunk: 'file-chunk',
  fileAck: 'file-ack',
  fileEnd: 'file-end',
  fileAbort: 'file-abort',
};

function hashHex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64');
}

describe('incremental SHA-256', () => {
  it('matches standard SHA-256 across incremental chunk boundaries', () => {
    const input = new TextEncoder().encode('abc'.repeat(1000));
    const hasher = new IncrementalSha256();
    hasher.update(input.subarray(0, 1));
    hasher.update(input.subarray(1, 65));
    hasher.update(input.subarray(65, 1001));
    hasher.update(input.subarray(1001));
    expect(hasher.digestHex()).toBe(hashHex(input));
  });
});

describe('extension file transfer controller', () => {
  it('streams a Blob in bounded chunks, hashes while streaming, and waits for matching ACKs', async () => {
    const posted: any[] = [];
    let controller: ReturnType<typeof createExtensionFileTransferController>;
    controller = createExtensionFileTransferController({
      frames,
      protocolVersion: 1,
      chunkBytes: 2,
      ackTimeoutMs: 1000,
      postFrame(frame) {
        posted.push(frame);
        const value = frame as any;
        if (value.kind === frames.fileBegin || value.kind === frames.fileChunk || value.kind === frames.fileEnd) {
          const seq = value.kind === frames.fileBegin ? -1 : value.seq;
          queueMicrotask(() => {
            void controller.handleFrame({
              kind: frames.fileAck,
              protocolVersion: 1,
              requestId: value.requestId,
              transferId: value.transferId,
              seq,
            });
          });
        }
      },
    });

    const bytes = new TextEncoder().encode('abcde');
    const result = await controller.sendBlob('request-1', {
      blob: new Blob([bytes]),
      suggestedFilename: 'out.zip',
      metadata: { format: 'backup' },
    });

    expect(result).toMatchObject({ byteSize: 5, sha256: hashHex(bytes), suggestedFilename: 'out.zip' });
    expect(posted.map((frame) => frame.kind)).toEqual([
      'file-begin',
      'file-chunk',
      'file-chunk',
      'file-chunk',
      'file-end',
    ]);
    expect(posted.filter((frame) => frame.kind === frames.fileChunk).map((frame) => frame.seq)).toEqual([0, 1, 2]);
    expect(
      posted
        .filter((frame) => frame.kind === frames.fileChunk)
        .map((frame) => Buffer.from(frame.data, 'base64').length),
    ).toEqual([2, 2, 1]);
  });

  it('receives host chunks in exact sequence, validates byte count/hash, and resolves one Blob', async () => {
    const posted: any[] = [];
    const controller = createExtensionFileTransferController({
      frames,
      protocolVersion: 1,
      chunkBytes: 3,
      ackTimeoutMs: 1000,
      postFrame: (frame) => posted.push(frame),
    });
    const pending = controller.receiveBlob('request-2');
    const bytes = new TextEncoder().encode('abcdef');

    await controller.handleFrame({
      kind: frames.fileBegin,
      protocolVersion: 1,
      requestId: 'request-2',
      transferId: 'transfer-2',
      direction: 'host-to-extension',
      totalBytes: bytes.length,
      suggestedFilename: 'backup.zip',
      metadata: {},
    });
    await controller.handleFrame({
      kind: frames.fileChunk,
      protocolVersion: 1,
      requestId: 'request-2',
      transferId: 'transfer-2',
      seq: 0,
      data: b64(bytes.subarray(0, 3)),
    });
    await controller.handleFrame({
      kind: frames.fileChunk,
      protocolVersion: 1,
      requestId: 'request-2',
      transferId: 'transfer-2',
      seq: 1,
      data: b64(bytes.subarray(3)),
    });
    await controller.handleFrame({
      kind: frames.fileEnd,
      protocolVersion: 1,
      requestId: 'request-2',
      transferId: 'transfer-2',
      seq: 2,
      totalBytes: bytes.length,
      sha256: hashHex(bytes),
    });

    const received = await pending;
    expect(new Uint8Array(await received.blob.arrayBuffer())).toEqual(bytes);
    expect(received).toMatchObject({ transferId: 'transfer-2', totalBytes: 6, sha256: hashHex(bytes) });
    expect(posted.map((frame) => frame.seq)).toEqual([-1, 0, 1, 2]);
    expect(posted.every((frame) => frame.kind === frames.fileAck)).toBe(true);
  });

  it('aborts and rejects on sequence or hash mismatch instead of accepting partial data', async () => {
    const posted: any[] = [];
    const controller = createExtensionFileTransferController({
      frames,
      protocolVersion: 1,
      chunkBytes: 4,
      ackTimeoutMs: 1000,
      postFrame: (frame) => posted.push(frame),
    });
    const pending = controller.receiveBlob('request-3');
    await controller.handleFrame({
      kind: frames.fileBegin,
      protocolVersion: 1,
      requestId: 'request-3',
      transferId: 'transfer-3',
      direction: 'host-to-extension',
      totalBytes: 2,
    });
    await controller.handleFrame({
      kind: frames.fileChunk,
      protocolVersion: 1,
      requestId: 'request-3',
      transferId: 'transfer-3',
      seq: 1,
      data: b64(Uint8Array.of(1, 2)),
    });
    await expect(pending).rejects.toMatchObject({ code: 'file_transfer_sequence' });
    expect(posted.at(-1)).toMatchObject({ kind: frames.fileAbort, code: 'file_transfer_sequence' });

    const second = controller.receiveBlob('request-4');
    await controller.handleFrame({
      kind: frames.fileBegin,
      protocolVersion: 1,
      requestId: 'request-4',
      transferId: 'transfer-4',
      direction: 'host-to-extension',
      totalBytes: 2,
    });
    await controller.handleFrame({
      kind: frames.fileChunk,
      protocolVersion: 1,
      requestId: 'request-4',
      transferId: 'transfer-4',
      seq: 0,
      data: b64(Uint8Array.of(1, 2)),
    });
    await controller.handleFrame({
      kind: frames.fileEnd,
      protocolVersion: 1,
      requestId: 'request-4',
      transferId: 'transfer-4',
      seq: 1,
      totalBytes: 2,
      sha256: '0'.repeat(64),
    });
    await expect(second).rejects.toMatchObject({ code: 'file_transfer_hash_mismatch' });
    expect(posted.at(-1)).toMatchObject({ kind: frames.fileAbort, code: 'file_transfer_hash_mismatch' });
  });

  it('times out an inbound transfer that begins and then stalls', async () => {
    const posted: any[] = [];
    const controller = createExtensionFileTransferController({
      frames,
      protocolVersion: 1,
      chunkBytes: 2,
      ackTimeoutMs: 20,
      postFrame: (frame) => posted.push(frame),
    });
    const pending = controller.receiveBlob('request-stalled');
    await controller.handleFrame({
      kind: frames.fileBegin,
      protocolVersion: 1,
      requestId: 'request-stalled',
      transferId: 'transfer-stalled',
      direction: 'host-to-extension',
      totalBytes: 2,
    });
    await expect(pending).rejects.toMatchObject({ code: 'file_transfer_timeout' });
    expect(posted.at(-1)).toMatchObject({ kind: frames.fileAbort, code: 'file_transfer_timeout' });
  });

  it('rejects file ACKs from a mismatched protocol instead of advancing the sender', async () => {
    const posted: any[] = [];
    let controller: ReturnType<typeof createExtensionFileTransferController>;
    controller = createExtensionFileTransferController({
      frames,
      protocolVersion: 1,
      chunkBytes: 2,
      ackTimeoutMs: 1000,
      postFrame(frame) {
        posted.push(frame);
        const value = frame as any;
        if (value.kind === frames.fileBegin) {
          queueMicrotask(() => {
            void controller.handleFrame({
              kind: frames.fileAck,
              protocolVersion: 99,
              requestId: value.requestId,
              transferId: value.transferId,
              seq: -1,
            });
          });
        }
      },
    });
    await expect(
      controller.sendBlob('request-mismatch', { blob: new Blob(['a']), suggestedFilename: 'a.zip' }),
    ).rejects.toMatchObject({ code: 'protocol_mismatch' });
    expect(posted.some((frame) => frame.kind === frames.fileChunk)).toBe(false);
  });

  it('cleans pending transfers on transport close and times out unanswered ACKs', async () => {
    const controller = createExtensionFileTransferController({
      frames,
      protocolVersion: 1,
      chunkBytes: 2,
      ackTimeoutMs: 20,
      postFrame: vi.fn(),
    });
    await expect(
      controller.sendBlob('request-timeout', { blob: new Blob(['a']), suggestedFilename: 'a.zip' }),
    ).rejects.toMatchObject({ code: 'file_transfer_timeout' });

    const receive = controller.receiveBlob('request-close');
    controller.abortAll();
    await expect(receive).rejects.toMatchObject({ code: 'file_transfer_closed' });
  });
});
