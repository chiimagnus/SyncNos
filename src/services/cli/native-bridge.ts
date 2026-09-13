import contract from '@services/protocols/cli-rpc-contract.json';
import {
  COMMENTS_MESSAGE_TYPES,
  CORE_MESSAGE_TYPES,
  DATA_REVISION_MESSAGE_TYPES,
  ITEM_MENTION_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
} from '@services/protocols/message-contracts';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
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
const COMMENT_INVARIANT_CODES = new Set([
  'parent_not_found',
  'parent_not_root',
  'parent_context_mismatch',
  'conversation_not_found',
]);

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

function toCliCaptureResult(data: any) {
  const result: Record<string, unknown> = {
    kind: data?.kind,
    label: data?.label,
    collectorId: data?.collectorId ?? null,
    conversationId: data?.conversationId ?? null,
    isNew: data?.isNew === true,
  };
  if (typeof data?.title === 'string' && data.title) result.title = data.title;
  if (data?.kind === 'chat') {
    if (data?.captureCompleteness === 'complete' || data?.captureCompleteness === 'partial') {
      result.captureCompleteness = data.captureCompleteness;
    }
    if (Array.isArray(data?.captureReasons)) result.captureReasons = data.captureReasons.map(String);
  } else if (data?.kind === 'video' && (data?.subtitleStatus === 'ok' || data?.subtitleStatus === 'empty')) {
    result.subtitleStatus = data.subtitleStatus;
  }
  return result;
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

    const postBackgroundResult = (result: any, transform: (data: any) => unknown = (data) => data) => {
      if (result?.ok === true) {
        safePost(currentPort, response(requestId, true, transform(result.data)));
        return true;
      }
      const extraCode = String(result?.error?.extra?.code || '').trim();
      const code = extraCode === 'INVALID_ARGUMENT' ? 'invalid_argument' : extraCode || 'background_request_failed';
      safePost(
        currentPort,
        response(requestId, false, null, code, String(result?.error?.message || 'Background request failed')),
      );
      return false;
    };
    const postCommentResult = (result: any) => {
      const invariantCode = String(result?.error?.message || '').trim();
      if (result?.ok !== true && COMMENT_INVARIANT_CODES.has(invariantCode)) {
        safePost(currentPort, response(requestId, false, null, invariantCode, invariantCode));
        return false;
      }
      return postBackgroundResult(result);
    };

    if (method === 'revision.get') {
      const result = await router.dispatch({ type: DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT }, null);
      postBackgroundResult(result);
      return;
    }

    const params = frame?.params && typeof frame.params === 'object' ? frame.params : {};

    if (method === 'conversation.list') {
      const cursor = params.cursor && typeof params.cursor === 'object' ? params.cursor : null;
      const result = await router.dispatch(
        cursor
          ? {
              type: CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE,
              query: { sourceKey: params.sourceKey, siteKey: params.siteKey },
              cursor,
              limit: params.limit,
            }
          : {
              type: CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP,
              query: { sourceKey: params.sourceKey, siteKey: params.siteKey },
              limit: params.limit,
            },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'conversation.get') {
      const conversationId = Number(params.conversationId);
      const conversationResult = await router.dispatch(
        { type: CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID, conversationId },
        null,
      );
      if (conversationResult?.ok !== true) {
        postBackgroundResult(conversationResult);
        return;
      }
      const conversation = conversationResult.data;
      if (!conversation) {
        safePost(currentPort, response(requestId, false, null, 'not_found', 'Conversation not found'));
        return;
      }
      const detailResult = await router.dispatch(
        { type: CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, conversationId },
        null,
      );
      postBackgroundResult(detailResult, (detail) => ({
        conversation,
        messages: Array.isArray(detail?.messages) ? detail.messages : [],
      }));
      return;
    }

    if (method === 'conversation.search') {
      const result = await router.dispatch(
        {
          type: CORE_MESSAGE_TYPES.SEARCH_CONVERSATIONS,
          query: params.query,
          sourceKey: params.sourceKey,
          siteKey: params.siteKey,
          after: params.after,
          before: params.before,
          limit: params.limit,
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'conversation.update-url') {
      const result = await router.dispatch(
        {
          type: CORE_MESSAGE_TYPES.UPDATE_CONVERSATION_URL,
          conversationId: Number(params.conversationId),
          url: params.url,
          mergeExisting: params.mergeExisting === true,
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'conversation.merge') {
      const result = await router.dispatch(
        {
          type: CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS,
          keepConversationId: Number(params.keepConversationId),
          removeConversationId: Number(params.removeConversationId),
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'conversation.delete') {
      const ids = Array.isArray(params.conversationIds)
        ? params.conversationIds.map((value: unknown) => Number(value))
        : [];
      const result = await router.dispatch(
        { type: CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, conversationIds: ids },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'conversation.images.backfill') {
      const result = await router.dispatch(
        {
          type: CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES,
          conversationId: Number(params.conversationId),
          conversationUrl: String(params.conversationUrl || ''),
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    const resolveArticleConversation = async (conversationIdValue: unknown) => {
      const conversationId = Number(conversationIdValue);
      const result = await router.dispatch({ type: CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID, conversationId }, null);
      if (result?.ok !== true) {
        postBackgroundResult(result);
        return null;
      }
      if (!result.data) {
        safePost(currentPort, response(requestId, false, null, 'not_found', 'Conversation not found'));
        return null;
      }
      if (
        String(result.data?.sourceType || '')
          .trim()
          .toLowerCase() !== 'article'
      ) {
        safePost(
          currentPort,
          response(requestId, false, null, 'not_article_conversation', 'Conversation is not an article'),
        );
        return null;
      }
      return result.data;
    };

    if (method === 'comments.list') {
      const conversation = await resolveArticleConversation(params.conversationId);
      if (!conversation) return;
      const result = await router.dispatch(
        {
          type: COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS,
          conversationId: Number(conversation.id),
        },
        null,
      );
      postCommentResult(result);
      return;
    }

    if (method === 'comments.add' || method === 'comments.reply') {
      const text = String(params.text || '').trim();
      if (!text) {
        safePost(currentPort, response(requestId, false, null, 'invalid_argument', 'Comment text is required'));
        return;
      }
      const conversation = await resolveArticleConversation(params.conversationId);
      if (!conversation) return;
      const canonicalUrl = canonicalizeArticleUrl(conversation.url);
      if (!canonicalUrl) {
        safePost(
          currentPort,
          response(requestId, false, null, 'invalid_conversation_url', 'Conversation has no canonical URL'),
        );
        return;
      }
      const result = await router.dispatch(
        {
          type: COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT,
          conversationId: Number(conversation.id),
          canonicalUrl,
          quoteText: '',
          commentText: text,
          locator: null,
          ...(method === 'comments.reply' ? { parentId: Number(params.parentId) } : null),
        },
        null,
      );
      postCommentResult(result);
      return;
    }

    if (method === 'comments.delete') {
      const result = await router.dispatch(
        {
          type: COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT,
          id: Number(params.commentId),
        },
        null,
      );
      postCommentResult(result);
      return;
    }

    if (method === 'mention.search') {
      const result = await router.dispatch(
        {
          type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES,
          query: String(params.query || ''),
          limit: params.limit,
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'mention.build-insert-text') {
      const result = await router.dispatch(
        {
          type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
          conversationId: Number(params.conversationId),
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'capture.current-page') {
      const result = await router.dispatch({ type: UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE }, null);
      postBackgroundResult(result, toCliCaptureResult);
      return;
    }

    if (method === 'conversation.stats') {
      const result = await router.dispatch(
        {
          type: CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP,
          query: { sourceKey: 'all', siteKey: 'all' },
          limit: 1,
        },
        null,
      );
      postBackgroundResult(result, (data) => ({
        totalCount: Number(data?.summary?.totalCount) || 0,
        todayCount: Number(data?.summary?.todayCount) || 0,
        sources: Array.isArray(data?.facets?.sources)
          ? data.facets.sources.map((item: any) => ({ key: String(item?.key || ''), count: Number(item?.count) || 0 }))
          : [],
        sites: Array.isArray(data?.facets?.sites)
          ? data.facets.sites.map((item: any) => ({ key: String(item?.key || ''), count: Number(item?.count) || 0 }))
          : [],
      }));
      return;
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
