import { describe, expect, it, vi } from 'vitest';

import { startCliNativeBridge } from '@services/cli/native-bridge';
import {
  COMMENTS_MESSAGE_TYPES,
  CORE_MESSAGE_TYPES,
  DATA_REVISION_MESSAGE_TYPES,
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  ITEM_MENTION_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
} from '@services/protocols/message-contracts';

function createPort() {
  const posted: any[] = [];
  let messageListener: ((message: unknown) => void) | null = null;
  let disconnectListener: (() => void) | null = null;
  const disconnect = vi.fn();
  return {
    posted,
    port: {
      postMessage(message: unknown) {
        posted.push(message);
      },
      disconnect,
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          messageListener = listener;
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListener = listener;
        },
      },
    },
    emitMessage(message: unknown) {
      messageListener?.(message);
    },
    emitDisconnect() {
      disconnectListener?.();
    },
    disconnect,
  };
}

function createHarness(
  status = { available: true, enabled: true, permissionGranted: true },
  routerOverride?: { dispatch: ReturnType<typeof vi.fn> },
) {
  const fakePort = createPort();
  let storageListener: ((changes: any, areaName: string) => void) | null = null;
  let permissionListener: ((change: any) => void) | null = null;
  const connectNativeHost = vi.fn(() => fakePort.port);
  const disableAfterPermissionRemoval = vi.fn(async () => {});
  const router =
    routerOverride ||
    ({
      dispatch: vi.fn(async () => ({ ok: true, data: { conversations: 4 }, error: null })),
    } as const);
  const controller = startCliNativeBridge(router, {
    connectNativeHost,
    readExtensionRuntimeMetadata: () => ({
      runtimeId: 'runtime-id',
      extensionVersion: '1.2.3',
      browserFamily: 'chromium',
    }),
    readCliIntegrationStatus: vi.fn(async () => status),
    getCliInstanceId: vi.fn(async () => 'instance-1'),
    disableCliIntegrationAfterPermissionRemoval: disableAfterPermissionRemoval,
    storageOnChanged(listener) {
      storageListener = listener;
      return () => {
        storageListener = null;
      };
    },
    permissionsOnRemoved(listener) {
      permissionListener = listener;
      return () => {
        permissionListener = null;
      };
    },
  });
  return {
    fakePort,
    router,
    controller,
    connectNativeHost,
    disableAfterPermissionRemoval,
    storage: (changes: any) => storageListener?.(changes, 'local'),
    removePermission: (permissions: string[]) => permissionListener?.({ permissions }),
  };
}

async function waitForPosted(harness: ReturnType<typeof createHarness>, count: number) {
  await vi.waitFor(() => expect(harness.fakePort.posted.length).toBeGreaterThanOrEqual(count));
}

describe('CLI Native Messaging bridge', () => {
  it('connects only after opt-in and sends a safe hello', async () => {
    const harness = createHarness();
    await waitForPosted(harness, 1);
    expect(harness.connectNativeHost).toHaveBeenCalledWith('app.syncnos.cli');
    expect(harness.fakePort.posted[0]).toEqual({
      kind: 'hello',
      protocolVersion: 1,
      cliInstanceId: 'instance-1',
      runtimeId: 'runtime-id',
      extensionVersion: '1.2.3',
      browserFamily: 'chromium',
    });
    harness.controller.stop();
  });

  it('maps revision.get to router.dispatch with a null sender and rejects non-public methods', async () => {
    const harness = createHarness();
    await waitForPosted(harness, 1);
    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'r1',
      method: 'revision.get',
      params: {},
    });
    await waitForPosted(harness, 2);
    expect(harness.router.dispatch).toHaveBeenCalledWith({ type: DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT }, null);
    expect(harness.fakePort.posted[1]).toMatchObject({
      kind: 'rpc-response',
      requestId: 'r1',
      ok: true,
      data: { conversations: 4 },
    });

    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'r2',
      method: 'openCurrentTabInpageCommentsPanel',
    });
    await waitForPosted(harness, 3);
    expect(harness.fakePort.posted[2]).toMatchObject({ ok: false, error: { code: 'rpc_method_not_found' } });
    expect(harness.router.dispatch).toHaveBeenCalledTimes(1);
    harness.controller.stop();
  });

  it('maps list/get/search/stats to canonical Background handlers and emits one response per request', async () => {
    const router = {
      dispatch: vi.fn(async (message: any) => {
        switch (message.type) {
          case CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP:
            return {
              ok: true,
              data: {
                items: [{ id: 10 }],
                cursor: { lastActivityAt: 123, id: 10 },
                hasMore: true,
                summary: { totalCount: 7, todayCount: 2, label: 'do-not-leak' },
                facets: {
                  sources: [{ key: 'chatgpt', count: 4, label: 'ChatGPT' }],
                  sites: [{ key: 'domain:example.com', count: 3, label: 'Example' }],
                },
              },
              error: null,
            };
          case CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE:
            return { ok: true, data: { items: [{ id: 9 }], cursor: null, hasMore: false }, error: null };
          case CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID:
            return {
              ok: true,
              data: message.conversationId === 404 ? null : { id: message.conversationId, title: 'Conversation' },
              error: null,
            };
          case CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL:
            return {
              ok: true,
              data: { conversationId: message.conversationId, messages: [{ messageKey: 'm1' }] },
              error: null,
            };
          case CORE_MESSAGE_TYPES.SEARCH_CONVERSATIONS:
            return {
              ok: true,
              data: [{ conversation: { id: 8 }, hit: { field: 'message', snippet: 'needle' } }],
              error: null,
            };
          default:
            return { ok: false, data: null, error: { message: 'unexpected', extra: null } };
        }
      }),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);

    const emit = async (requestId: string, method: string, params: Record<string, unknown>) => {
      const before = harness.fakePort.posted.length;
      harness.fakePort.emitMessage({ kind: 'rpc-request', protocolVersion: 1, requestId, method, params });
      await waitForPosted(harness, before + 1);
      expect(harness.fakePort.posted.length).toBe(before + 1);
      return harness.fakePort.posted[before];
    };

    const list = await emit('list-1', 'conversation.list', {
      sourceKey: 'web',
      siteKey: 'domain:example.com',
      limit: 10,
    });
    expect(list).toMatchObject({ ok: true, data: { items: [{ id: 10 }], hasMore: true } });
    expect(router.dispatch).toHaveBeenCalledWith(
      {
        type: CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP,
        query: { sourceKey: 'web', siteKey: 'domain:example.com' },
        limit: 10,
      },
      null,
    );

    const page = await emit('list-2', 'conversation.list', {
      sourceKey: 'all',
      siteKey: 'all',
      limit: 5,
      cursor: { lastActivityAt: 123, id: 10 },
    });
    expect(page).toMatchObject({ ok: true, data: { items: [{ id: 9 }], hasMore: false } });
    expect(router.dispatch).toHaveBeenCalledWith(
      {
        type: CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE,
        query: { sourceKey: 'all', siteKey: 'all' },
        cursor: { lastActivityAt: 123, id: 10 },
        limit: 5,
      },
      null,
    );

    const get = await emit('get-1', 'conversation.get', { conversationId: 10 });
    expect(get).toEqual({
      kind: 'rpc-response',
      protocolVersion: 1,
      requestId: 'get-1',
      ok: true,
      data: { conversation: { id: 10, title: 'Conversation' }, messages: [{ messageKey: 'm1' }] },
      error: null,
    });

    const missing = await emit('get-404', 'conversation.get', { conversationId: 404 });
    expect(missing).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const search = await emit('search-1', 'conversation.search', {
      query: 'needle',
      sourceKey: 'chatgpt',
      siteKey: 'all',
      after: 1,
      before: 100,
      limit: 20,
    });
    expect(search).toMatchObject({ ok: true, data: [{ conversation: { id: 8 }, hit: { field: 'message' } }] });
    expect(router.dispatch).toHaveBeenCalledWith(
      {
        type: CORE_MESSAGE_TYPES.SEARCH_CONVERSATIONS,
        query: 'needle',
        sourceKey: 'chatgpt',
        siteKey: 'all',
        after: 1,
        before: 100,
        limit: 20,
      },
      null,
    );

    const stats = await emit('stats-1', 'conversation.stats', {});
    expect(stats).toEqual({
      kind: 'rpc-response',
      protocolVersion: 1,
      requestId: 'stats-1',
      ok: true,
      data: {
        totalCount: 7,
        todayCount: 2,
        sources: [{ key: 'chatgpt', count: 4 }],
        sites: [{ key: 'domain:example.com', count: 3 }],
      },
      error: null,
    });
    expect(JSON.stringify(stats)).not.toContain('ChatGPT');
    expect(JSON.stringify(stats)).not.toContain('Example');
    expect(JSON.stringify(stats)).not.toContain('do-not-leak');
    harness.controller.stop();
  });

  it('maps conversation mutation RPCs to canonical handlers and preserves mutation error codes', async () => {
    const router = {
      dispatch: vi.fn(async (message: any) => {
        if (message.type === CORE_MESSAGE_TYPES.UPDATE_CONVERSATION_URL && message.url.includes('conflict')) {
          return {
            ok: true,
            data: { status: 'conflict', conflictConversationId: 9, changed: false },
            error: null,
          };
        }
        return { ok: true, data: { echoedType: message.type }, error: null };
      }),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    const emit = async (requestId: string, method: string, params: Record<string, unknown>) => {
      const before = harness.fakePort.posted.length;
      harness.fakePort.emitMessage({ kind: 'rpc-request', protocolVersion: 1, requestId, method, params });
      await waitForPosted(harness, before + 1);
      return harness.fakePort.posted[before];
    };

    expect(
      await emit('u1', 'conversation.update-url', {
        conversationId: 7,
        url: 'https://example.com/new',
        mergeExisting: true,
      }),
    ).toMatchObject({ ok: true });
    expect(router.dispatch).toHaveBeenCalledWith(
      {
        type: CORE_MESSAGE_TYPES.UPDATE_CONVERSATION_URL,
        conversationId: 7,
        url: 'https://example.com/new',
        mergeExisting: true,
      },
      null,
    );
    expect(
      await emit('u2', 'conversation.update-url', { conversationId: 7, url: 'https://example.com/conflict' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'url_conflict', extra: { conflictConversationId: 9 } },
    });
    await emit('m1', 'conversation.merge', { keepConversationId: 7, removeConversationId: 9 });
    expect(router.dispatch).toHaveBeenCalledWith(
      { type: CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS, keepConversationId: 7, removeConversationId: 9 },
      null,
    );
    await emit('d1', 'conversation.delete', { conversationIds: [7, 9] });
    expect(router.dispatch).toHaveBeenCalledWith(
      { type: CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, conversationIds: [7, 9] },
      null,
    );
    await emit('b1', 'conversation.images.backfill', { conversationId: 7, conversationUrl: 'https://example.com/new' });
    expect(router.dispatch).toHaveBeenCalledWith(
      {
        type: CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES,
        conversationId: 7,
        conversationUrl: 'https://example.com/new',
      },
      null,
    );
    harness.controller.stop();
  });

  it('maps capture.current-page only to the unified active-tab capture handler and exposes the stable result shape', async () => {
    const router = {
      dispatch: vi.fn(async () => ({
        ok: true,
        data: {
          kind: 'video',
          label: 'Video',
          collectorId: 'video:bilibili',
          conversationId: 77,
          isNew: true,
          title: 'Example',
          subtitleStatus: 'ok',
          url: 'https://example.com/should-not-leak',
          debugTranscript: 'should-not-leak',
        },
        error: null,
      })),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'capture-1',
      method: 'capture.current-page',
      params: {},
    });
    await waitForPosted(harness, 2);

    expect(router.dispatch).toHaveBeenCalledWith({ type: UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE }, null);
    expect(harness.fakePort.posted[1]).toEqual({
      kind: 'rpc-response',
      protocolVersion: 1,
      requestId: 'capture-1',
      ok: true,
      data: {
        kind: 'video',
        label: 'Video',
        collectorId: 'video:bilibili',
        conversationId: 77,
        isNew: true,
        title: 'Example',
        subtitleStatus: 'ok',
      },
      error: null,
    });
    harness.controller.stop();
  });

  it('resolves comment conversation identity without exposing locator input and reuses existing comment handlers', async () => {
    const router = {
      dispatch: vi.fn(async (message: any) => {
        if (message.type === CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID) {
          return {
            ok: true,
            data: { id: message.conversationId, sourceType: 'article', url: 'https://example.com/article#fragment' },
            error: null,
          };
        }
        return { ok: true, data: { type: message.type }, error: null };
      }),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    const emit = async (requestId: string, method: string, params: Record<string, unknown>) => {
      const before = harness.fakePort.posted.length;
      harness.fakePort.emitMessage({ kind: 'rpc-request', protocolVersion: 1, requestId, method, params });
      await waitForPosted(harness, before + 1);
      return harness.fakePort.posted[before];
    };

    await emit('c-list', 'comments.list', { conversationId: 7 });
    expect(router.dispatch).toHaveBeenLastCalledWith(
      { type: COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, conversationId: 7 },
      null,
    );
    expect(router.dispatch.mock.calls.at(-1)?.[0]).not.toHaveProperty('canonicalUrl');

    await emit('c-add', 'comments.add', {
      conversationId: 7,
      text: 'plain root',
      authorName: 'spoofed-cli-author',
    });
    const addMessage = router.dispatch.mock.calls.at(-1)?.[0];
    expect(addMessage).toEqual({
      type: COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT,
      conversationId: 7,
      canonicalUrl: 'https://example.com/article',
      quoteText: '',
      commentText: 'plain root',
      locator: null,
    });
    expect(addMessage).not.toHaveProperty('authorName');

    await emit('c-reply', 'comments.reply', { conversationId: 7, parentId: 3, text: 'plain reply' });
    const replyMessage = router.dispatch.mock.calls.at(-1)?.[0];
    expect(replyMessage).toEqual({
      type: COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT,
      conversationId: 7,
      canonicalUrl: 'https://example.com/article',
      quoteText: '',
      commentText: 'plain reply',
      locator: null,
      parentId: 3,
    });

    const callsBeforeDelete = router.dispatch.mock.calls.length;
    await emit('c-delete', 'comments.delete', { commentId: 9 });
    expect(router.dispatch.mock.calls.length).toBe(callsBeforeDelete + 1);
    expect(router.dispatch).toHaveBeenLastCalledWith(
      { type: COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, id: 9 },
      null,
    );
    harness.controller.stop();
  });

  it('preserves comment domain failures and rejects non-article or invalid comment input before mutation', async () => {
    const router = {
      dispatch: vi.fn(async (message: any) => {
        if (message.type === CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID) {
          if (message.conversationId === 8) {
            return { ok: true, data: { id: 8, sourceType: 'chat', url: 'https://example.com/chat' }, error: null };
          }
          if (message.conversationId === 9) {
            return { ok: true, data: { id: 9, sourceType: 'article', url: 'not-a-url' }, error: null };
          }
          return {
            ok: true,
            data: { id: message.conversationId, sourceType: 'article', url: 'https://example.com/article' },
            error: null,
          };
        }
        if (message.type === COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT && message.parentId === 3) {
          return { ok: false, data: null, error: { message: 'parent_not_root', extra: null } };
        }
        return { ok: true, data: {}, error: null };
      }),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    const emit = async (requestId: string, method: string, params: Record<string, unknown>) => {
      const before = harness.fakePort.posted.length;
      harness.fakePort.emitMessage({ kind: 'rpc-request', protocolVersion: 1, requestId, method, params });
      await waitForPosted(harness, before + 1);
      return harness.fakePort.posted[before];
    };

    expect(await emit('empty-comment', 'comments.add', { conversationId: 7, text: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' },
    });
    expect(router.dispatch).not.toHaveBeenCalled();

    expect(await emit('not-article', 'comments.add', { conversationId: 8, text: 'hello' })).toMatchObject({
      ok: false,
      error: { code: 'not_article_conversation' },
    });
    expect(await emit('bad-url', 'comments.add', { conversationId: 9, text: 'hello' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_conversation_url' },
    });
    expect(await emit('bad-parent', 'comments.reply', { conversationId: 7, parentId: 3, text: 'reply' })).toMatchObject(
      {
        ok: false,
        error: { code: 'parent_not_root' },
      },
    );
    harness.controller.stop();
  });

  it('maps empty/non-empty mention search and build to the existing bounded mention handlers', async () => {
    const router = {
      dispatch: vi.fn(async (message: any) => ({ ok: true, data: { type: message.type }, error: null })),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'mention-search',
      method: 'mention.search',
      params: { query: 'mcp', limit: 20 },
    });
    await waitForPosted(harness, 2);
    expect(router.dispatch).toHaveBeenCalledWith(
      { type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, query: 'mcp', limit: 20 },
      null,
    );

    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'mention-recent',
      method: 'mention.search',
      params: { query: '', limit: 10 },
    });
    await waitForPosted(harness, 3);
    expect(router.dispatch).toHaveBeenCalledWith(
      { type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, query: '', limit: 10 },
      null,
    );

    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'mention-build',
      method: 'mention.build-insert-text',
      params: { conversationId: 42 },
    });
    await waitForPosted(harness, 4);
    expect(router.dispatch).toHaveBeenCalledWith(
      { type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, conversationId: 42 },
      null,
    );
    harness.controller.stop();
  });

  it('maps provider-safe config/auth RPCs and generic sync RPCs without leaking OAuth state', async () => {
    const router = {
      dispatch: vi.fn(async (message: any) => {
        switch (message.type) {
          case NOTION_MESSAGE_TYPES.GET_AUTH_STATUS:
            return {
              ok: true,
              data: { connected: false, workspaceName: '', pending: true, errorPresent: false },
              error: null,
            };
          case NOTION_MESSAGE_TYPES.START_AUTH:
            return { ok: true, data: { state: 'raw-notion-oauth-state' }, error: null };
          case FEISHU_MESSAGE_TYPES.GET_AUTH_CONFIG:
            return {
              ok: true,
              data: { clientId: 'app-id', clientSecretPresent: true, tokenExchangeProxyUrl: '' },
              error: null,
            };
          case FEISHU_MESSAGE_TYPES.GET_PATH_CONFIG:
            return {
              ok: true,
              data: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
              error: null,
            };
          case FEISHU_MESSAGE_TYPES.START_AUTH:
            return { ok: true, data: { state: 'raw-feishu-oauth-state' }, error: null };
          case OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS:
            return {
              ok: true,
              data: {
                apiBaseUrl: 'http://127.0.0.1:27123',
                authHeaderName: 'Authorization',
                apiKeyPresent: true,
                apiKeyMasked: '********************************',
                chatFolder: 'Chats',
                articleFolder: 'Articles',
                videoFolder: 'Videos',
              },
              error: null,
            };
          case GITHUB_MESSAGE_TYPES.GET_SETTINGS:
            return {
              ok: true,
              data: {
                auth: { state: 'pending', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' },
                settings: { repository: 'owner/repo', branch: 'main' },
              },
              error: null,
            };
          case NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS:
            return { ok: true, data: { started: true, provider: 'notion', jobId: 'job-1' }, error: null };
          case NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS:
            return {
              ok: true,
              data: { provider: 'notion', active: true, job: { id: 'job-1', status: 'running' } },
              error: null,
            };
          default:
            return { ok: false, data: null, error: { message: 'unexpected message', extra: null } };
        }
      }),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    const emit = async (requestId: string, method: string, params: Record<string, unknown> = {}) => {
      const before = harness.fakePort.posted.length;
      harness.fakePort.emitMessage({ kind: 'rpc-request', protocolVersion: 1, requestId, method, params });
      await waitForPosted(harness, before + 1);
      expect(harness.fakePort.posted.length).toBe(before + 1);
      return harness.fakePort.posted[before];
    };

    expect(await emit('notion-status', 'notion.auth.status')).toMatchObject({
      ok: true,
      data: { connected: false, pending: true, errorPresent: false },
    });
    const notionStart = await emit('notion-start', 'notion.auth.start');
    expect(notionStart).toMatchObject({ ok: true, data: { started: true, browserOpened: true } });
    expect(JSON.stringify(notionStart)).not.toContain('raw-notion-oauth-state');

    const feishuConfig = await emit('feishu-config', 'feishu.config.get');
    expect(feishuConfig).toMatchObject({
      ok: true,
      data: {
        auth: { clientId: 'app-id', clientSecretPresent: true, tokenExchangeProxyUrl: '' },
        paths: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
      },
    });
    expect(JSON.stringify(feishuConfig)).not.toContain('clientSecret"');
    const feishuStart = await emit('feishu-start', 'feishu.auth.start');
    expect(JSON.stringify(feishuStart)).not.toContain('raw-feishu-oauth-state');

    const obsidianConfig = await emit('obsidian-config', 'obsidian.config.get');
    expect(obsidianConfig).toMatchObject({ ok: true, data: { apiKeyPresent: true } });
    expect(obsidianConfig.data).not.toHaveProperty('apiKey');

    expect(await emit('github-auth', 'github.auth.status')).toMatchObject({
      ok: true,
      data: { state: 'pending', userCode: 'ABCD-EFGH' },
    });

    expect(await emit('sync-start', 'sync.start', { provider: 'notion', conversationIds: [7, 9] })).toMatchObject({
      ok: true,
      data: { started: true, provider: 'notion', jobId: 'job-1' },
    });
    expect(router.dispatch).toHaveBeenCalledWith(
      { type: NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, conversationIds: [7, 9] },
      null,
    );
    expect(await emit('sync-status', 'sync.status', { provider: 'notion' })).toMatchObject({
      ok: true,
      data: { provider: 'notion', active: true, job: { id: 'job-1', status: 'running' } },
    });
    expect(await emit('sync-invalid', 'sync.status', { provider: 'dropbox' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' },
    });
    harness.controller.stop();
  });

  it('returns response_too_large for an oversized conversation.get and keeps the same Native Port usable', async () => {
    const oversizedBody = 'x'.repeat(64 * 1024 * 1024);
    const router = {
      dispatch: vi.fn(async (message: any) => {
        if (message.type === CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID) {
          return {
            ok: true,
            data: { id: 77, source: 'chatgpt', conversationKey: 'oversized', lastActivityAt: 1 },
            error: null,
          };
        }
        if (message.type === CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL) {
          return {
            ok: true,
            data: {
              conversationId: 77,
              messages: [{ messageKey: 'huge', role: 'assistant', contentMarkdown: oversizedBody, sequence: 1 }],
            },
            error: null,
          };
        }
        return { ok: false, data: null, error: { message: 'unexpected message', extra: null } };
      }),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);

    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'oversized-get',
      method: 'conversation.get',
      params: { conversationId: 77 },
    });
    await waitForPosted(harness, 2);
    expect(harness.fakePort.posted[1]).toMatchObject({
      kind: 'rpc-response',
      requestId: 'oversized-get',
      ok: false,
      error: { code: 'response_too_large' },
    });
    expect(harness.fakePort.disconnect).not.toHaveBeenCalled();

    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'after-oversized-get',
      method: 'system.ping',
      params: {},
    });
    await waitForPosted(harness, 3);
    expect(harness.fakePort.posted[2]).toMatchObject({
      kind: 'rpc-response',
      requestId: 'after-oversized-get',
      ok: true,
      data: { alive: true },
    });
    expect(harness.fakePort.disconnect).not.toHaveBeenCalled();
    harness.controller.stop();
  });

  it('maps Background INVALID_ARGUMENT to stable public invalid_argument', async () => {
    const router = {
      dispatch: vi.fn(async () => ({
        ok: false,
        data: null,
        error: { message: 'invalid query', extra: { code: 'INVALID_ARGUMENT', field: 'query' } },
      })),
    };
    const harness = createHarness(undefined, router as any);
    await waitForPosted(harness, 1);
    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'invalid-search',
      method: 'conversation.search',
      params: { query: '' },
    });
    await waitForPosted(harness, 2);
    expect(harness.fakePort.posted[1]).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', extra: { code: 'INVALID_ARGUMENT', field: 'query' } },
    });
    harness.controller.stop();
  });

  it('fails closed on protocol mismatch and duplicate request ids', async () => {
    const harness = createHarness();
    await waitForPosted(harness, 1);
    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 99,
      requestId: 'mismatch',
      method: 'system.ping',
    });
    await waitForPosted(harness, 2);
    expect(harness.fakePort.posted[1]).toMatchObject({ error: { code: 'protocol_mismatch' } });

    harness.fakePort.emitMessage({
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'mismatch',
      method: 'system.ping',
    });
    await waitForPosted(harness, 3);
    expect(harness.fakePort.posted[2]).toMatchObject({ error: { code: 'duplicate_request_id' } });
    harness.controller.stop();
  });

  it('scopes duplicate request ids to one Native Port lifecycle', async () => {
    const first = createPort();
    const second = createPort();
    let storageListener: ((changes: any, areaName: string) => void) | null = null;
    const connectNativeHost = vi.fn().mockReturnValueOnce(first.port).mockReturnValueOnce(second.port);
    const router = { dispatch: vi.fn(async () => ({ ok: true, data: {}, error: null })) };
    const controller = startCliNativeBridge(router, {
      connectNativeHost,
      readExtensionRuntimeMetadata: () => ({
        runtimeId: 'runtime-id',
        extensionVersion: '1.2.3',
        browserFamily: 'chromium',
      }),
      readCliIntegrationStatus: vi.fn(async () => ({ available: true, enabled: true, permissionGranted: true })),
      getCliInstanceId: vi.fn(async () => 'instance-1'),
      disableCliIntegrationAfterPermissionRemoval: vi.fn(async () => {}),
      storageOnChanged(listener) {
        storageListener = listener;
        return () => {
          storageListener = null;
        };
      },
      permissionsOnRemoved: () => () => {},
    });
    await vi.waitFor(() => expect(first.posted.length).toBeGreaterThanOrEqual(1));

    const request = {
      kind: 'rpc-request',
      protocolVersion: 1,
      requestId: 'reused-after-reconnect',
      method: 'system.ping',
    };
    first.emitMessage(request);
    await vi.waitFor(() => expect(first.posted.length).toBeGreaterThanOrEqual(2));
    expect(first.posted[1]).toMatchObject({ ok: true, requestId: request.requestId });
    first.emitMessage(request);
    await vi.waitFor(() => expect(first.posted.length).toBeGreaterThanOrEqual(3));
    expect(first.posted[2]).toMatchObject({ ok: false, error: { code: 'duplicate_request_id' } });

    first.emitDisconnect();
    storageListener?.({ syncnos_cli_integration_enabled_v1: { newValue: true } }, 'local');
    await vi.waitFor(() => expect(second.posted.length).toBeGreaterThanOrEqual(1));
    second.emitMessage(request);
    await vi.waitFor(() => expect(second.posted.length).toBeGreaterThanOrEqual(2));
    expect(second.posted[1]).toMatchObject({ ok: true, requestId: request.requestId });
    controller.stop();
  });

  it('converges enabled-without-permission to disabled without connecting', async () => {
    const harness = createHarness({ available: true, enabled: true, permissionGranted: false });
    await vi.waitFor(() => expect(harness.disableAfterPermissionRemoval).toHaveBeenCalledTimes(1));
    expect(harness.connectNativeHost).not.toHaveBeenCalled();
    harness.controller.stop();
  });

  it('disconnects on permission removal and does not auto-reconnect after port disconnect', async () => {
    const harness = createHarness();
    await waitForPosted(harness, 1);
    harness.removePermission(['nativeMessaging']);
    await vi.waitFor(() => expect(harness.disableAfterPermissionRemoval).toHaveBeenCalledTimes(1));
    expect(harness.fakePort.disconnect).toHaveBeenCalledTimes(1);

    const second = createHarness();
    await waitForPosted(second, 1);
    second.fakePort.emitDisconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.connectNativeHost).toHaveBeenCalledTimes(1);
    second.controller.stop();
    harness.controller.stop();
  });

  it('isolates a missing native host from the background router', async () => {
    const router = { dispatch: vi.fn() };
    const connectNativeHost = vi.fn(() => {
      throw new Error('host not found');
    });
    const controller = startCliNativeBridge(router, {
      connectNativeHost,
      readExtensionRuntimeMetadata: () => ({ runtimeId: '', extensionVersion: '', browserFamily: 'unknown' }),
      readCliIntegrationStatus: vi.fn(async () => ({ available: true, enabled: true, permissionGranted: true })),
      getCliInstanceId: vi.fn(async () => 'instance-1'),
      disableCliIntegrationAfterPermissionRemoval: vi.fn(async () => {}),
      storageOnChanged: () => () => {},
      permissionsOnRemoved: () => () => {},
    });
    await vi.waitFor(() => expect(connectNativeHost).toHaveBeenCalledTimes(1));
    expect(router.dispatch).not.toHaveBeenCalled();
    controller.stop();
  });
});
