import { describe, expect, it, vi } from 'vitest';

import { startCliNativeBridge } from '@services/cli/native-bridge';
import { CORE_MESSAGE_TYPES, DATA_REVISION_MESSAGE_TYPES } from '@services/protocols/message-contracts';

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
    expect(harness.fakePort.posted[1]).toMatchObject({ ok: false, error: { code: 'invalid_argument' } });
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
