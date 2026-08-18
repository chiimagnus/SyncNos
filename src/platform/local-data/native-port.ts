import { browserDigestProvider } from './browser-digest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  LocalDataContractError,
  parseFactsMigrationReceipt,
  parseHostFactsResponse,
  parseMigrationId,
  parseNativeHostBackupStreamResponseData,
  parseNativeHostImageAssetResponseData,
  parseNativeHostImportAcceptedData,
  parseNativeHostStreamResponseData,
  type FactsMigrationReceipt,
  type HostFactsRequest,
  type StreamDescriptor,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator, type DigestProvider } from '@services/local-data/digest';
import { parseFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import {
  NativeWireSessionReceiver,
  createNativeWireDataFrame,
  parseNativeWireFrame,
  type NativeWireFrame,
} from '@services/local-data/native-wire';

export const NATIVE_PORT_OPERATION_TIMEOUT_MS = 10 * 60_000;

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

async function postNativeByteStream(
  input: Readonly<{
    bytes: Uint8Array;
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    stream: StreamDescriptor;
  }>,
): Promise<void> {
  if (input.bytes.byteLength !== input.stream.declaredTotalBytes) throw protocolFailure();

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

type NativePortStreamHeader = Readonly<{ stream: StreamDescriptor }>;

function readNativePortStream<THeader extends NativePortStreamHeader, TResult>(
  input: Readonly<{
    decode: (header: THeader, bytes: Uint8Array) => TResult;
    digestProvider?: DigestProvider;
    parseHeader: (value: unknown) => THeader;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    start?: () => Promise<void>;
  }>,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream: THeader | null = null;
    let receiver: NativeWireSessionReceiver | null = null;
    let bytes: Uint8Array | null = null;
    let processing = Promise.resolve();
    let disconnectObserved = false;
    let operationTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => {
      if (operationTimer !== null) {
        globalThis.clearTimeout(operationTimer);
        operationTimer = null;
      }
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
    const succeed = (data: TResult) => finish(() => resolve(data));

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

      succeed(input.decode(stream!, bytes!));
    };

    const onMessage: NativePortListener = (message) => {
      // Native Messaging EOF means no new messages can arrive. Frames whose listeners already ran
      // before EOF remain authoritative and must drain before EOF is classified as a failure.
      if (disconnectObserved) return;
      processing = processing
        .then(async () => {
          if (settled) return;
          if (!stream) {
            const response = parseHostFactsResponse(message);
            if (response.requestId !== input.request.requestId) throw protocolFailure();
            if (!response.ok) throw new LocalDataContractError(response.error.code, response.error.diagnostics);
            stream = input.parseHeader(response.data);
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
    const onDisconnect: NativePortListener = () => {
      if (settled || disconnectObserved) return;
      disconnectObserved = true;
      processing = processing
        .then(() => {
          if (!settled) fail(new LocalDataContractError('HOST_UNAVAILABLE'));
        })
        .catch(fail);
    };

    input.port.onMessage.addListener(onMessage);
    input.port.onDisconnect.addListener(onDisconnect);
    operationTimer = globalThis.setTimeout(
      () => fail(new LocalDataContractError('HOST_UNAVAILABLE')),
      NATIVE_PORT_OPERATION_TIMEOUT_MS,
    );
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
  return readNativePortStream({
    ...input,
    parseHeader: parseNativeHostStreamResponseData,
    decode: (_header, bytes) => {
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw protocolFailure();
      }
    },
  });
}

export type NativePortImageAsset = Readonly<{
  backendAssetId: number;
  byteSize: number;
  bytes: Uint8Array;
  contentType: string;
}>;

/** Reads one bounded portable backup facts payload from the Host. */
export function readNativePortBackupBytes(
  input: Readonly<{
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
  }>,
): Promise<Uint8Array> {
  if (input.request.command !== 'EXPORT_BACKUP') return Promise.reject(protocolFailure());
  return readNativePortStream({
    ...input,
    parseHeader: parseNativeHostBackupStreamResponseData,
    decode: (_header, bytes) => bytes,
  });
}

/** Reads raw image bytes only after the strict ownership-bound image header is verified. */
export function readNativePortImageAsset(
  input: Readonly<{
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
  }>,
): Promise<NativePortImageAsset> {
  return readNativePortStream({
    ...input,
    parseHeader: parseNativeHostImageAssetResponseData,
    decode: (header, bytes) =>
      Object.freeze({
        ...header.asset,
        bytes: Uint8Array.from(bytes),
      }),
  });
}

export type NativeFactsImportProducer = (
  input: Readonly<{
    onFrame: (frame: NativeWireFrame) => Promise<void>;
    signal: AbortSignal;
  }>,
) => Promise<FactsManifest>;

/**
 * Opens one Host staging session before the IndexedDB producer is allowed to read facts.
 * The same Native port carries every self-declared P1 record/asset session and the final manifest.
 */
export function writeNativePortFactsImport(
  input: Readonly<{
    port: NativeMessagingPort;
    produce: NativeFactsImportProducer;
    request: HostFactsRequest;
  }>,
): Promise<FactsMigrationReceipt> {
  if (input.request.command !== 'IMPORT_FACTS') return Promise.reject(protocolFailure());

  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    let accepted = false;
    let completeSent = false;
    let processing = Promise.resolve();
    let disconnectObserved = false;
    let settled = false;
    let operationTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => {
      if (operationTimer !== null) {
        globalThis.clearTimeout(operationTimer);
        operationTimer = null;
      }
      input.port.onMessage.removeListener?.(onMessage);
      input.port.onDisconnect.removeListener?.(onDisconnect);
    };
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      abortController.abort();
      cleanup();
      closePort(input.port);
      outcome();
    };
    const fail = (error: unknown) => {
      const safeError = error instanceof LocalDataContractError ? error : protocolFailure();
      finish(() => reject(safeError));
    };
    const post = (message: unknown) => {
      if (settled || abortController.signal.aborted) throw new LocalDataContractError('HOST_UNAVAILABLE');
      input.port.postMessage(message);
    };

    const produce = async () => {
      const manifest = parseFactsManifest(
        await input.produce({
          signal: abortController.signal,
          onFrame: async (frame) => {
            post(parseNativeWireFrame(frame));
          },
        }),
      );
      if (settled || abortController.signal.aborted) return;
      completeSent = true;
      post({ type: 'complete', manifest });
    };

    const onMessage: NativePortListener = (message) => {
      if (disconnectObserved) return;
      processing = processing
        .then(async () => {
          if (settled) return;
          const response = parseHostFactsResponse(message);
          if (response.requestId !== input.request.requestId) throw protocolFailure();
          if (!response.ok) throw new LocalDataContractError(response.error.code, response.error.diagnostics);

          if (!accepted) {
            parseNativeHostImportAcceptedData(response.data);
            accepted = true;
            void produce().catch(fail);
            return;
          }
          if (!completeSent) throw protocolFailure();
          const receipt = parseFactsMigrationReceipt(response.data);
          finish(() => resolve(receipt));
        })
        .catch(fail);
    };
    const onDisconnect: NativePortListener = () => {
      if (settled || disconnectObserved) return;
      disconnectObserved = true;
      processing = processing
        .then(() => {
          if (!settled) fail(new LocalDataContractError('HOST_UNAVAILABLE'));
        })
        .catch(fail);
    };

    input.port.onMessage.addListener(onMessage);
    input.port.onDisconnect.addListener(onDisconnect);
    operationTimer = globalThis.setTimeout(
      () => fail(new LocalDataContractError('HOST_UNAVAILABLE')),
      NATIVE_PORT_OPERATION_TIMEOUT_MS,
    );
    try {
      post(input.request);
    } catch (error) {
      fail(error);
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
  if (input.request.command !== 'SAVE_CONVERSATION_SNAPSHOT' || input.stream.operation !== 'capture-snapshot') {
    throw protocolFailure();
  }
  return await readNativePortJson({
    digestProvider: input.digestProvider,
    port: input.port,
    request: input.request,
    start: async () => await postNativeByteStream(input),
  });
}

/** Uploads one fully validated portable backup facts payload before reading the compact import stats. */
export async function writeNativePortBackupBytes(
  input: Readonly<{
    bytes: Uint8Array;
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    stream: StreamDescriptor;
  }>,
): Promise<unknown> {
  if (input.request.command !== 'IMPORT_BACKUP' || input.stream.operation !== 'zip-backup') {
    throw protocolFailure();
  }
  return await readNativePortJson({
    digestProvider: input.digestProvider,
    port: input.port,
    request: input.request,
    start: async () => await postNativeByteStream(input),
  });
}

/** Uploads one image through bounded Native Messaging frames before reading the compact typed Host result. */
export async function writeNativePortImageAsset(
  input: Readonly<{
    bytes: Uint8Array;
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
    stream: StreamDescriptor;
  }>,
): Promise<unknown> {
  if (input.request.command !== 'PUT_IMAGE_ASSET' || input.stream.operation !== 'image-asset') {
    throw protocolFailure();
  }
  return await readNativePortJson({
    digestProvider: input.digestProvider,
    port: input.port,
    request: input.request,
    start: async () => await postNativeByteStream(input),
  });
}
