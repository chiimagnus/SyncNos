import {
  readNativePortImageAsset,
  readNativePortJson,
  writeNativePortCaptureSnapshot,
  writeNativePortImageAsset,
  type NativeMessagingPort,
} from './native-port';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  MAX_IMAGE_ASSET_BYTES,
  MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES,
  NATIVE_HOST_SINGLE_MESSAGE_COMMANDS,
  LocalDataContractError,
  parseHostFactsRequest,
  parseHostFactsResponse,
  type HostFactsCommand,
  type HostFactsPayloadByCommand,
  type HostFactsRequest,
} from '@services/local-data/contracts';
import type { DigestProvider } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { nativeHostContract } from '@services/local-data/native-host-contract';

export type NativeHostSingleMessageCommand = (typeof NATIVE_HOST_SINGLE_MESSAGE_COMMANDS)[number];

type NativeMessagingRuntime = Readonly<{
  connectNative?: (hostName: string) => NativeMessagingPort;
  lastError?: unknown;
  sendNativeMessage?: (...args: unknown[]) => unknown;
}>;

type NativeRuntimeStyle = 'callback' | 'promise';

export type NativeClientDependencies = Readonly<{
  createRequestId?: () => string;
  digestProvider?: DigestProvider;
  runtime?: NativeMessagingRuntime | null;
  runtimeStyle?: NativeRuntimeStyle;
}>;

export type NativeHostRequest<TCommand extends HostFactsCommand = HostFactsCommand> = Readonly<{
  command: TCommand;
  dependencies?: NativeClientDependencies;
  payload: HostFactsPayloadByCommand[TCommand];
  /** Raw bytes are local to the browser port and are never part of the Host JSON request. */
  uploadBytes?: Uint8Array;
}>;

type ResolvedNativeRuntime = Readonly<{
  runtime: NativeMessagingRuntime;
  style: NativeRuntimeStyle;
}>;

function runtimeError(error: unknown): LocalDataContractError {
  if (error instanceof LocalDataContractError) return error;
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '').toLowerCase();
  if (/forbidden|not allowed|origin.*denied|access.*native.*host/.test(message)) {
    return new LocalDataContractError('ORIGIN_DENIED');
  }
  if (/protocol/.test(message)) return new LocalDataContractError('PROTOCOL_MISMATCH');
  if (/schema/.test(message)) return new LocalDataContractError('SCHEMA_MISMATCH');
  if (/too large|too big|message length|exceeds/.test(message)) return new LocalDataContractError('PAYLOAD_TOO_LARGE');
  if (/unsupported/.test(message)) return new LocalDataContractError('UNSUPPORTED_PLATFORM');
  return new LocalDataContractError('HOST_UNAVAILABLE');
}

function requestId(dependencies: NativeClientDependencies | undefined): string {
  if (dependencies?.createRequestId) return dependencies.createRequestId();
  const value = globalThis.crypto?.randomUUID?.();
  if (typeof value !== 'string') throw new LocalDataContractError('HOST_UNAVAILABLE');
  return value;
}

function resolveRuntime(
  dependencies: NativeClientDependencies | undefined,
  method: keyof Pick<NativeMessagingRuntime, 'connectNative' | 'sendNativeMessage'>,
): ResolvedNativeRuntime {
  if (dependencies?.runtime?.[method]) {
    return { runtime: dependencies.runtime, style: dependencies.runtimeStyle ?? 'promise' };
  }
  const browserRuntime = (globalThis as { browser?: { runtime?: NativeMessagingRuntime } }).browser?.runtime;
  if (browserRuntime?.[method]) return { runtime: browserRuntime, style: 'promise' };
  const chromeRuntime = (globalThis as { chrome?: { runtime?: NativeMessagingRuntime } }).chrome?.runtime;
  if (chromeRuntime?.[method]) return { runtime: chromeRuntime, style: 'callback' };
  throw new LocalDataContractError('HOST_UNAVAILABLE');
}

function createRequest<TCommand extends HostFactsCommand>(input: NativeHostRequest<TCommand>) {
  return parseHostFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: requestId(input.dependencies),
    command: input.command,
    payload: input.payload,
  });
}

function captureSnapshotUpload(request: ReturnType<typeof createRequest>) {
  if (
    request.command !== 'SAVE_CONVERSATION_SNAPSHOT' ||
    !('snapshot' in request.payload) ||
    request.payload.transfer.declaredTotalBytes <= MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES
  ) {
    return null;
  }
  const bytes = encodeCanonicalJson(request.payload.snapshot).bytes;
  if (bytes.byteLength !== request.payload.transfer.declaredTotalBytes) {
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  }
  return Object.freeze({
    bytes,
    request: parseHostFactsRequest({
      protocolVersion: request.protocolVersion,
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      command: request.command,
      payload: { transfer: request.payload.transfer },
    }),
    stream: request.payload.transfer,
  });
}

function imageAssetUpload(
  input: NativeHostRequest,
  request: ReturnType<typeof createRequest>,
): Readonly<{
  bytes: Uint8Array;
  request: HostFactsRequest;
  stream: HostFactsPayloadByCommand['PUT_IMAGE_ASSET']['transfer'];
}> | null {
  if (request.command !== 'PUT_IMAGE_ASSET') return null;
  const bytes = input.uploadBytes;
  if (!(bytes instanceof Uint8Array)) throw new LocalDataContractError('INVALID_ARGUMENT');
  if (
    request.payload.transfer.operation !== 'image-asset' ||
    bytes.byteLength !== request.payload.transfer.declaredTotalBytes ||
    bytes.byteLength > MAX_IMAGE_ASSET_BYTES
  ) {
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  }
  return Object.freeze({ bytes, request, stream: request.payload.transfer });
}

function callNativeMessage(
  runtime: ResolvedNativeRuntime,
  request: ReturnType<typeof createRequest>,
): Promise<unknown> {
  const send = runtime.runtime.sendNativeMessage;
  if (!send) return Promise.reject(new LocalDataContractError('HOST_UNAVAILABLE'));
  if (runtime.style === 'promise') {
    try {
      const response = send(nativeHostContract.host.name, request);
      if (!response || typeof (response as PromiseLike<unknown>).then !== 'function') {
        return Promise.reject(new LocalDataContractError('HOST_UNAVAILABLE'));
      }
      return Promise.resolve(response);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    try {
      send(nativeHostContract.host.name, request, (response: unknown) => {
        if (runtime.runtime.lastError) {
          reject(runtime.runtime.lastError);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/** Calls one of the three intrinsically bounded Native Host commands. */
export async function sendNativeMessage<
  TData = unknown,
  TCommand extends NativeHostSingleMessageCommand = NativeHostSingleMessageCommand,
>(input: NativeHostRequest<TCommand>): Promise<TData> {
  if (!(NATIVE_HOST_SINGLE_MESSAGE_COMMANDS as readonly string[]).includes(input.command)) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
  const request = createRequest(input);
  try {
    const response = parseHostFactsResponse(
      await callNativeMessage(resolveRuntime(input.dependencies, 'sendNativeMessage'), request),
    );
    if (response.requestId !== request.requestId) throw new LocalDataContractError('PROTOCOL_MISMATCH');
    if (!response.ok) throw new LocalDataContractError(response.error.code, response.error.diagnostics);
    return response.data as TData;
  } catch (error) {
    throw runtimeError(error);
  }
}

/** Opens one Native Host port for one typed operation and releases it after its terminal frame. */
export async function connectNative<TData = unknown, TCommand extends HostFactsCommand = HostFactsCommand>(
  input: NativeHostRequest<TCommand>,
): Promise<TData> {
  if ((NATIVE_HOST_SINGLE_MESSAGE_COMMANDS as readonly string[]).includes(input.command)) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
  const request = createRequest(input);
  try {
    const runtime = resolveRuntime(input.dependencies, 'connectNative').runtime;
    const port = runtime.connectNative?.(nativeHostContract.host.name);
    if (!port) throw new LocalDataContractError('HOST_UNAVAILABLE');
    const upload = captureSnapshotUpload(request);
    if (upload) {
      return (await writeNativePortCaptureSnapshot({
        bytes: upload.bytes,
        digestProvider: input.dependencies?.digestProvider,
        port,
        request: upload.request,
        stream: upload.stream,
      })) as TData;
    }
    const imageUpload = imageAssetUpload(input, request);
    if (imageUpload) {
      return (await writeNativePortImageAsset({
        bytes: imageUpload.bytes,
        digestProvider: input.dependencies?.digestProvider,
        port,
        request: imageUpload.request,
        stream: imageUpload.stream,
      })) as TData;
    }
    if (request.command === 'GET_IMAGE_ASSET') {
      return (await readNativePortImageAsset({
        digestProvider: input.dependencies?.digestProvider,
        port,
        request,
      })) as TData;
    }
    return (await readNativePortJson({
      port,
      request,
      digestProvider: input.dependencies?.digestProvider,
    })) as TData;
  } catch (error) {
    throw runtimeError(error);
  }
}
