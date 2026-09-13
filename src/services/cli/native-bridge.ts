import contract from '@services/protocols/cli-rpc-contract.json';
import { DATA_REVISION_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import {
  CLI_INTEGRATION_ENABLED_STORAGE_KEY,
  NATIVE_MESSAGING_PERMISSION,
  disableCliIntegrationAfterPermissionRemoval,
  getCliInstanceId,
  readCliIntegrationStatus,
} from '@services/cli/cli-integration';
import { storageOnChanged } from '@services/shared/storage';
import { permissionsOnRemoved } from '@platform/webext/permissions';
import {
  connectNativeHost,
  readExtensionRuntimeMetadata,
  type NativeMessagingPort,
} from '@platform/native-messaging/native-port';

type Router = {
  dispatch: (message: any, sender?: any) => Promise<any>;
};

type BridgeDeps = {
  connectNativeHost: typeof connectNativeHost;
  readExtensionRuntimeMetadata: typeof readExtensionRuntimeMetadata;
  readCliIntegrationStatus: typeof readCliIntegrationStatus;
  getCliInstanceId: typeof getCliInstanceId;
  disableCliIntegrationAfterPermissionRemoval: typeof disableCliIntegrationAfterPermissionRemoval;
  storageOnChanged: typeof storageOnChanged;
  permissionsOnRemoved: typeof permissionsOnRemoved;
};

const DEFAULT_DEPS: BridgeDeps = {
  connectNativeHost,
  readExtensionRuntimeMetadata,
  readCliIntegrationStatus,
  getCliInstanceId,
  disableCliIntegrationAfterPermissionRemoval,
  storageOnChanged,
  permissionsOnRemoved,
};

const PROTOCOL_VERSION = contract.protocolVersion;
const FRAMES = contract.frames;
const NATIVE_HOST_NAME = contract.nativeHostName;
const HOST_TO_EXTENSION_MAX_BYTES = contract.nativeMessaging.hostToExtensionMaxBytes;
const EXTENSION_TO_HOST_MAX_BYTES = contract.nativeMessaging.extensionToHostMaxBytes;
const PUBLIC_METHODS = new Set<string>(contract.publicMethods);

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function response(requestId: string, ok: boolean, data: unknown, code = '', message = '') {
  return {
    kind: FRAMES.rpcResponse,
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok,
    data: ok ? data : null,
    error: ok ? null : { code, message },
  };
}

function safePost(port: NativeMessagingPort, frame: unknown): void {
  if (serializedByteLength(frame) > EXTENSION_TO_HOST_MAX_BYTES) {
    const requestId = validRequestId((frame as any)?.requestId) ? String((frame as any).requestId) : '';
    const compact = response(
      requestId,
      false,
      null,
      'response_too_large',
      'Native Messaging response exceeds platform limit',
    );
    if (serializedByteLength(compact) > EXTENSION_TO_HOST_MAX_BYTES) throw new Error('response_too_large');
    port.postMessage(compact);
    return;
  }
  port.postMessage(frame);
}

export function startCliNativeBridge(router: Router, deps: BridgeDeps = DEFAULT_DEPS): { stop: () => void } {
  let stopped = false;
  let port: NativeMessagingPort | null = null;
  let connectGeneration = 0;

  const disconnectCurrentPort = () => {
    const current = port;
    port = null;
    connectGeneration += 1;
    try {
      current?.disconnect?.();
    } catch (_error) {
      // ignore
    }
  };

  const handleRpcRequest = async (currentPort: NativeMessagingPort, frame: any, seenRequestIds: Set<string>) => {
    if (serializedByteLength(frame) > HOST_TO_EXTENSION_MAX_BYTES) {
      safePost(
        currentPort,
        response('', false, null, 'request_too_large', 'Native Messaging request exceeds platform limit'),
      );
      return;
    }

    const requestId = frame?.requestId;
    if (!validRequestId(requestId)) {
      safePost(currentPort, response('', false, null, 'invalid_request_id', 'Invalid request id'));
      return;
    }
    if (seenRequestIds.has(requestId)) {
      safePost(currentPort, response(requestId, false, null, 'duplicate_request_id', 'Duplicate request id'));
      return;
    }
    seenRequestIds.add(requestId);

    if (Number(frame?.protocolVersion) !== PROTOCOL_VERSION) {
      safePost(currentPort, response(requestId, false, null, 'protocol_mismatch', 'CLI protocol version mismatch'));
      return;
    }

    const method = String(frame?.method || '');
    if (!PUBLIC_METHODS.has(method)) {
      safePost(currentPort, response(requestId, false, null, 'rpc_method_not_found', 'RPC method is not public'));
      return;
    }

    if (method === 'system.ping') {
      const [cliInstanceId, metadata] = await Promise.all([
        deps.getCliInstanceId(),
        Promise.resolve(deps.readExtensionRuntimeMetadata()),
      ]);
      safePost(
        currentPort,
        response(requestId, true, {
          alive: true,
          cliInstanceId,
          protocolVersion: PROTOCOL_VERSION,
          ...metadata,
        }),
      );
      return;
    }

    if (method === 'revision.get') {
      const result = await router.dispatch({ type: DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT }, null);
      if (result?.ok === true) {
        safePost(currentPort, response(requestId, true, result.data));
      } else {
        safePost(
          currentPort,
          response(
            requestId,
            false,
            null,
            'background_request_failed',
            String(result?.error?.message || 'Background request failed'),
          ),
        );
      }
    }
  };

  const attachPort = async (nextPort: NativeMessagingPort, generation: number) => {
    const seenRequestIds = new Set<string>();
    const onMessage = (message: unknown) => {
      if (stopped || port !== nextPort) return;
      const frame = message as any;
      if (frame?.kind !== FRAMES.rpcRequest) return;
      void handleRpcRequest(nextPort, frame, seenRequestIds).catch((error) => {
        const requestId = validRequestId(frame?.requestId) ? frame.requestId : '';
        try {
          safePost(
            nextPort,
            response(requestId, false, null, 'rpc_internal_error', String(error?.message || error || 'RPC failed')),
          );
        } catch (_postError) {
          disconnectCurrentPort();
        }
      });
    };
    const onDisconnect = () => {
      if (port === nextPort) {
        port = null;
        connectGeneration += 1;
      }
    };

    nextPort.onMessage?.addListener?.(onMessage);
    nextPort.onDisconnect?.addListener?.(onDisconnect);

    const [cliInstanceId, metadata] = await Promise.all([
      deps.getCliInstanceId(),
      Promise.resolve(deps.readExtensionRuntimeMetadata()),
    ]);
    if (stopped || port !== nextPort || generation !== connectGeneration) return;
    safePost(nextPort, {
      kind: FRAMES.hello,
      protocolVersion: PROTOCOL_VERSION,
      cliInstanceId,
      ...metadata,
    });
  };

  const reconcile = async () => {
    if (stopped || port) return;
    const generation = connectGeneration;
    const status = await deps.readCliIntegrationStatus();
    if (stopped || generation !== connectGeneration) return;
    if (!status.enabled) return;
    if (!status.permissionGranted) {
      await deps.disableCliIntegrationAfterPermissionRemoval().catch(() => {});
      return;
    }

    let nextPort: NativeMessagingPort;
    try {
      nextPort = deps.connectNativeHost(NATIVE_HOST_NAME);
    } catch (_error) {
      return;
    }
    if (stopped || generation !== connectGeneration) {
      try {
        nextPort.disconnect?.();
      } catch (_error) {
        // ignore
      }
      return;
    }
    port = nextPort;
    void attachPort(nextPort, generation).catch(() => disconnectCurrentPort());
  };

  const removeStorageListener = deps.storageOnChanged((changes, areaName) => {
    if (stopped || areaName !== 'local' || !changes || typeof changes !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(changes, CLI_INTEGRATION_ENABLED_STORAGE_KEY)) return;
    const enabled = changes[CLI_INTEGRATION_ENABLED_STORAGE_KEY]?.newValue === true;
    if (!enabled) {
      disconnectCurrentPort();
      return;
    }
    void reconcile().catch(() => {});
  });

  const removePermissionListener = deps.permissionsOnRemoved((change) => {
    if (stopped || !Array.isArray(change?.permissions) || !change.permissions.includes(NATIVE_MESSAGING_PERMISSION))
      return;
    disconnectCurrentPort();
    void deps.disableCliIntegrationAfterPermissionRemoval().catch(() => {});
  });

  void reconcile().catch(() => {});

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      removeStorageListener();
      removePermissionListener();
      disconnectCurrentPort();
    },
  };
}
