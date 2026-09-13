import contract from '@services/protocols/cli-rpc-contract.json';
import { createExtensionFileTransferController } from '@services/cli/file-transfer';
import {
  importBackupBlob,
  prepareBackupExport,
  prepareJsonExport,
  prepareMarkdownExport,
} from '@services/cli/file-operations';
import {
  COMMENTS_MESSAGE_TYPES,
  CORE_MESSAGE_TYPES,
  DATA_REVISION_MESSAGE_TYPES,
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  ITEM_MENTION_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
  OPEN_TARGET_MESSAGE_TYPES,
  SETTINGS_MESSAGE_TYPES,
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
const SYNC_PROVIDER_MESSAGES = Object.freeze({
  notion: { start: NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, status: NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS },
  obsidian: { start: OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, status: OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS },
  feishu: { start: FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS, status: FEISHU_MESSAGE_TYPES.GET_SYNC_STATUS },
  github: { start: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS, status: GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS },
});

type SyncProviderName = keyof typeof SYNC_PROVIDER_MESSAGES;

function normalizeSyncProvider(value: unknown): SyncProviderName | null {
  const provider = String(value || '')
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(SYNC_PROVIDER_MESSAGES, provider) ? (provider as SyncProviderName) : null;
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function response(requestId: string, ok: boolean, data: unknown, code = '', message = '', extra: unknown = null) {
  return {
    kind: FRAMES.rpcResponse,
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok,
    data: ok ? data : null,
    error: ok ? null : { code, message, ...(extra == null ? null : { extra }) },
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
    if (!current) return;
    try {
      current.disconnect();
    } catch (_error) {
      // ignore
    }
  };

  const handleRpcRequest = async (
    currentPort: NativeMessagingPort,
    frame: any,
    seenRequestIds: Set<string>,
    fileTransfer: ReturnType<typeof createExtensionFileTransferController>,
  ) => {
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
        response(
          requestId,
          false,
          null,
          code,
          String(result?.error?.message || 'Background request failed'),
          result?.error?.extra ?? null,
        ),
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

    if (method === 'settings.schema') {
      postBackgroundResult(await router.dispatch({ type: SETTINGS_MESSAGE_TYPES.SCHEMA }, null));
      return;
    }
    if (method === 'settings.get') {
      postBackgroundResult(
        await router.dispatch(
          {
            type: SETTINGS_MESSAGE_TYPES.GET,
            ...(params.key == null ? {} : { key: params.key }),
          },
          null,
        ),
      );
      return;
    }
    if (method === 'settings.set') {
      postBackgroundResult(
        await router.dispatch({ type: SETTINGS_MESSAGE_TYPES.SET, key: params.key, value: params.value }, null),
      );
      return;
    }

    if (method === 'export.markdown' || method === 'export.json' || method === 'backup.export') {
      const prepared =
        method === 'export.markdown'
          ? await prepareMarkdownExport(params.conversationIds)
          : method === 'export.json'
            ? await prepareJsonExport(params.conversationIds)
            : await prepareBackupExport();
      const transfer = await fileTransfer.sendBlob(requestId, {
        blob: prepared.blob,
        suggestedFilename: prepared.suggestedFilename,
        metadata: prepared.metadata,
      });
      safePost(
        currentPort,
        response(requestId, true, {
          ...prepared.metadata,
          suggestedFilename: prepared.suggestedFilename,
          byteSize: transfer.byteSize,
          sha256: transfer.sha256,
        }),
      );
      return;
    }

    if (method === 'backup.import') {
      const received = await fileTransfer.receiveBlob(requestId);
      const stats = await importBackupBlob(received.blob);
      safePost(
        currentPort,
        response(requestId, true, {
          ...stats,
          byteSize: received.totalBytes,
          sha256: received.sha256,
        }),
      );
      return;
    }

    if (method === 'notion.auth.status') {
      postBackgroundResult(await router.dispatch({ type: NOTION_MESSAGE_TYPES.GET_AUTH_STATUS }, null));
      return;
    }
    if (method === 'notion.auth.start') {
      const result = await router.dispatch({ type: NOTION_MESSAGE_TYPES.START_AUTH }, null);
      postBackgroundResult(result, () => ({ started: true, browserOpened: true }));
      return;
    }
    if (method === 'notion.auth.disconnect') {
      postBackgroundResult(await router.dispatch({ type: NOTION_MESSAGE_TYPES.DISCONNECT }, null));
      return;
    }
    if (method === 'notion.pages.list') {
      postBackgroundResult(await router.dispatch({ type: NOTION_MESSAGE_TYPES.LIST_PARENT_PAGES }, null));
      return;
    }
    if (method === 'notion.config.get') {
      postBackgroundResult(await router.dispatch({ type: NOTION_MESSAGE_TYPES.GET_CONFIG }, null));
      return;
    }
    if (method === 'notion.config.set') {
      postBackgroundResult(
        await router.dispatch(
          {
            type: NOTION_MESSAGE_TYPES.SAVE_CONFIG,
            ...(Object.prototype.hasOwnProperty.call(params, 'parentPageId')
              ? { parentPageId: params.parentPageId }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(params, 'parentPageTitle')
              ? { parentPageTitle: params.parentPageTitle }
              : {}),
            ...(params.databaseIds && typeof params.databaseIds === 'object'
              ? { databaseIds: params.databaseIds }
              : {}),
          },
          null,
        ),
      );
      return;
    }
    if (method === 'notion.config.reset-database') {
      postBackgroundResult(
        await router.dispatch({ type: NOTION_MESSAGE_TYPES.RESET_DATABASE_ID, kindId: params.kindId }, null),
      );
      return;
    }

    if (method === 'feishu.auth.status') {
      postBackgroundResult(await router.dispatch({ type: FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS }, null));
      return;
    }
    if (method === 'feishu.auth.start') {
      const result = await router.dispatch({ type: FEISHU_MESSAGE_TYPES.START_AUTH }, null);
      postBackgroundResult(result, () => ({ started: true, browserOpened: true }));
      return;
    }
    if (method === 'feishu.auth.disconnect') {
      postBackgroundResult(await router.dispatch({ type: FEISHU_MESSAGE_TYPES.DISCONNECT }, null));
      return;
    }
    if (method === 'feishu.config.get') {
      const [auth, paths] = await Promise.all([
        router.dispatch({ type: FEISHU_MESSAGE_TYPES.GET_AUTH_CONFIG }, null),
        router.dispatch({ type: FEISHU_MESSAGE_TYPES.GET_PATH_CONFIG }, null),
      ]);
      if (auth?.ok !== true) {
        postBackgroundResult(auth);
        return;
      }
      postBackgroundResult(paths, (pathData) => ({ auth: auth.data, paths: pathData }));
      return;
    }
    if (method === 'feishu.config.set') {
      const authPayload: Record<string, unknown> = { type: FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG };
      for (const key of ['clientId', 'clientSecret', 'tokenExchangeProxyUrl'] as const) {
        if (Object.prototype.hasOwnProperty.call(params, key)) authPayload[key] = params[key];
      }
      const pathPayload: Record<string, unknown> = { type: FEISHU_MESSAGE_TYPES.SAVE_PATH_CONFIG };
      for (const key of ['chatFolder', 'articleFolder', 'videoFolder'] as const) {
        if (Object.prototype.hasOwnProperty.call(params, key)) pathPayload[key] = params[key];
      }
      if (Object.keys(authPayload).length > 1) {
        const authSave = await router.dispatch(authPayload, null);
        if (authSave?.ok !== true) {
          postBackgroundResult(authSave);
          return;
        }
      }
      if (Object.keys(pathPayload).length > 1) {
        const pathSave = await router.dispatch(pathPayload, null);
        if (pathSave?.ok !== true) {
          postBackgroundResult(pathSave);
          return;
        }
      }
      const [auth, paths] = await Promise.all([
        router.dispatch({ type: FEISHU_MESSAGE_TYPES.GET_AUTH_CONFIG }, null),
        router.dispatch({ type: FEISHU_MESSAGE_TYPES.GET_PATH_CONFIG }, null),
      ]);
      if (auth?.ok !== true) {
        postBackgroundResult(auth);
        return;
      }
      postBackgroundResult(paths, (pathData) => ({ auth: auth.data, paths: pathData }));
      return;
    }

    if (method === 'obsidian.config.get') {
      postBackgroundResult(await router.dispatch({ type: OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS }, null));
      return;
    }
    if (method === 'obsidian.config.set') {
      const message: Record<string, unknown> = { type: OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS };
      for (const key of [
        'apiBaseUrl',
        'apiKey',
        'authHeaderName',
        'chatFolder',
        'articleFolder',
        'videoFolder',
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(params, key)) message[key] = params[key];
      }
      postBackgroundResult(await router.dispatch(message, null));
      return;
    }
    if (method === 'obsidian.test') {
      postBackgroundResult(await router.dispatch({ type: OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION }, null));
      return;
    }

    if (method === 'github.auth.status') {
      const result = await router.dispatch({ type: GITHUB_MESSAGE_TYPES.GET_SETTINGS }, null);
      postBackgroundResult(result, (data) => data?.auth ?? { state: 'disconnected' });
      return;
    }
    if (method === 'github.auth.start') {
      postBackgroundResult(
        await router.dispatch({ type: GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW }, null),
        (data) => data?.auth,
      );
      return;
    }
    if (method === 'github.auth.poll') {
      postBackgroundResult(
        await router.dispatch({ type: GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW }, null),
        (data) => data?.auth,
      );
      return;
    }
    if (method === 'github.auth.cancel') {
      postBackgroundResult(
        await router.dispatch({ type: GITHUB_MESSAGE_TYPES.CANCEL_DEVICE_FLOW }, null),
        (data) => data?.auth,
      );
      return;
    }
    if (method === 'github.auth.disconnect') {
      postBackgroundResult(await router.dispatch({ type: GITHUB_MESSAGE_TYPES.DISCONNECT }, null));
      return;
    }
    if (method === 'github.repos.list') {
      postBackgroundResult(await router.dispatch({ type: GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES }, null));
      return;
    }
    if (method === 'github.config.get') {
      const result = await router.dispatch({ type: GITHUB_MESSAGE_TYPES.GET_SETTINGS }, null);
      postBackgroundResult(result, (data) => data?.settings ?? {});
      return;
    }
    if (method === 'github.config.set') {
      const message: Record<string, unknown> = { type: GITHUB_MESSAGE_TYPES.SAVE_SETTINGS };
      if (Object.prototype.hasOwnProperty.call(params, 'repository')) message.repository = params.repository;
      if (Object.prototype.hasOwnProperty.call(params, 'branch')) message.branch = params.branch;
      postBackgroundResult(await router.dispatch(message, null), (data) => data?.settings ?? {});
      return;
    }
    if (method === 'github.test') {
      postBackgroundResult(await router.dispatch({ type: GITHUB_MESSAGE_TYPES.TEST_CONNECTION }, null));
      return;
    }
    if (method === 'github.init') {
      postBackgroundResult(await router.dispatch({ type: GITHUB_MESSAGE_TYPES.INITIALIZE_REPOSITORY }, null));
      return;
    }

    if (method === 'sync.start' || method === 'sync.status') {
      const provider = normalizeSyncProvider(params.provider);
      if (!provider) {
        safePost(currentPort, response(requestId, false, null, 'invalid_argument', 'Unknown sync provider'));
        return;
      }
      const messages = SYNC_PROVIDER_MESSAGES[provider];
      const result = await router.dispatch(
        method === 'sync.start'
          ? {
              type: messages.start,
              conversationIds: Array.isArray(params.conversationIds) ? params.conversationIds.map(Number) : [],
            }
          : { type: messages.status },
        null,
      );
      postBackgroundResult(result);
      return;
    }

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
          url: String(params.url || ''),
          mergeExisting: params.mergeExisting === true,
        },
        null,
      );
      if (result?.ok === true && result?.data?.status === 'conflict') {
        const conflictConversationId = Number(result.data.conflictConversationId);
        safePost(
          currentPort,
          response(
            requestId,
            false,
            null,
            'url_conflict',
            'URL already belongs to another conversation',
            Number.isSafeInteger(conflictConversationId) && conflictConversationId > 0
              ? { conflictConversationId }
              : null,
          ),
        );
        return;
      }
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

    if (method === 'open.resolve') {
      const result = await router.dispatch(
        {
          type: OPEN_TARGET_MESSAGE_TYPES.RESOLVE,
          conversationId: Number(params.conversationId),
          ...(params.target == null ? null : { target: params.target }),
        },
        null,
      );
      postBackgroundResult(result);
      return;
    }

    if (method === 'open.launch') {
      const result = await router.dispatch(
        {
          type: OPEN_TARGET_MESSAGE_TYPES.LAUNCH,
          conversationId: Number(params.conversationId),
          target: params.target,
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
    const fileTransfer = createExtensionFileTransferController({
      frames: FRAMES,
      protocolVersion: PROTOCOL_VERSION,
      chunkBytes: contract.fileTransfer.chunkBytes,
      ackTimeoutMs: contract.fileTransfer.ackTimeoutMs,
      postFrame: (frame) => safePost(nextPort, frame),
    });
    const onMessage = (message: unknown) => {
      if (stopped || port !== nextPort) return;
      const frame = message as any;
      if (frame?.kind !== FRAMES.rpcRequest) {
        void fileTransfer.handleFrame(frame).catch(() => disconnectCurrentPort());
        return;
      }
      void handleRpcRequest(nextPort, frame, seenRequestIds, fileTransfer).catch((error) => {
        const requestId = validRequestId(frame?.requestId) ? frame.requestId : '';
        const code = String(error?.code || 'rpc_internal_error').trim() || 'rpc_internal_error';
        try {
          safePost(
            nextPort,
            response(
              requestId,
              false,
              null,
              code,
              String(error?.message || error || 'RPC failed'),
              error?.extra ?? null,
            ),
          );
        } catch (_postError) {
          disconnectCurrentPort();
        }
      });
    };
    const onDisconnect = () => {
      fileTransfer.abortAll(new Error('native_host_disconnected'));
      if (port === nextPort) {
        port = null;
        connectGeneration += 1;
      }
    };

    nextPort.onMessage.addListener(onMessage);
    nextPort.onDisconnect.addListener(onDisconnect);

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
        nextPort.disconnect();
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
