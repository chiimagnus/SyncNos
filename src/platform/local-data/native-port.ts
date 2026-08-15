import { browserDigestProvider } from './browser-digest';

import {
  LocalDataContractError,
  parseHostFactsResponse,
  parseNativeHostStreamResponseData,
  type HostFactsRequest,
} from '@services/local-data/contracts';
import type { DigestProvider } from '@services/local-data/digest';
import { NativeWireSessionReceiver, parseNativeWireFrame } from '@services/local-data/native-wire';

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

/**
 * Reads one Host JSON response from one Native Messaging port. The port is never reused:
 * any terminal, cancellation, malformed frame, or disconnect releases it immediately.
 */
export function readNativePortJson(
  input: Readonly<{
    digestProvider?: DigestProvider;
    port: NativeMessagingPort;
    request: HostFactsRequest;
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
    try {
      input.port.postMessage(input.request);
    } catch (error) {
      fail(error);
    }
  });
}
