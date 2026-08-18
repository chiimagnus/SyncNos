import {
  RuntimeStreamReceiver,
  RuntimeStreamSender,
  createRuntimeStreamError,
  parseRuntimeStreamMessage,
  type RuntimeStreamMessage,
  type RuntimeStreamPort,
} from '@platform/messaging/stream-port';
import {
  LocalDataContractError,
  createLocalDataError,
  parseJsonValue,
  parseStreamDescriptor,
  type JsonValue,
  type LocalDataError,
  type LocalDataStreamOperation,
  type StreamDescriptor,
} from './contracts';
import {
  assertFactsOperationLease,
  type FactsOperationGate,
  type FactsOperationLease,
  type FactsOperationReservation,
} from './facts-operation-gate';

type PortListener = (message?: unknown) => void;

export const BACKGROUND_STREAM_INACTIVITY_TIMEOUT_MS = 60_000;

export type BackgroundStreamPort = RuntimeStreamPort &
  Readonly<{
    onDisconnect?: Readonly<{
      addListener?: (listener: PortListener) => void;
      removeListener?: (listener: PortListener) => void;
    }>;
    onMessage?: Readonly<{
      addListener?: (listener: PortListener) => void;
      removeListener?: (listener: PortListener) => void;
    }>;
  }>;

type ConnectedBackgroundStreamPort = BackgroundStreamPort &
  Readonly<{
    onDisconnect: Readonly<{
      addListener: (listener: PortListener) => void;
      removeListener?: (listener: PortListener) => void;
    }>;
    onMessage: Readonly<{
      addListener: (listener: PortListener) => void;
      removeListener?: (listener: PortListener) => void;
    }>;
  }>;

export type BackgroundStreamHandler = Readonly<{
  authorizeUpload?: (
    input: Readonly<{ requestId: string; stream: StreamDescriptor }>,
  ) => FactsOperationReservation | void;
  download?: (
    input: Readonly<{
      lease: FactsOperationLease;
      operation: LocalDataStreamOperation;
      requestId: string;
      send: (bytes: Uint8Array) => Promise<void>;
    }>,
  ) => Promise<void>;
  upload?: (
    input: Readonly<{
      bytes: Uint8Array;
      lease: FactsOperationLease;
      operation: LocalDataStreamOperation;
      requestId: string;
      stream: StreamDescriptor;
    }>,
  ) => Promise<JsonValue | void>;
}>;

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function localDataError(error: unknown): LocalDataError {
  if (error instanceof LocalDataContractError) return createLocalDataError(error.code, error.diagnostics);
  return createLocalDataError('INVALID_ARGUMENT');
}

function safeRequestId(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test((value as { requestId: string }).requestId)
  ) {
    return (value as { requestId: string }).requestId;
  }
  return 'stream';
}

function closePort(port: unknown): void {
  try {
    (port as RuntimeStreamPort | null)?.disconnect?.();
  } catch {
    // A disconnected Runtime Port cannot be reused.
  }
}

function asBackgroundStreamPort(value: unknown): ConnectedBackgroundStreamPort | null {
  if (!value || typeof value !== 'object') return null;
  const port = value as BackgroundStreamPort;
  if (
    typeof port.postMessage !== 'function' ||
    typeof port.onMessage?.addListener !== 'function' ||
    typeof port.onDisconnect?.addListener !== 'function'
  ) {
    return null;
  }
  return port as ConnectedBackgroundStreamPort;
}

/**
 * Owns only allowlisted facts byte streams. A stream has one gate lease from open through
 * the terminal handler boundary; no malformed or incomplete stream reaches its handler.
 */
export class BackgroundStreamRouter {
  #handlers = new Map<LocalDataStreamOperation, BackgroundStreamHandler>();
  #inactivityTimeoutMs: number;

  constructor(
    private readonly gate: FactsOperationGate,
    dependencies: Readonly<{ inactivityTimeoutMs?: number }> = {},
  ) {
    const inactivityTimeoutMs = dependencies.inactivityTimeoutMs ?? BACKGROUND_STREAM_INACTIVITY_TIMEOUT_MS;
    if (!Number.isSafeInteger(inactivityTimeoutMs) || inactivityTimeoutMs <= 0 || inactivityTimeoutMs > 10 * 60_000) {
      throw new LocalDataContractError('INVALID_ARGUMENT');
    }
    this.#inactivityTimeoutMs = inactivityTimeoutMs;
  }

  register(operation: LocalDataStreamOperation, handler: BackgroundStreamHandler): void {
    const parsedOperation = parseStreamDescriptor({ operation, declaredTotalBytes: 0 }).operation;
    if (
      !handler ||
      typeof handler !== 'object' ||
      (handler.authorizeUpload !== undefined && typeof handler.authorizeUpload !== 'function') ||
      (handler.upload !== undefined && typeof handler.upload !== 'function') ||
      (handler.download !== undefined && typeof handler.download !== 'function') ||
      (!handler.upload && !handler.download) ||
      this.#handlers.has(parsedOperation)
    ) {
      throw new LocalDataContractError('INVALID_ARGUMENT');
    }
    this.#handlers.set(parsedOperation, handler);
  }

  registerPort(rawPort: unknown): boolean {
    const port = asBackgroundStreamPort(rawPort);
    if (!port) {
      closePort(rawPort);
      return false;
    }

    let closed = false;
    let disconnectObserved = false;
    let messageQueue = Promise.resolve();
    let requestId: string | null = null;
    let receiver: RuntimeStreamReceiver | null = null;
    let sender: RuntimeStreamSender | null = null;
    let upload: Deferred<Uint8Array> | null = null;
    let inactivityTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const clearInactivityTimeout = () => {
      if (inactivityTimer === null) return;
      globalThis.clearTimeout(inactivityTimer);
      inactivityTimer = null;
    };
    const cleanup = () => {
      port.onMessage?.removeListener?.(onMessage);
      port.onDisconnect?.removeListener?.(onDisconnect);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      clearInactivityTimeout();
      receiver?.dispose();
      sender?.dispose();
      cleanup();
      closePort(port);
    };
    const fail = (error: unknown, rawRequestId?: unknown) => {
      if (closed) return;
      const id = requestId ?? safeRequestId(rawRequestId);
      try {
        port.postMessage(createRuntimeStreamError(id, localDataError(error)));
      } catch {
        // A failed error reply has the same cleanup path.
      }
      upload?.reject(error);
      close();
    };
    const armInactivityTimeout = () => {
      clearInactivityTimeout();
      inactivityTimer = globalThis.setTimeout(
        () => fail(new LocalDataContractError('HOST_UNAVAILABLE'), requestId ?? undefined),
        this.#inactivityTimeoutMs,
      );
    };

    const startUpload = (message: Extract<RuntimeStreamMessage, { type: 'open'; direction: 'upload' }>) => {
      const registered = this.#handlers.get(message.stream.operation);
      if (!registered?.upload) throw new LocalDataContractError('INVALID_ARGUMENT');
      let reservation: FactsOperationReservation | void = undefined;
      try {
        reservation = registered.authorizeUpload?.({
          requestId: message.requestId,
          stream: message.stream,
        });
        if (reservation) {
          if (typeof reservation.release !== 'function') throw new LocalDataContractError('INVALID_ARGUMENT');
          assertFactsOperationLease(reservation.lease);
        }
        const handler = registered.upload;
        requestId = message.requestId;
        receiver = new RuntimeStreamReceiver(message.requestId, message.stream);
        upload = deferred<Uint8Array>();
        // Admission can fail before the gate callback ever awaits this deferred. Attach a
        // rejection observer immediately so cleanup can reject it without leaking an
        // unhandled Promise; an admitted callback still observes the same rejection.
        void upload.promise.catch(() => undefined);
        armInactivityTimeout();
        const execute = async (lease: FactsOperationLease) => {
          const bytes = await upload!.promise;
          return await handler({
            bytes,
            lease,
            operation: message.stream.operation,
            requestId: message.requestId,
            stream: message.stream,
          });
        };
        const operation = reservation
          ? (async () => {
              try {
                return await execute(reservation!.lease);
              } finally {
                reservation!.release();
              }
            })()
          : this.gate.runFactsOperation(`stream:${message.stream.operation}`, execute);
        void operation
          .then((data) => {
            if (closed) return;
            port.postMessage({
              type: 'complete',
              requestId: message.requestId,
              ...(data === undefined ? {} : { data: parseJsonValue(data) }),
            });
            close();
          })
          .catch((error) => fail(error, message.requestId));
      } catch (error) {
        reservation?.release();
        throw error;
      }
    };

    const startDownload = (message: Extract<RuntimeStreamMessage, { type: 'open'; direction: 'download' }>) => {
      const handler = this.#handlers.get(message.operation)?.download;
      if (!handler) throw new LocalDataContractError('INVALID_ARGUMENT');
      requestId = message.requestId;
      sender = new RuntimeStreamSender({ announceHeader: true, port, requestId: message.requestId });
      let sent = false;
      void this.gate
        .runFactsOperation(`stream:${message.operation}`, async (lease) => {
          await handler({
            lease,
            operation: message.operation,
            requestId: message.requestId,
            send: async (bytes) => {
              if (sent) throw new LocalDataContractError('INVALID_ARGUMENT');
              sent = true;
              armInactivityTimeout();
              try {
                await sender!.send(bytes, { operation: message.operation, declaredTotalBytes: bytes.byteLength });
              } finally {
                clearInactivityTimeout();
              }
            },
          });
          if (!sent) throw new LocalDataContractError('INVALID_ARGUMENT');
        })
        .then(close)
        .catch((error) => fail(error, message.requestId));
    };

    const handleMessage = async (raw: unknown) => {
      if (closed) return;
      const message = parseRuntimeStreamMessage(raw);
      if (!requestId) {
        if (message.type !== 'open') throw new LocalDataContractError('PROTOCOL_MISMATCH');
        if (message.direction === 'upload') startUpload(message);
        else startDownload(message);
        return;
      }
      if (message.requestId !== requestId || message.type === 'open' || message.type === 'header') {
        throw new LocalDataContractError('PROTOCOL_MISMATCH');
      }
      if (receiver) {
        if (message.type !== 'frame') throw new LocalDataContractError('PROTOCOL_MISMATCH');
        armInactivityTimeout();
        const event = await receiver.accept(message);
        if (event?.kind === 'ack') {
          port.postMessage({
            type: 'ack',
            requestId,
            acknowledgedSequence: event.acknowledgedSequence,
          });
          return;
        }
        if (event?.kind === 'complete') {
          clearInactivityTimeout();
          upload?.resolve(event.bytes);
        }
        if (event?.kind === 'cancelled' || event?.kind === 'failed') {
          clearInactivityTimeout();
          upload?.reject(new LocalDataContractError('MIGRATION_VALIDATION_FAILED'));
        }
        return;
      }
      if (sender) {
        if (message.type === 'ack') armInactivityTimeout();
        sender.accept(message);
        return;
      }
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    };

    const onMessage: PortListener = (raw) => {
      if (disconnectObserved) return;
      messageQueue = messageQueue.then(() => handleMessage(raw)).catch((error) => fail(error, raw));
    };
    const onDisconnect: PortListener = () => {
      if (closed || disconnectObserved) return;
      disconnectObserved = true;
      messageQueue = messageQueue
        .then(() => {
          if (closed) return;
          upload?.reject(new LocalDataContractError('HOST_UNAVAILABLE'));
          close();
        })
        .catch((error) => fail(error, requestId ?? undefined));
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    return true;
  }
}
