import { browserDigestProvider } from './browser-digest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  LocalDataContractError,
  parseHostFactsResponse,
  parseMigrationId,
  parseNativeHostStreamResponseData,
  type HostFactsRequest,
  type StreamDescriptor,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator, type DigestProvider } from '@services/local-data/digest';
import {
  NativeWireSessionReceiver,
  createNativeWireDataFrame,
  parseNativeWireFrame,
} from '@services/local-data/native-wire';

type NativePortListener = (message?: unknown) => void;

type NativePortEvent = Readonly<{
  addListener: (listener: NativePortListener) => void;
  removeListener?: (listener: NativePortListener) => void;
}>;

export type NativeMessagingPort = Readonly<{
  disconnect: () => void;
  onDisconnect: NativePortEvent;
  onMessage: NativePortEvent;
  postMessage: (message: unknown) => void;
}>;

function protocolFailure(): LocalDataContractError {
  return new LocalDataContractError('PROTOCOL_MISMATCH');
}

function closePort(port: NativeMessagingPort): void {
  try {
    port.disconnect();
  } catch {
    // The Native Host is already one-shot; a failed disconnect has no reusable state.
  }
}

function hasOkField(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'ok');
}

function nativeSessionId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (typeof value !== 'string') throw new LocalDataContractError('HOST_UNAVAILABLE');
  return parseMigrationId(value);
}

async function postCaptureSnapshotStream(
  input: Readonly<{
    bytes: Uint8Array;
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    stream: StreamDescriptor;
  }>,
): Promise<void> {
  if (
    input.request.command !== 'SAVE_CONVERSATION_SNAPSHOT' ||
    input.stream.operation !== 'capture-snapshot' ||
    input.bytes.byteLength !== input.stream.declaredTotalBytes
  ) {
    throw protocolFailure();
  }

  const provider = input.digestProvider ?? browserDigestProvider;
  const sessionId = nativeSessionId();
  const digest = await OrderedFrameDigestAccumulator.create(provider);
  let sequence = 0;
  input.port.postMessage(input.request);
  input.port.postMessage({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence: sequence++,
    type: 'begin',
    operation: input.stream.operation,
    declaredTotalBytes: input.stream.declaredTotalBytes,
  });
  for (let offset = 0; offset < input.bytes.byteLength; offset += MAX_NATIVE_IMAGE_SLICE_BYTES) {
    const frame = await createNativeWireDataFrame({
      bytes: input.bytes.subarray(offset, offset + MAX_NATIVE_IMAGE_SLICE_BYTES),
      offset,
      provider,
      sequence: sequence++,
      sessionId,
    });
    await digest.append({ sequence: frame.sequence, byteLength: frame.byteLength, digest: frame.sliceDigest });
    input.port.postMessage(frame);
  }
  input.port.postMessage({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence: sequence++,
    type: 'end',
    digest: digest.finalize(),
  });
  input.port.postMessage({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence,
    type: 'terminal',
    status: 'ok',
  });
}

/**
 * Reads one Host JSON response from one Native Messaging port. The port is never reused:
 * any terminal, cancellation, malformed frame, or disconnect releases it immediately.
 */
export function readNativePortJson(
  input: Readonly<{
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    start?: () => Promise<void>;
  }>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream: ReturnType<typeof parseNativeHostStreamResponseData> | null = null;
    let receiver: NativeWireSessionReceiver | null = null;
    let bytes: Uint8Array | null = null;
    let processing = Promise.resolve();

    const cleanup = () => {
      input.port.onMessage.removeListener?.(onMessage);
      input.port.onDisconnect.removeListener?.(onDisconnect);
    };
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      closePort(input.port);
      outcome();
    };
    const fail = (error: unknown) => {
      const safeError = error instanceof LocalDataContractError ? error : protocolFailure();
      finish(() => reject(safeError));
    };
    const succeed = (data: unknown) => finish(() => resolve(data));

    const acceptWireFrame = async (value: unknown) => {
      const frame = parseNativeWireFrame(value);
      if (!receiver) {
        if (frame.type !== 'begin') throw protocolFailure();
        if (
          !stream ||
          frame.operation !== stream.stream.operation ||
          frame.declaredTotalBytes !== stream.stream.declaredTotalBytes
        ) {
          throw protocolFailure();
        }
        receiver = await NativeWireSessionReceiver.create(
          frame.sessionId,
          input.digestProvider ?? browserDigestProvider,
        );
        bytes = new Uint8Array(stream.stream.declaredTotalBytes);
      }

      const event = await receiver.accept(frame);
      if (frame.type === 'cancel') throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      if (event?.kind === 'data') bytes!.set(event.bytes, event.frame.offset);
      if (event?.kind !== 'terminal') return;
      if (event.terminalFrame.status !== 'ok') throw new LocalDataContractError('HOST_UNAVAILABLE');

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes!));
      } catch {
        throw protocolFailure();
      }
      succeed(parsed);
    };

    const onMessage: NativePortListener = (message) => {
      processing = processing
        .then(async () => {
          if (settled) return;
          if (!stream) {
            const response = parseHostFactsResponse(message);
            if (response.requestId !== input.request.requestId) throw protocolFailure();
            if (!response.ok) throw new LocalDataContractError(response.error.code, response.error.diagnostics);
            stream = parseNativeHostStreamResponseData(response.data);
            return;
          }
          if (hasOkField(message)) {
            parseHostFactsResponse(message);
            throw protocolFailure();
          }
          await acceptWireFrame(message);
        })
        .catch(fail);
    };
    const onDisconnect: NativePortListener = () => fail(new LocalDataContractError('HOST_UNAVAILABLE'));

    input.port.onMessage.addListener(onMessage);
    input.port.onDisconnect.addListener(onDisconnect);
    if (input.start) {
      void input.start().catch(fail);
    } else {
      try {
        input.port.postMessage(input.request);
      } catch (error) {
        fail(error);
      }
    }
  });
}

/** Uploads one large canonical capture through bounded Native Messaging frames before reading the typed Host result. */
export async function writeNativePortCaptureSnapshot(
  input: Readonly<{
    bytes: Uint8Array;
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    stream: StreamDescriptor;
  }>,
): Promise<unknown> {
  return await readNativePortJson({
    digestProvider: input.digestProvider,
    port: input.port,
    request: input.request,
    start: async () => await postCaptureSnapshotStream(input),
  });
}
