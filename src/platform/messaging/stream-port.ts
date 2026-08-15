import { browserDigestProvider } from '@platform/local-data/browser-digest';
import { LOCAL_DATA_STREAM_MESSAGE_TYPES } from './message-contracts';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  MAX_STREAM_FRAME_BYTES,
  LocalDataContractError,
  createLocalDataError,
  parseLocalDataError,
  parseJsonValue,
  parseMigrationId,
  parseStreamDescriptor,
  serializedJsonUtf8ByteLength,
  type JsonValue,
  type LocalDataError,
  type LocalDataErrorCode,
  type LocalDataStreamOperation,
  type StreamDescriptor,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator, type DigestProvider } from '@services/local-data/digest';
import {
  NativeWireSessionReceiver,
  createNativeWireDataFrame,
  parseNativeWireFrame,
  type NativeWireFrame,
} from '@services/local-data/native-wire';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type RuntimeStreamPort = Readonly<{
  disconnect?: () => void;
  postMessage: (message: unknown) => void;
}>;

export type RuntimeStreamDirection = 'download' | 'upload';

export type RuntimeStreamOpenMessage =
  | Readonly<{
      direction: 'download';
      operation: LocalDataStreamOperation;
      requestId: string;
      type: 'open';
    }>
  | Readonly<{
      direction: 'upload';
      requestId: string;
      stream: StreamDescriptor;
      type: 'open';
    }>;

export type RuntimeStreamHeaderMessage = Readonly<{
  requestId: string;
  stream: StreamDescriptor;
  type: 'header';
}>;

export type RuntimeStreamFrameMessage = Readonly<{
  frame: NativeWireFrame;
  requestId: string;
  type: 'frame';
}>;

export type RuntimeStreamAckMessage = Readonly<{
  acknowledgedSequence: number;
  requestId: string;
  type: 'ack';
}>;

export type RuntimeStreamCompleteMessage = Readonly<{
  data?: JsonValue;
  requestId: string;
  type: 'complete';
}>;

export type RuntimeStreamErrorMessage = Readonly<{
  error: LocalDataError;
  requestId: string;
  type: 'error';
}>;

export type RuntimeStreamMessage =
  | RuntimeStreamOpenMessage
  | RuntimeStreamHeaderMessage
  | RuntimeStreamFrameMessage
  | RuntimeStreamAckMessage
  | RuntimeStreamCompleteMessage
  | RuntimeStreamErrorMessage;

export type RuntimeStreamReceiverEvent =
  | Readonly<{ acknowledgedSequence: number; kind: 'ack' }>
  | Readonly<{ bytes: Uint8Array; kind: 'complete' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'failed' }>
  | null;

export type RuntimeStreamSenderOptions = Readonly<{
  announceHeader: boolean;
  createSessionId?: () => string;
  digestProvider?: DigestProvider;
  port: RuntimeStreamPort;
  requestId: string;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidArgument();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidArgument();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalidArgument();
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalidArgument();
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || !REQUEST_ID_PATTERN.test(value)) invalidArgument();
  return value;
}

function nonNegativeSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidArgument();
  return Number(value);
}

function serializedMessageBytes(value: unknown): number {
  try {
    return serializedJsonUtf8ByteLength(value as JsonValue);
  } catch (error) {
    if (error instanceof LocalDataContractError) throw error;
    invalidArgument();
  }
}

function assertMessageWithinFrameLimit(value: unknown): void {
  const bytes = serializedMessageBytes(value);
  if (bytes > MAX_STREAM_FRAME_BYTES) {
    throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
      actualBytes: bytes,
      limitBytes: MAX_STREAM_FRAME_BYTES,
    });
  }
}

function operation(value: unknown): LocalDataStreamOperation {
  return parseStreamDescriptor({ operation: value, declaredTotalBytes: 0 }).operation;
}

function sessionId(createSessionId?: () => string): string {
  const value = createSessionId?.() ?? globalThis.crypto?.randomUUID?.();
  if (typeof value !== 'string') invalidArgument();
  return parseMigrationId(value);
}

function parseOpen(value: Record<string, unknown>): RuntimeStreamOpenMessage {
  if (value.direction === 'upload') {
    exactKeys(value, ['type', 'requestId', 'direction', 'stream']);
    return Object.freeze({
      type: 'open',
      requestId: requestId(value.requestId),
      direction: 'upload',
      stream: parseStreamDescriptor(value.stream),
    });
  }
  if (value.direction === 'download') {
    exactKeys(value, ['type', 'requestId', 'direction', 'operation']);
    return Object.freeze({
      type: 'open',
      requestId: requestId(value.requestId),
      direction: 'download',
      operation: operation(value.operation),
    });
  }
  invalidArgument();
}

/** Parses only the fixed, allowlisted Runtime Port protocol; it is not a generic message proxy. */
export function parseRuntimeStreamMessage(value: unknown): RuntimeStreamMessage {
  assertMessageWithinFrameLimit(value);
  const input = record(value);
  switch (input.type) {
    case LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN:
      return parseOpen(input);
    case LOCAL_DATA_STREAM_MESSAGE_TYPES.HEADER:
      exactKeys(input, ['type', 'requestId', 'stream']);
      return Object.freeze({
        type: 'header',
        requestId: requestId(input.requestId),
        stream: parseStreamDescriptor(input.stream),
      });
    case LOCAL_DATA_STREAM_MESSAGE_TYPES.FRAME:
      exactKeys(input, ['type', 'requestId', 'frame']);
      return Object.freeze({
        type: 'frame',
        requestId: requestId(input.requestId),
        frame: parseNativeWireFrame(input.frame),
      });
    case LOCAL_DATA_STREAM_MESSAGE_TYPES.ACK:
      exactKeys(input, ['type', 'requestId', 'acknowledgedSequence']);
      return Object.freeze({
        type: 'ack',
        requestId: requestId(input.requestId),
        acknowledgedSequence: nonNegativeSafeInteger(input.acknowledgedSequence),
      });
    case LOCAL_DATA_STREAM_MESSAGE_TYPES.COMPLETE:
      allowedKeys(input, ['type', 'requestId', 'data']);
      return Object.freeze({
        type: 'complete',
        requestId: requestId(input.requestId),
        ...(Object.prototype.hasOwnProperty.call(input, 'data') ? { data: parseJsonValue(input.data) } : {}),
      });
    case LOCAL_DATA_STREAM_MESSAGE_TYPES.ERROR:
      exactKeys(input, ['type', 'requestId', 'error']);
      return Object.freeze({
        type: 'error',
        requestId: requestId(input.requestId),
        error: parseLocalDataError(input.error),
      });
    default:
      invalidArgument();
  }
}

export function createRuntimeStreamError(
  requestIdValue: string,
  error: LocalDataErrorCode | LocalDataError,
): RuntimeStreamErrorMessage {
  return Object.freeze({
    type: LOCAL_DATA_STREAM_MESSAGE_TYPES.ERROR,
    requestId: requestId(requestIdValue),
    error: typeof error === 'string' ? createLocalDataError(error) : error,
  });
}

function wireProtocolFailure(): LocalDataContractError {
  return new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
}

/** Receives one declared byte stream and retains nothing after cancellation, failure, or completion. */
export class RuntimeStreamReceiver {
  #bytes: Uint8Array | null = null;
  #closed = false;
  #receiver: NativeWireSessionReceiver | null = null;
  readonly requestId: string;
  readonly stream: StreamDescriptor;

  constructor(
    requestIdValue: string,
    streamValue: StreamDescriptor,
    private readonly digestProvider: DigestProvider = browserDigestProvider,
  ) {
    this.requestId = requestId(requestIdValue);
    this.stream = parseStreamDescriptor(streamValue);
  }

  dispose(): void {
    this.#closed = true;
    this.#bytes = null;
    this.#receiver = null;
  }

  async accept(message: RuntimeStreamFrameMessage): Promise<RuntimeStreamReceiverEvent> {
    if (this.#closed || message.requestId !== this.requestId) protocolFailure();
    const frame = message.frame;
    if (
      frame.type === 'ack' ||
      frame.type === 'record-begin' ||
      frame.type === 'record-json' ||
      frame.type === 'record-end'
    ) {
      protocolFailure();
    }
    if (!this.#receiver) {
      if (
        frame.type !== 'begin' ||
        frame.operation !== this.stream.operation ||
        frame.declaredTotalBytes !== this.stream.declaredTotalBytes
      ) {
        protocolFailure();
      }
      this.#receiver = await NativeWireSessionReceiver.create(frame.sessionId, this.digestProvider);
      this.#bytes = new Uint8Array(this.stream.declaredTotalBytes);
    }

    const event = await this.#receiver.accept(frame);
    if (frame.type === 'cancel') {
      this.dispose();
      return { kind: 'cancelled' };
    }
    if (event?.kind === 'data') {
      this.#bytes!.set(event.bytes, event.frame.offset);
      return { kind: 'ack', acknowledgedSequence: event.frame.sequence };
    }
    if (event?.kind !== 'terminal') return null;

    const bytes = this.#bytes!;
    this.dispose();
    if (event.terminalFrame.status !== 'ok') return { kind: 'failed' };
    return { kind: 'complete', bytes };
  }
}

type AckWaiter = Readonly<{
  reject: (error: unknown) => void;
  resolve: () => void;
  sequence: number;
}>;

export class RuntimeStreamSender {
  #closed = false;
  #started = false;
  #waiter: AckWaiter | null = null;
  private readonly input: RuntimeStreamSenderOptions;

  constructor(input: RuntimeStreamSenderOptions) {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.announceHeader !== 'boolean' ||
      !input.port ||
      typeof input.port.postMessage !== 'function' ||
      (input.createSessionId !== undefined && typeof input.createSessionId !== 'function') ||
      (input.digestProvider !== undefined && typeof input.digestProvider.sha256 !== 'function')
    ) {
      invalidArgument();
    }
    this.input = {
      ...input,
      requestId: requestId(input.requestId),
    };
  }

  dispose(error: unknown = new LocalDataContractError('HOST_UNAVAILABLE')): void {
    if (this.#closed) return;
    this.#closed = true;
    const waiter = this.#waiter;
    this.#waiter = null;
    waiter?.reject(error);
  }

  accept(message: RuntimeStreamMessage): void {
    if (this.#closed || message.requestId !== this.input.requestId) return;
    if (message.type === 'ack') {
      const waiter = this.#waiter;
      if (!waiter || waiter.sequence !== message.acknowledgedSequence) {
        this.dispose(new LocalDataContractError('PROTOCOL_MISMATCH'));
        return;
      }
      this.#waiter = null;
      waiter.resolve();
      return;
    }
    if (message.type === 'error') {
      this.dispose(new LocalDataContractError(message.error.code, message.error.diagnostics));
      return;
    }
    if (message.type === 'frame' && message.frame.type === 'cancel') {
      this.dispose(wireProtocolFailure());
      return;
    }
    this.dispose(new LocalDataContractError('PROTOCOL_MISMATCH'));
  }

  async send(bytes: Uint8Array, stream: StreamDescriptor): Promise<void> {
    if (this.#closed || this.#started || !(bytes instanceof Uint8Array)) invalidArgument();
    const descriptor = parseStreamDescriptor(stream);
    if (bytes.byteLength !== descriptor.declaredTotalBytes) invalidArgument();
    this.#started = true;
    try {
      const session = sessionId(this.input.createSessionId);
      const digestProvider = this.input.digestProvider ?? browserDigestProvider;
      const digest = await OrderedFrameDigestAccumulator.create(digestProvider);
      let sequence = 0;

      if (this.input.announceHeader) {
        this.post({
          type: LOCAL_DATA_STREAM_MESSAGE_TYPES.HEADER,
          requestId: this.input.requestId,
          stream: descriptor,
        });
      }
      this.post({
        type: LOCAL_DATA_STREAM_MESSAGE_TYPES.FRAME,
        requestId: this.input.requestId,
        frame: {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: session,
          sequence: sequence++,
          type: 'begin',
          operation: descriptor.operation,
          declaredTotalBytes: descriptor.declaredTotalBytes,
        },
      });
      for (let offset = 0; offset < bytes.byteLength; offset += MAX_NATIVE_IMAGE_SLICE_BYTES) {
        const frame = await createNativeWireDataFrame({
          bytes: bytes.subarray(offset, Math.min(bytes.byteLength, offset + MAX_NATIVE_IMAGE_SLICE_BYTES)),
          offset,
          provider: digestProvider,
          sequence: sequence++,
          sessionId: session,
        });
        await digest.append({ sequence: frame.sequence, byteLength: frame.byteLength, digest: frame.sliceDigest });
        const acknowledgement = this.waitForAck(frame.sequence);
        this.post({ type: LOCAL_DATA_STREAM_MESSAGE_TYPES.FRAME, requestId: this.input.requestId, frame });
        await acknowledgement;
      }
      this.post({
        type: LOCAL_DATA_STREAM_MESSAGE_TYPES.FRAME,
        requestId: this.input.requestId,
        frame: {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: session,
          sequence: sequence++,
          type: 'end',
          digest: digest.finalize(),
        },
      });
      this.post({
        type: LOCAL_DATA_STREAM_MESSAGE_TYPES.FRAME,
        requestId: this.input.requestId,
        frame: {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId: session,
          sequence,
          type: 'terminal',
          status: 'ok',
        },
      });
      this.#closed = true;
    } catch (error) {
      this.dispose(error);
      throw error;
    }
  }

  private post(message: RuntimeStreamMessage): void {
    if (this.#closed) throw new LocalDataContractError('HOST_UNAVAILABLE');
    parseRuntimeStreamMessage(message);
    this.input.port.postMessage(message);
  }

  private async waitForAck(sequence: number): Promise<void> {
    if (this.#closed) throw new LocalDataContractError('HOST_UNAVAILABLE');
    await new Promise<void>((resolve, reject) => {
      this.#waiter = { sequence, resolve, reject };
    });
  }
}
