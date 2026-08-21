import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeLocale: vi.fn(),
  createBackgroundServices: vi.fn(),
  registerConversationHandlers: vi.fn(),
  registerSyncHandlers: vi.fn(),
  registerWebArticleHandlers: vi.fn(),
  registerChatgptDeepResearchHandlers: vi.fn(),
  registerUiMessageHandlers: vi.fn(),
  registerArticleCommentsHandlers: vi.fn(),
  registerItemMentionHandlers: vi.fn(),
  registerChatWithBackgroundHandlers: vi.fn(),
  registerNotionSettingsHandlers: vi.fn(),
  registerObsidianSettingsHandlers: vi.fn(),
  registerFeishuSettingsHandlers: vi.fn(),
  setupNotionOAuthNavigationListener: vi.fn(),
  setupFeishuOAuthNavigationListener: vi.fn(),
  ensureDefaultNotionOAuthClientId: vi.fn(),
  ensureDefaultFeishuOAuthClientId: vi.fn(),
  ensureDefaultFeishuOAuthProxyUrl: vi.fn(),
  registerClipperContextMenu: vi.fn(),
  onInstalled: vi.fn(),
  onAlarm: vi.fn(),
  openOrFocusExtensionAppTab: vi.fn(),
  obsidianAbort: vi.fn(),
  feishuAbort: vi.fn(),
}));

vi.mock('@i18n', () => ({ initializeLocale: mocks.initializeLocale }));
vi.mock('@services/bootstrap/background-services.ts', () => ({
  createBackgroundServices: mocks.createBackgroundServices,
}));
vi.mock('@services/conversations/background/handlers', () => ({
  registerConversationHandlers: mocks.registerConversationHandlers,
}));
vi.mock('@services/sync/background-handlers', () => ({ registerSyncHandlers: mocks.registerSyncHandlers }));
vi.mock('@collectors/web/article-fetch-background-handlers', () => ({
  registerWebArticleHandlers: mocks.registerWebArticleHandlers,
}));
vi.mock('@collectors/chatgpt/chatgpt-deep-research-background-handlers', () => ({
  registerChatgptDeepResearchHandlers: mocks.registerChatgptDeepResearchHandlers,
}));
vi.mock('@platform/messaging/ui-background-handlers', () => ({
  registerUiMessageHandlers: mocks.registerUiMessageHandlers,
}));
vi.mock('@services/comments/background/handlers', () => ({
  registerArticleCommentsHandlers: mocks.registerArticleCommentsHandlers,
}));
vi.mock('@services/integrations/item-mention/background-handlers', () => ({
  registerItemMentionHandlers: mocks.registerItemMentionHandlers,
}));
vi.mock('@services/integrations/chatwith/chatwith-background-handlers', () => ({
  registerChatWithBackgroundHandlers: mocks.registerChatWithBackgroundHandlers,
}));
vi.mock('@services/sync/notion/settings-background-handlers', () => ({
  registerNotionSettingsHandlers: mocks.registerNotionSettingsHandlers,
}));
vi.mock('@services/sync/obsidian/settings-background-handlers', () => ({
  registerObsidianSettingsHandlers: mocks.registerObsidianSettingsHandlers,
}));
vi.mock('@services/sync/feishu/settings-background-handlers', () => ({
  registerFeishuSettingsHandlers: mocks.registerFeishuSettingsHandlers,
}));
vi.mock('@services/sync/notion/auth/oauth', () => ({
  ensureDefaultNotionOAuthClientId: mocks.ensureDefaultNotionOAuthClientId,
  setupNotionOAuthNavigationListener: mocks.setupNotionOAuthNavigationListener,
}));
vi.mock('@services/sync/feishu/auth/oauth', () => ({
  ensureDefaultFeishuOAuthClientId: mocks.ensureDefaultFeishuOAuthClientId,
  ensureDefaultFeishuOAuthProxyUrl: mocks.ensureDefaultFeishuOAuthProxyUrl,
  setupFeishuOAuthNavigationListener: mocks.setupFeishuOAuthNavigationListener,
}));
vi.mock('@services/sync/obsidian/obsidian-sync-job-store.ts', () => ({
  default: { abortRunningJobIfFromOtherInstance: mocks.obsidianAbort },
}));
vi.mock('@services/sync/feishu/feishu-sync-job-store.ts', () => ({
  default: { abortRunningJobIfFromOtherInstance: mocks.feishuAbort },
}));
vi.mock('@platform/runtime/runtime', () => ({ onInstalled: mocks.onInstalled }));
vi.mock('@platform/webext/extension-app', () => ({ openOrFocusExtensionAppTab: mocks.openOrFocusExtensionAppTab }));
vi.mock('@platform/context-menus/clipper-context-menu', () => ({
  registerClipperContextMenu: mocks.registerClipperContextMenu,
}));
vi.mock('@platform/alarms/alarms', () => ({ onAlarm: mocks.onAlarm }));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createServices() {
  return {
    autoSync: {
      onConversationChanged: vi.fn(),
      handleAlarm: vi.fn(),
      notionScheduler: { flush: vi.fn().mockResolvedValue(undefined) },
      obsidianScheduler: { flush: vi.fn().mockResolvedValue(undefined) },
      feishuScheduler: { flush: vi.fn().mockResolvedValue(undefined) },
    },
    notionSyncJobStore: { abortRunningJobIfFromOtherInstance: vi.fn().mockResolvedValue(undefined) },
    conversationKinds: {},
    notionSyncOrchestrator: {},
    obsidianSyncOrchestrator: { testConnection: vi.fn() },
    feishuSyncOrchestrator: {},
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function loadBackground() {
  let callback: (() => unknown) | null = null;
  vi.stubGlobal('defineBackground', (next: () => unknown) => {
    callback = next;
    return next;
  });
  await import('../../src/entrypoints/background.ts');
  if (!callback) throw new Error('background callback was not registered');
  return callback;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.ensureDefaultNotionOAuthClientId.mockResolvedValue(undefined);
  mocks.ensureDefaultFeishuOAuthClientId.mockResolvedValue(undefined);
  mocks.ensureDefaultFeishuOAuthProxyUrl.mockResolvedValue(undefined);
  mocks.obsidianAbort.mockResolvedValue(undefined);
  mocks.feishuAbort.mockResolvedValue(undefined);
  mocks.createBackgroundServices.mockReturnValue(createServices());
  // @ts-expect-error test global cleanup
  delete globalThis.browser;
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('background entrypoint cold start', () => {
  it('registers runtime and browser listeners before locale readiness settles', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);

    let runtimeMessageListener: ((msg: any, sender: any, sendResponse: any) => boolean) | null = null;
    const onMessageAddListener = vi.fn((listener: any) => {
      runtimeMessageListener = listener;
    });
    const onConnectAddListener = vi.fn();
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: onMessageAddListener },
        onConnect: { addListener: onConnectAddListener },
      },
    };

    const callback = await loadBackground();
    expect(callback()).toBeUndefined();

    expect(onMessageAddListener).toHaveBeenCalledTimes(1);
    expect(onConnectAddListener).toHaveBeenCalledTimes(1);
    expect(mocks.setupNotionOAuthNavigationListener).toHaveBeenCalledTimes(1);
    expect(mocks.setupFeishuOAuthNavigationListener).toHaveBeenCalledTimes(1);
    expect(mocks.registerClipperContextMenu).toHaveBeenCalledTimes(1);
    expect(mocks.onInstalled).toHaveBeenCalledTimes(1);
    expect(mocks.onAlarm).toHaveBeenCalledTimes(1);
    expect(mocks.registerUiMessageHandlers.mock.calls[0]?.[1]?.localeReady).toBe(locale.promise);
    expect(mocks.registerClipperContextMenu.mock.calls[0]?.[0]?.localeReady).toBe(locale.promise);

    const sendResponse = vi.fn();
    expect(runtimeMessageListener).not.toBeNull();
    expect(runtimeMessageListener?.({ type: 'cold-start-probe' }, null, sendResponse)).toBe(true);
    await flushMicrotasks();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      data: null,
      error: { message: 'unknown message type: cold-start-probe', extra: null },
    });
  });

  it('isolates optional listener registration failures from sibling listeners', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);
    mocks.setupNotionOAuthNavigationListener.mockImplementationOnce(() => {
      throw new Error('notion listener failed');
    });

    const onMessageAddListener = vi.fn();
    const onConnectAddListener = vi.fn();
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: onMessageAddListener },
        onConnect: { addListener: onConnectAddListener },
      },
    };

    const callback = await loadBackground();
    expect(() => callback()).not.toThrow();

    expect(onMessageAddListener).toHaveBeenCalledTimes(1);
    expect(mocks.setupFeishuOAuthNavigationListener).toHaveBeenCalledTimes(1);
    expect(mocks.registerClipperContextMenu).toHaveBeenCalledTimes(1);
    expect(mocks.onInstalled).toHaveBeenCalledTimes(1);
    expect(mocks.onAlarm).toHaveBeenCalledTimes(1);
  });
});
