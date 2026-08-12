import { describe, expect, it } from 'vitest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_MIGRATION_FACT_RECORD_BYTES,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  MAX_STREAM_FRAME_BYTES,
  LocalDataContractError,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator, composeOrderedFrameDigest, sha256Hex } from '@services/local-data/digest';
import {
  NativeWireSessionReceiver,
  createNativeWireDataFrame,
  createNativeWireRecordJsonFrame,
  decodeNativeWireBase64,
  encodeNativeWireBase64,
  parseNativeWireFrame,
  serializeNativeWireFrame,
} from '@services/local-data/native-wire';
import { FactsManifestAccumulator } from '@services/local-data/facts-manifest';
import { browserDigestProvider } from '@platform/local-data/browser-digest';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';

const SESSION_A = '1b8c5d79-6607-4f8f-9d7b-c8c3dadf0480';
const SESSION_B = '35e4f513-93dc-4a4c-8aae-d8c6ea84105e';
const encoder = new TextEncoder();

function baseFrame(sessionId: string, sequence: number, type: string): Record<string, unknown> {
  return { protocolVersion: LOCAL_DATA_PROTOCOL_VERSION, sessionId, sequence, type };
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

async function expectRejected(callback: () => Promise<unknown>, code: LocalDataContractError['code']): Promise<void> {
  let thrown: unknown;
  try {
    await callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalDataContractError);
  expect((thrown as LocalDataContractError).code).toBe(code);
}

async function finishRecordSession(input: {
  bytes: Uint8Array;
  chunks: Uint8Array[];
  receiver: NativeWireSessionReceiver;
  sessionId?: string;
}): Promise<Uint8Array> {
  const sessionId = input.sessionId ?? SESSION_A;
  const recordDigest = await sha256Hex(nodeDigestProvider, input.bytes);
  const manifestDigest = await OrderedFrameDigestAccumulator.create(nodeDigestProvider);
  let sequence = 0;

  await input.receiver.accept({
    ...baseFrame(sessionId, sequence++, 'begin'),
    operation: 'migration-fact-record',
    declaredTotalBytes: input.bytes.byteLength,
  });
  await input.receiver.accept({
    ...baseFrame(sessionId, sequence++, 'record-begin'),
    kind: 'messages',
    sourceLocalId: 'message:alpha',
    byteLength: input.bytes.byteLength,
    digest: recordDigest,
  });

  let offset = 0;
  for (const chunk of input.chunks) {
    const frame = await createNativeWireRecordJsonFrame({
      bytes: chunk,
      offset,
      provider: nodeDigestProvider,
      sequence,
      sessionId,
    });
    await manifestDigest.append({
      sequence,
      byteLength: chunk.byteLength,
      digest: frame.chunkDigest,
    });
    sequence += 1;
    offset += chunk.byteLength;
    const event = await input.receiver.accept(frame);
    expect(event).toBeNull();
  }

  const recordEvent = await input.receiver.accept({
    ...baseFrame(sessionId, sequence++, 'record-end'),
    digest: recordDigest,
  });
  expect(recordEvent?.kind).toBe('record');
  const record = recordEvent?.kind === 'record' ? recordEvent.record : null;
  expect(record?.kind).toBe('messages');
  expect(record?.sourceLocalId).toBe('message:alpha');
  expect(record?.bytes).toEqual(input.bytes);

  await input.receiver.accept({
    ...baseFrame(sessionId, sequence++, 'end'),
    digest: manifestDigest.finalize(),
  });
  const terminalEvent = await input.receiver.accept({ ...baseFrame(sessionId, sequence, 'terminal'), status: 'ok' });
  expect(terminalEvent).toMatchObject({ kind: 'terminal', terminalFrame: { status: 'ok' } });
  return record!.bytes;
}

describe('native wire', () => {
  it('uses identical ordered SHA-256 composition in browser and Node adapters', async () => {
    const first = encoder.encode('你好😀');
    const second = encoder.encode('{"message":"SyncNos"}');
    const entries = [
      { sequence: 3, byteLength: first.byteLength, digest: await sha256Hex(nodeDigestProvider, first) },
      { sequence: 4, byteLength: second.byteLength, digest: await sha256Hex(nodeDigestProvider, second) },
    ];

    expect(await sha256Hex(browserDigestProvider, first)).toBe(await sha256Hex(nodeDigestProvider, first));
    expect(await composeOrderedFrameDigest(browserDigestProvider, entries)).toBe(
      await composeOrderedFrameDigest(nodeDigestProvider, entries),
    );
  });

  it('builds the compact migration manifest from bounded frame metadata, not archive content', async () => {
    const bytes = encoder.encode('{"message":"你好"}');
    const digest = await sha256Hex(nodeDigestProvider, bytes);
    const manifest = await FactsManifestAccumulator.create({ migrationId: SESSION_A, provider: nodeDigestProvider });
    manifest.addFact('messages');
    await manifest.appendFrame({ kind: 'messages', manifestSequence: 7, byteLength: bytes.byteLength, digest });
    const finalized = manifest.finalize();

    expect(finalized.factCounts.messages).toBe(1);
    expect(finalized.streamBytes.messages).toBe(bytes.byteLength);
    expect(finalized.orderedFrameDigest).toBe(
      await composeOrderedFrameDigest(nodeDigestProvider, [{ sequence: 7, byteLength: bytes.byteLength, digest }]),
    );
    expect(Object.keys(finalized)).not.toContain('content');
    expectErrorCode(() => manifest.addFact('messages'), 'MIGRATION_VALIDATION_FAILED');
  });

  it('streams one CJK/emoji JSON record over continuation frames and closes only after digest-verified terminal', async () => {
    const bytes = encoder.encode('{"title":"你好😀","body":"跨 frame continuation"}');
    const receiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    const split = Math.floor(bytes.byteLength / 2);
    const restored = await finishRecordSession({
      bytes,
      chunks: [bytes.slice(0, split), bytes.slice(split)],
      receiver,
    });

    expect(new TextDecoder().decode(restored)).toContain('你好😀');
    expect(receiver.closed).toBe(true);
    expect(receiver.failed).toBe(false);
  });

  it('uses padded standard Base64 and verifies every raw image slice before exposing it', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(encodeNativeWireBase64(new Uint8Array([1]))).toBe('AQ==');
    expect(decodeNativeWireBase64(encodeNativeWireBase64(bytes))).toEqual(bytes);

    const receiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    const manifestDigest = await OrderedFrameDigestAccumulator.create(nodeDigestProvider);
    await receiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-image-asset',
      declaredTotalBytes: bytes.byteLength,
    });
    const chunks = [bytes.slice(0, 2), bytes.slice(2)];
    const received: Uint8Array[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const frame = await createNativeWireDataFrame({
        bytes: chunk,
        offset: received.reduce((total, current) => total + current.byteLength, 0),
        provider: nodeDigestProvider,
        sequence: index + 1,
        sessionId: SESSION_A,
      });
      await manifestDigest.append({ sequence: index + 1, byteLength: chunk.byteLength, digest: frame.sliceDigest });
      const dataEvent = await receiver.accept(frame);
      expect(dataEvent).toMatchObject({ kind: 'data', bytes: chunk });
      if (dataEvent?.kind === 'data') received.push(dataEvent.bytes);
    }
    expect(new Uint8Array(received.flatMap((chunk) => [...chunk]))).toEqual(bytes);
    await receiver.accept({ ...baseFrame(SESSION_A, 3, 'end'), digest: manifestDigest.finalize() });
    await receiver.accept({ ...baseFrame(SESSION_A, 4, 'terminal'), status: 'ok' });
    expect(receiver.closed).toBe(true);

    const maximumFrame = await createNativeWireDataFrame({
      bytes: new Uint8Array(MAX_NATIVE_IMAGE_SLICE_BYTES),
      offset: 0,
      provider: nodeDigestProvider,
      sequence: 1,
      sessionId: SESSION_A,
    });
    expect(new TextEncoder().encode(serializeNativeWireFrame(maximumFrame)).byteLength).toBeLessThanOrEqual(
      MAX_STREAM_FRAME_BYTES,
    );
  });

  it('fails closed for bad Base64, tampered slice bytes, duplicate/out-of-order frames, and partial records', async () => {
    expectErrorCode(
      () =>
        parseNativeWireFrame({
          ...baseFrame(SESSION_A, 0, 'begin'),
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION + 1,
          operation: 'migration-image-asset',
          declaredTotalBytes: 1,
        }),
      'PROTOCOL_MISMATCH',
    );
    expectErrorCode(
      () =>
        parseNativeWireFrame({
          ...baseFrame(SESSION_A, 0, 'data'),
          encoding: 'base64',
          data: 'abc',
          byteLength: 2,
          offset: 0,
          sliceDigest: 'a'.repeat(64),
        }),
      'INVALID_ARGUMENT',
    );

    const imageReceiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    await imageReceiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-image-asset',
      declaredTotalBytes: 1,
    });
    const valid = await createNativeWireDataFrame({
      bytes: new Uint8Array([7]),
      offset: 0,
      provider: nodeDigestProvider,
      sequence: 1,
      sessionId: SESSION_A,
    });
    await expectRejected(() => imageReceiver.accept({ ...valid, data: 'CA==' }), 'MIGRATION_VALIDATION_FAILED');
    expect(imageReceiver.failed).toBe(true);

    const sequenceReceiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    await sequenceReceiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-image-asset',
      declaredTotalBytes: 1,
    });
    await expectRejected(() => sequenceReceiver.accept({ ...valid, sequence: 2 }), 'INVALID_ARGUMENT');
    expect(sequenceReceiver.closed).toBe(true);

    const partialReceiver = await NativeWireSessionReceiver.create(SESSION_B, nodeDigestProvider);
    const partial = encoder.encode('{"partial":true}');
    const partialDigest = await sha256Hex(nodeDigestProvider, partial);
    await partialReceiver.accept({
      ...baseFrame(SESSION_B, 0, 'begin'),
      operation: 'migration-fact-record',
      declaredTotalBytes: partial.byteLength,
    });
    await partialReceiver.accept({
      ...baseFrame(SESSION_B, 1, 'record-begin'),
      kind: 'messages',
      sourceLocalId: 'message:partial',
      byteLength: partial.byteLength,
      digest: partialDigest,
    });
    await expectRejected(
      () => partialReceiver.accept({ ...baseFrame(SESSION_B, 2, 'terminal'), status: 'ok' }),
      'MIGRATION_VALIDATION_FAILED',
    );
    expect(partialReceiver.failed).toBe(true);
  });

  it('rejects wrong session, declared totals, record digests, and raw/image limits without retaining state', async () => {
    const receiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    await expectRejected(
      () =>
        receiver.accept({
          ...baseFrame(SESSION_B, 0, 'begin'),
          operation: 'migration-image-asset',
          declaredTotalBytes: 1,
        }),
      'INVALID_ARGUMENT',
    );
    expect(receiver.failed).toBe(true);

    expectErrorCode(
      () =>
        parseNativeWireFrame({
          ...baseFrame(SESSION_A, 0, 'record-begin'),
          kind: 'messages',
          sourceLocalId: 'message:large',
          byteLength: MAX_MIGRATION_FACT_RECORD_BYTES + 1,
          digest: 'a'.repeat(64),
        }),
      'PAYLOAD_TOO_LARGE',
    );
    expectErrorCode(
      () => encodeNativeWireBase64(new Uint8Array(MAX_NATIVE_IMAGE_SLICE_BYTES + 1)),
      'PAYLOAD_TOO_LARGE',
    );

    const bytes = encoder.encode('{"ok":true}');
    const badDigestReceiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    const badDigest = '0'.repeat(64);
    await badDigestReceiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-fact-record',
      declaredTotalBytes: bytes.byteLength,
    });
    await badDigestReceiver.accept({
      ...baseFrame(SESSION_A, 1, 'record-begin'),
      kind: 'messages',
      sourceLocalId: 'message:bad-digest',
      byteLength: bytes.byteLength,
      digest: badDigest,
    });
    const chunk = await createNativeWireRecordJsonFrame({
      bytes,
      offset: 0,
      provider: nodeDigestProvider,
      sequence: 2,
      sessionId: SESSION_A,
    });
    await badDigestReceiver.accept(chunk);
    await expectRejected(
      () => badDigestReceiver.accept({ ...baseFrame(SESSION_A, 3, 'record-end'), digest: badDigest }),
      'MIGRATION_VALIDATION_FAILED',
    );
    expect(badDigestReceiver.failed).toBe(true);
  });

  it('rejects illegal ack ordering and terminal success before a completed end frame', async () => {
    expectErrorCode(
      () => parseNativeWireFrame({ ...baseFrame(SESSION_A, 1, 'ack'), acknowledgedSequence: 1 }),
      'INVALID_ARGUMENT',
    );
    const receiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    await receiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-image-asset',
      declaredTotalBytes: 0,
    });
    await expectRejected(
      () => receiver.accept({ ...baseFrame(SESSION_A, 1, 'terminal'), status: 'ok' }),
      'MIGRATION_VALIDATION_FAILED',
    );
    expect(receiver.failed).toBe(true);
  });

  it('allows an acknowledged cancellation to terminate without retaining a partial operation', async () => {
    const receiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    await receiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-image-asset',
      declaredTotalBytes: 3,
    });
    expect(await receiver.accept({ ...baseFrame(SESSION_A, 1, 'ack'), acknowledgedSequence: 0 })).toBeNull();
    expect(await receiver.accept({ ...baseFrame(SESSION_A, 2, 'cancel'), reason: 'cancelled' })).toBeNull();
    expect(await receiver.accept({ ...baseFrame(SESSION_A, 3, 'terminal'), status: 'cancelled' })).toMatchObject({
      kind: 'terminal',
      terminalFrame: { status: 'cancelled' },
    });
    expect(receiver.closed).toBe(true);
    expect(receiver.failed).toBe(false);
  });

  it('accepts a peer terminal error as a closed, non-reusable operation', async () => {
    const receiver = await NativeWireSessionReceiver.create(SESSION_A, nodeDigestProvider);
    await receiver.accept({
      ...baseFrame(SESSION_A, 0, 'begin'),
      operation: 'migration-image-asset',
      declaredTotalBytes: 3,
    });
    expect(await receiver.accept({ ...baseFrame(SESSION_A, 1, 'terminal'), status: 'error' })).toMatchObject({
      kind: 'terminal',
      terminalFrame: { status: 'error' },
    });
    expect(receiver.closed).toBe(true);
    expect(receiver.failed).toBe(false);
    await expectRejected(
      () => receiver.accept({ ...baseFrame(SESSION_A, 2, 'terminal'), status: 'error' }),
      'INVALID_ARGUMENT',
    );
  });

  it('serializes only a validated bounded JSON frame', async () => {
    const frame = await createNativeWireDataFrame({
      bytes: new Uint8Array([1, 2, 3]),
      offset: 0,
      provider: nodeDigestProvider,
      sequence: 1,
      sessionId: SESSION_A,
    });
    expect(JSON.parse(serializeNativeWireFrame(frame))).toEqual(frame);
  });
});
