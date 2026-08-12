import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_MIGRATION_FACT_RECORD_BYTES,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  MAX_STREAM_FRAME_BYTES,
  LocalDataContractError,
  parseMigrationId,
  parseOrderedFrameDigest,
  parseStreamDescriptor,
  serializedJsonUtf8ByteLength,
  type JsonValue,
  type MigrationId,
  type StreamDescriptor,
} from './contracts';
import { OrderedFrameDigestAccumulator, sha256Hex, type DigestProvider } from './digest';
import { FACT_STREAM_KINDS, type FactStreamKind } from './facts-manifest';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_STRING_CHUNK_BYTES = 0x8000;

export const NATIVE_WIRE_FRAME_TYPES = Object.freeze([
  'begin',
  'data',
  'end',
  'cancel',
  'ack',
  'terminal',
  'record-begin',
  'record-json',
  'record-end',
] as const);

export const NATIVE_WIRE_FACT_KINDS = FACT_STREAM_KINDS;

export type NativeWireFrameType = (typeof NATIVE_WIRE_FRAME_TYPES)[number];
export type NativeWireTerminalStatus = 'ok' | 'error' | 'cancelled';

type BaseFrame<TType extends NativeWireFrameType> = Readonly<{
  protocolVersion: number;
  sequence: number;
  sessionId: MigrationId;
  type: TType;
}>;

export type NativeWireBeginFrame = BaseFrame<'begin'> & StreamDescriptor;

export type NativeWireDataFrame = BaseFrame<'data'> &
  Readonly<{
    byteLength: number;
    data: string;
    encoding: 'base64';
    offset: number;
    sliceDigest: string;
  }>;

export type NativeWireEndFrame = BaseFrame<'end'> &
  Readonly<{
    digest: string;
  }>;

export type NativeWireCancelFrame = BaseFrame<'cancel'> &
  Readonly<{
    reason: 'cancelled' | 'digest-mismatch' | 'invalid-frame' | 'payload-too-large';
  }>;

export type NativeWireAckFrame = BaseFrame<'ack'> &
  Readonly<{
    acknowledgedSequence: number;
  }>;

export type NativeWireTerminalFrame = BaseFrame<'terminal'> &
  Readonly<{
    status: NativeWireTerminalStatus;
  }>;

export type NativeWireRecordBeginFrame = BaseFrame<'record-begin'> &
  Readonly<{
    byteLength: number;
    digest: string;
    kind: FactStreamKind;
    sourceLocalId: string;
  }>;

export type NativeWireRecordJsonFrame = BaseFrame<'record-json'> &
  Readonly<{
    byteLength: number;
    chunkDigest: string;
    data: string;
    encoding: 'base64';
    offset: number;
  }>;

export type NativeWireRecordEndFrame = BaseFrame<'record-end'> &
  Readonly<{
    digest: string;
  }>;

export type NativeWireFrame =
  | NativeWireBeginFrame
  | NativeWireDataFrame
  | NativeWireEndFrame
  | NativeWireCancelFrame
  | NativeWireAckFrame
  | NativeWireTerminalFrame
  | NativeWireRecordBeginFrame
  | NativeWireRecordJsonFrame
  | NativeWireRecordEndFrame;

export type CompletedNativeWireRecord = Readonly<{
  bytes: Uint8Array;
  kind: FactStreamKind;
  sourceLocalId: string;
}>;

export type NativeWireReceiveEvent =
  | Readonly<{ kind: 'data'; bytes: Uint8Array; frame: NativeWireDataFrame }>
  | Readonly<{ kind: 'record'; record: CompletedNativeWireRecord }>
  | Readonly<{ kind: 'terminal'; terminalFrame: NativeWireTerminalFrame }>
  | null;

type PendingRecord = {
  buffer: Uint8Array;
  byteLength: number;
  digest: string;
  kind: FactStreamKind;
  nextOffset: number;
  sourceLocalId: string;
};

function fail(
  code:
    | 'INVALID_ARGUMENT'
    | 'MIGRATION_VALIDATION_FAILED'
    | 'PAYLOAD_TOO_LARGE'
    | 'PROTOCOL_MISMATCH' = 'INVALID_ARGUMENT',
): never {
  throw new LocalDataContractError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail();
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
}

function parseSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail();
  return Number(value);
}

function parsePositiveByteLength(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail();
  if (Number(value) > maximum) fail('PAYLOAD_TOO_LARGE');
  return Number(value);
}

function hasC0OrC1Control(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function parseFactKind(value: unknown): FactStreamKind {
  if (typeof value !== 'string' || !NATIVE_WIRE_FACT_KINDS.includes(value as FactStreamKind)) fail();
  return value as FactStreamKind;
}

function parseSourceLocalId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || hasC0OrC1Control(value)) fail();
  return value;
}

function parseFrameBase<TType extends NativeWireFrameType>(
  value: unknown,
  type: TType,
  extraKeys: readonly string[],
): BaseFrame<TType> & Record<string, unknown> {
  const input = record(value);
  exactKeys(input, ['protocolVersion', 'sessionId', 'sequence', 'type', ...extraKeys]);
  if (input.protocolVersion !== LOCAL_DATA_PROTOCOL_VERSION) fail('PROTOCOL_MISMATCH');
  if (input.type !== type) fail();
  return {
    ...input,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId: parseMigrationId(input.sessionId),
    sequence: parseSequence(input.sequence),
    type,
  } as BaseFrame<TType> & Record<string, unknown>;
}

function assertSerializedFrameLimit(frame: NativeWireFrame): void {
  if (serializedJsonUtf8ByteLength(frame as unknown as JsonValue) > MAX_STREAM_FRAME_BYTES) fail('PAYLOAD_TOO_LARGE');
}

export function decodeNativeWireBase64(value: unknown, maximum = MAX_NATIVE_IMAGE_SLICE_BYTES): Uint8Array {
  if (typeof value !== 'string' || !value || !BASE64_PATTERN.test(value)) fail();
  try {
    const binary = globalThis.atob(value);
    if (binary.length > maximum) fail('PAYLOAD_TOO_LARGE');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch (error) {
    if (error instanceof LocalDataContractError) throw error;
    fail();
  }
}

export function encodeNativeWireBase64(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) fail();
  if (bytes.byteLength > MAX_NATIVE_IMAGE_SLICE_BYTES) fail('PAYLOAD_TOO_LARGE');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_STRING_CHUNK_BYTES) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_STRING_CHUNK_BYTES)));
  }
  return globalThis.btoa(chunks.join(''));
}

function parseNativeWireFrameInternal(value: unknown): NativeWireFrame {
  const input = record(value);
  const type = input.type;
  if (typeof type !== 'string' || !NATIVE_WIRE_FRAME_TYPES.includes(type as NativeWireFrameType)) fail();

  switch (type as NativeWireFrameType) {
    case 'begin': {
      const base = parseFrameBase(value, 'begin', ['operation', 'declaredTotalBytes']);
      const descriptor = parseStreamDescriptor({
        operation: base.operation,
        declaredTotalBytes: base.declaredTotalBytes,
      });
      const frame: NativeWireBeginFrame = { ...base, ...descriptor };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'data': {
      const base = parseFrameBase(value, 'data', ['encoding', 'data', 'byteLength', 'offset', 'sliceDigest']);
      if (base.encoding !== 'base64') fail();
      const byteLength = parsePositiveByteLength(base.byteLength, MAX_NATIVE_IMAGE_SLICE_BYTES);
      const data = typeof base.data === 'string' ? base.data : fail();
      if (decodeNativeWireBase64(data).byteLength !== byteLength) fail('MIGRATION_VALIDATION_FAILED');
      const frame: NativeWireDataFrame = {
        ...base,
        encoding: 'base64',
        data,
        byteLength,
        offset: parseSequence(base.offset),
        sliceDigest: parseOrderedFrameDigest(base.sliceDigest),
      };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'end': {
      const base = parseFrameBase(value, 'end', ['digest']);
      const frame: NativeWireEndFrame = { ...base, digest: parseOrderedFrameDigest(base.digest) };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'cancel': {
      const base = parseFrameBase(value, 'cancel', ['reason']);
      const reason = base.reason;
      if (
        typeof reason !== 'string' ||
        !['cancelled', 'digest-mismatch', 'invalid-frame', 'payload-too-large'].includes(reason)
      ) {
        fail();
      }
      const frame: NativeWireCancelFrame = { ...base, reason: reason as NativeWireCancelFrame['reason'] };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'ack': {
      const base = parseFrameBase(value, 'ack', ['acknowledgedSequence']);
      const frame: NativeWireAckFrame = { ...base, acknowledgedSequence: parseSequence(base.acknowledgedSequence) };
      if (frame.acknowledgedSequence >= frame.sequence) fail();
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'terminal': {
      const base = parseFrameBase(value, 'terminal', ['status']);
      const status = base.status;
      if (status !== 'ok' && status !== 'error' && status !== 'cancelled') fail();
      const frame: NativeWireTerminalFrame = { ...base, status };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'record-begin': {
      const base = parseFrameBase(value, 'record-begin', ['kind', 'sourceLocalId', 'byteLength', 'digest']);
      const frame: NativeWireRecordBeginFrame = {
        ...base,
        kind: parseFactKind(base.kind),
        sourceLocalId: parseSourceLocalId(base.sourceLocalId),
        byteLength: parsePositiveByteLength(base.byteLength, MAX_MIGRATION_FACT_RECORD_BYTES),
        digest: parseOrderedFrameDigest(base.digest),
      };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'record-json': {
      const base = parseFrameBase(value, 'record-json', ['encoding', 'data', 'byteLength', 'offset', 'chunkDigest']);
      if (base.encoding !== 'base64') fail();
      const byteLength = parsePositiveByteLength(base.byteLength, MAX_NATIVE_IMAGE_SLICE_BYTES);
      const data = typeof base.data === 'string' ? base.data : fail();
      if (decodeNativeWireBase64(data).byteLength !== byteLength) fail('MIGRATION_VALIDATION_FAILED');
      const frame: NativeWireRecordJsonFrame = {
        ...base,
        encoding: 'base64',
        data,
        byteLength,
        offset: parseSequence(base.offset),
        chunkDigest: parseOrderedFrameDigest(base.chunkDigest),
      };
      assertSerializedFrameLimit(frame);
      return frame;
    }
    case 'record-end': {
      const base = parseFrameBase(value, 'record-end', ['digest']);
      const frame: NativeWireRecordEndFrame = { ...base, digest: parseOrderedFrameDigest(base.digest) };
      assertSerializedFrameLimit(frame);
      return frame;
    }
  }
}

export function parseNativeWireFrame(value: unknown): NativeWireFrame {
  try {
    return parseNativeWireFrameInternal(value);
  } catch (error) {
    if (error instanceof LocalDataContractError) throw error;
    fail();
  }
}

export function serializeNativeWireFrame(frame: NativeWireFrame): string {
  const parsed = parseNativeWireFrame(frame);
  const serialized = JSON.stringify(parsed);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STREAM_FRAME_BYTES) fail('PAYLOAD_TOO_LARGE');
  return serialized;
}

export async function createNativeWireDataFrame(input: {
  bytes: Uint8Array;
  offset: number;
  provider: DigestProvider;
  sequence: number;
  sessionId: MigrationId;
}): Promise<NativeWireDataFrame> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) fail();
  const frame = {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId: input.sessionId,
    sequence: input.sequence,
    type: 'data' as const,
    encoding: 'base64' as const,
    data: encodeNativeWireBase64(input.bytes),
    byteLength: input.bytes.byteLength,
    offset: input.offset,
    sliceDigest: await sha256Hex(input.provider, input.bytes),
  };
  return parseNativeWireFrame(frame) as NativeWireDataFrame;
}

export async function createNativeWireRecordJsonFrame(input: {
  bytes: Uint8Array;
  offset: number;
  provider: DigestProvider;
  sequence: number;
  sessionId: MigrationId;
}): Promise<NativeWireRecordJsonFrame> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) fail();
  return parseNativeWireFrame({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId: input.sessionId,
    sequence: input.sequence,
    type: 'record-json',
    encoding: 'base64',
    data: encodeNativeWireBase64(input.bytes),
    byteLength: input.bytes.byteLength,
    offset: input.offset,
    chunkDigest: await sha256Hex(input.provider, input.bytes),
  }) as NativeWireRecordJsonFrame;
}

export class NativeWireSessionReceiver {
  #begun: NativeWireBeginFrame | null = null;
  #cancelled = false;
  #closed = false;
  #ended = false;
  #failed = false;
  #nextSequence = 0;
  #receivedBytes = 0;
  #record: PendingRecord | null = null;

  private constructor(
    private readonly sessionId: MigrationId,
    private readonly provider: DigestProvider,
    private readonly digest: OrderedFrameDigestAccumulator,
  ) {}

  static async create(sessionId: MigrationId, provider: DigestProvider): Promise<NativeWireSessionReceiver> {
    return new NativeWireSessionReceiver(
      parseMigrationId(sessionId),
      provider,
      await OrderedFrameDigestAccumulator.create(provider),
    );
  }

  get closed(): boolean {
    return this.#closed || this.#failed;
  }

  get failed(): boolean {
    return this.#failed;
  }

  #abort(): void {
    this.#record = null;
    this.#failed = true;
  }

  #assertExpectedFrame(frame: NativeWireFrame): void {
    if (this.#closed || this.#failed || frame.sessionId !== this.sessionId || frame.sequence !== this.#nextSequence)
      fail();
    this.#nextSequence += 1;
  }

  #assertDataOperation(): NativeWireBeginFrame {
    if (
      !this.#begun ||
      this.#begun.operation === 'migration-fact-record' ||
      this.#record ||
      this.#cancelled ||
      this.#ended
    ) {
      fail('MIGRATION_VALIDATION_FAILED');
    }
    return this.#begun;
  }

  #assertRecordOperation(): NativeWireBeginFrame {
    if (!this.#begun || this.#begun.operation !== 'migration-fact-record' || this.#cancelled || this.#ended) {
      fail('MIGRATION_VALIDATION_FAILED');
    }
    return this.#begun;
  }

  async accept(value: unknown): Promise<NativeWireReceiveEvent> {
    try {
      const frame = parseNativeWireFrame(value);
      this.#assertExpectedFrame(frame);

      if (!this.#begun) {
        if (frame.type !== 'begin' || frame.sequence !== 0) fail('MIGRATION_VALIDATION_FAILED');
        this.#begun = frame;
        return null;
      }

      if (frame.type === 'begin') fail('MIGRATION_VALIDATION_FAILED');
      if (this.#cancelled) {
        if (frame.type !== 'terminal' || frame.status !== 'cancelled') fail('MIGRATION_VALIDATION_FAILED');
        this.#closed = true;
        return { kind: 'terminal', terminalFrame: frame };
      }

      if (frame.type === 'cancel') {
        if (this.#ended) fail('MIGRATION_VALIDATION_FAILED');
        this.#record = null;
        this.#cancelled = true;
        return null;
      }

      if (frame.type === 'ack') return null;

      if (frame.type === 'data') {
        const begin = this.#assertDataOperation();
        const bytes = decodeNativeWireBase64(frame.data);
        if (
          bytes.byteLength !== frame.byteLength ||
          frame.offset !== this.#receivedBytes ||
          this.#receivedBytes + bytes.byteLength > begin.declaredTotalBytes ||
          (await sha256Hex(this.provider, bytes)) !== frame.sliceDigest
        ) {
          fail('MIGRATION_VALIDATION_FAILED');
        }
        await this.digest.append({ sequence: frame.sequence, byteLength: bytes.byteLength, digest: frame.sliceDigest });
        this.#receivedBytes += bytes.byteLength;
        return { kind: 'data', bytes, frame };
      }

      if (frame.type === 'record-begin') {
        const begin = this.#assertRecordOperation();
        if (this.#record || this.#receivedBytes !== 0 || frame.byteLength !== begin.declaredTotalBytes) {
          fail('MIGRATION_VALIDATION_FAILED');
        }
        // ponytail: one bounded record buffer only; use incremental JSON/SQLite binding if facts ever exceed the 64 MiB protocol ceiling.
        this.#record = {
          buffer: new Uint8Array(frame.byteLength),
          byteLength: frame.byteLength,
          digest: frame.digest,
          kind: frame.kind,
          nextOffset: 0,
          sourceLocalId: frame.sourceLocalId,
        };
        return null;
      }

      if (frame.type === 'record-json') {
        const current = this.#record;
        if (!current) fail('MIGRATION_VALIDATION_FAILED');
        const bytes = decodeNativeWireBase64(frame.data);
        if (
          bytes.byteLength !== frame.byteLength ||
          frame.offset !== current.nextOffset ||
          frame.offset + bytes.byteLength > current.byteLength ||
          (await sha256Hex(this.provider, bytes)) !== frame.chunkDigest
        ) {
          fail('MIGRATION_VALIDATION_FAILED');
        }
        current.buffer.set(bytes, frame.offset);
        current.nextOffset += bytes.byteLength;
        await this.digest.append({ sequence: frame.sequence, byteLength: bytes.byteLength, digest: frame.chunkDigest });
        return null;
      }

      if (frame.type === 'record-end') {
        const current = this.#record;
        if (!current || current.nextOffset !== current.byteLength || frame.digest !== current.digest) {
          fail('MIGRATION_VALIDATION_FAILED');
        }
        if ((await sha256Hex(this.provider, current.buffer)) !== current.digest) fail('MIGRATION_VALIDATION_FAILED');
        try {
          JSON.parse(textDecoder.decode(current.buffer));
        } catch (_error) {
          fail('MIGRATION_VALIDATION_FAILED');
        }
        this.#receivedBytes += current.byteLength;
        this.#record = null;
        return {
          kind: 'record',
          record: { bytes: current.buffer, kind: current.kind, sourceLocalId: current.sourceLocalId },
        };
      }

      if (frame.type === 'end') {
        if (this.#ended || !this.#begun || this.#record || this.#receivedBytes !== this.#begun.declaredTotalBytes) {
          fail('MIGRATION_VALIDATION_FAILED');
        }
        if (frame.digest !== this.digest.finalize()) fail('MIGRATION_VALIDATION_FAILED');
        this.#ended = true;
        return null;
      }

      if (frame.type === 'terminal') {
        if (frame.status === 'error') {
          this.#record = null;
          this.#closed = true;
          return { kind: 'terminal', terminalFrame: frame };
        }
        if (!this.#begun || this.#record || !this.#ended || frame.status !== 'ok') fail('MIGRATION_VALIDATION_FAILED');
        this.#closed = true;
        return { kind: 'terminal', terminalFrame: frame };
      }

      fail('MIGRATION_VALIDATION_FAILED');
    } catch (error) {
      this.#abort();
      if (error instanceof LocalDataContractError) throw error;
      fail('MIGRATION_VALIDATION_FAILED');
    }
  }
}
