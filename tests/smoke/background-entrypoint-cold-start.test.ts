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
  registerNotionSettingsHandlers: vi.fn(),
  registerObsidianSettingsHandlers: vi.fn(),
  registerFeishuSettingsHandlers: vi.fn(),
  registerGithubSettingsHandlers: vi.fn(),
  registerPublicSettingsHandlers: vi.fn(),
  registerOpenTargetHandlers: vi.fn(),
  setupNotionOAuthNavigationListener: vi.fn(),
  setupFeishuOAuthNavigationListener: vi.fn(),
  ensureDefaultFeishuOAuthConfig: vi.fn(),
  registerClipperContextMenu: vi.fn(),
  onInstalled: vi.fn(),
  onAlarm: vi.fn(),
  storageOnChanged: vi.fn(),
  openOrFocusExtensionAppTab: vi.fn(),
  reconcileStartupSyncJob: vi.fn(),
  ensureDisplayMode: vi.fn(),
  readDisplayMode: vi.fn(),
  setDisplayMode: vi.fn(),
  startCliNativeBridge: vi.fn(),
  readBackgroundRecoveryProbe: vi.fn(),
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
vi.mock('@services/sync/notion/settings-background-handlers', () => ({
  registerNotionSettingsHandlers: mocks.registerNotionSettingsHandlers,
}));
vi.mock('@services/sync/obsidian/settings-background-handlers', () => ({
  registerObsidianSettingsHandlers: mocks.registerObsidianSettingsHandlers,
}));
vi.mock('@services/sync/feishu/settings-background-handlers', () => ({
  registerFeishuSettingsHandlers: mocks.registerFeishuSettingsHandlers,
}));
vi.mock('@services/sync/github/settings-background-handlers', () => ({
  registerGithubSettingsHandlers: mocks.registerGithubSettingsHandlers,
}));
vi.mock('@services/settings/background-handlers', () => ({
  registerPublicSettingsHandlers: mocks.registerPublicSettingsHandlers,
}));
vi.mock('@services/integrations/openin/background-handlers', () => ({
  registerOpenTargetHandlers: mocks.registerOpenTargetHandlers,
}));
vi.mock('@services/sync/notion/auth/oauth', () => ({
  setupNotionOAuthNavigationListener: mocks.setupNotionOAuthNavigationListener,
}));
vi.mock('@services/sync/feishu/auth/oauth', () => ({
  ensureDefaultFeishuOAuthConfig: mocks.ensureDefaultFeishuOAuthConfig,
  setupFeishuOAuthNavigationListener: mocks.setupFeishuOAuthNavigationListener,
}));
vi.mock('@platform/runtime/runtime', () => ({ onInstalled: mocks.onInstalled }));
vi.mock('@platform/webext/extension-app', () => ({ openOrFocusExtensionAppTab: mocks.openOrFocusExtensionAppTab }));
vi.mock('@platform/context-menus/clipper-context-menu', () => ({
  registerClipperContextMenu: mocks.registerClipperContextMenu,
}));
vi.mock('@platform/alarms/alarms', () => ({ onAlarm: mocks.onAlarm }));
vi.mock('@platform/storage/local', () => ({ storageOnChanged: mocks.storageOnChanged }));
vi.mock('@services/shared/inpage-display-mode', () => ({
  ensureCanonicalInpageDisplayMode: mocks.ensureDisplayMode,
  readEffectiveInpageDisplayMode: mocks.readDisplayMode,
  setCanonicalInpageDisplayMode: mocks.setDisplayMode,
}));
vi.mock('@services/cli/native-bridge', () => ({ startCliNativeBridge: mocks.startCliNativeBridge }));
vi.mock('@services/bootstrap/background-recovery-probe', () => ({
  readBackgroundRecoveryProbe: mocks.readBackgroundRecoveryProbe,
}));

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
      githubScheduler: {
        flush: vi.fn().mockResolvedValue(undefined),
        flushCleanup: vi.fn().mockResolvedValue(undefined),
        scheduleCleanup: vi.fn().mockResolvedValue(undefined),
      },
      imageBackfillScheduler: { flush: vi.fn().mockResolvedValue(undefined) },
      onRemoteCleanupPending: vi.fn().mockResolvedValue(undefined),
    },
    conversationKinds: {},
    notionSyncOrchestrator: {
      runExclusiveMaintenance: vi.fn(),
      isRunActive: vi.fn(() => false),
      reconcileStartupSyncJob: () => mocks.reconcileStartupSyncJob('notion'),
    },
    obsidianSyncOrchestrator: {
      testConnection: vi.fn(),
      runExclusiveMaintenance: vi.fn(),
      isRunActive: vi.fn(() => false),
      reconcileStartupSyncJob: () => mocks.reconcileStartupSyncJob('obsidian'),
    },
    feishuSyncOrchestrator: {
      runExclusiveMaintenance: vi.fn(),
      isRunActive: vi.fn(() => false),
      reconcileStartupSyncJob: () => mocks.reconcileStartupSyncJob('feishu'),
    },
    githubSyncOrchestrator: {
      runExclusiveMaintenance: vi.fn(),
      isRunActive: vi.fn(() => false),
      reconcileStartupSyncJob: () => mocks.reconcileStartupSyncJob('github'),
    },
  };
}

function idleRecoveryProbe() {
  return {
    providers: {
      notion: { runningJob: null, hasQueuedWork: false },
      obsidian: { runningJob: null, hasQueuedWork: false },
      feishu: { runningJob: null, hasQueuedWork: false },
      github: { runningJob: null, hasQueuedWork: false },
    },
    imageBackfillHasQueuedWork: false,
    githubCleanupEnabled: false,
  };
}

function recoveryRunningJob(provider: string, instanceId: string) {
  return { id: `${provider}-job`, provider, instanceId, status: 'running' };
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
  mocks.ensureDefaultFeishuOAuthConfig.mockResolvedValue(undefined);
  mocks.reconcileStartupSyncJob.mockResolvedValue(undefined);
  mocks.ensureDisplayMode.mockResolvedValue('all');
  mocks.readDisplayMode.mockResolvedValue('all');
  mocks.setDisplayMode.mockImplementation(async (mode: unknown) => {
    if (mode === 'supported' || mode === 'all' || mode === 'off') return mode;
    throw new Error('invalid inpage display mode');
  });
  mocks.storageOnChanged.mockImplementation(() => () => {});
  mocks.readBackgroundRecoveryProbe.mockResolvedValue(idleRecoveryProbe());
  mocks.createBackgroundServices.mockReturnValue(createServices());
  // @ts-expect-error test global cleanup
  delete globalThis.browser;
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('background entrypoint cold start', () => {
  it('runs auth bootstrap cleanup/defaults only once when onInstalled fires', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    let installedListener: ((details?: { reason?: string }) => void) | null = null;
    mocks.onInstalled.mockImplementationOnce((listener: any) => {
      installedListener = listener;
    });

    const callback = await loadBackground();
    expect(callback()).toBeUndefined();
    await flushMicrotasks();
    expect(mocks.ensureDefaultFeishuOAuthConfig).toHaveBeenCalledTimes(1);

    installedListener?.({ reason: 'update' });
    await flushMicrotasks();
    expect(mocks.ensureDefaultFeishuOAuthConfig).toHaveBeenCalledTimes(1);
  });

  it('registers runtime and browser listeners before locale readiness settles', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);

    let runtimeMessageListener: ((msg: any, sender: any, sendResponse: any) => boolean) | null = null;
    const onMessageAddListener = vi.fn((listener: any) => {
      runtimeMessageListener = listener;
    });
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: onMessageAddListener },
      },
    };

    const callback = await loadBackground();
    expect(callback()).toBeUndefined();

    expect(onMessageAddListener).toHaveBeenCalledTimes(1);
    expect(mocks.startCliNativeBridge).toHaveBeenCalledTimes(1);
    expect(onMessageAddListener.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startCliNativeBridge.mock.invocationCallOrder[0],
    );
    expect(mocks.setupNotionOAuthNavigationListener).toHaveBeenCalledTimes(1);
    expect(mocks.setupFeishuOAuthNavigationListener).toHaveBeenCalledTimes(1);
    expect(mocks.registerClipperContextMenu).toHaveBeenCalledTimes(1);
    expect(mocks.onInstalled).toHaveBeenCalledTimes(1);
    expect(mocks.onAlarm).toHaveBeenCalledTimes(1);
    expect(mocks.storageOnChanged).toHaveBeenCalledTimes(1);
    const uiMessageOptions = mocks.registerUiMessageHandlers.mock.calls[0]?.[1];
    expect(uiMessageOptions).not.toHaveProperty('localeReady');
    expect(uiMessageOptions?.ensureLocaleReady).toEqual(expect.any(Function));
    expect(mocks.initializeLocale).toHaveBeenCalledTimes(1);
    expect(uiMessageOptions.ensureLocaleReady()).toBe(locale.promise);
    expect(mocks.initializeLocale).toHaveBeenCalledTimes(2);
    const menuOptions = mocks.registerClipperContextMenu.mock.calls[0]?.[0];
    expect(menuOptions).not.toHaveProperty('localeReady');
    expect(menuOptions.readDisplayMode).toBe(mocks.readDisplayMode);
    expect(menuOptions.setDisplayMode).toBe(mocks.setDisplayMode);
    expect(menuOptions.ready).toBeInstanceOf(Promise);
    expect(mocks.registerGithubSettingsHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerPublicSettingsHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerOpenTargetHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerSyncHandlers.mock.calls[0]?.[1]?.githubSyncOrchestrator).toBe(
      mocks.createBackgroundServices.mock.results[0]?.value.githubSyncOrchestrator,
    );

    const services = mocks.createBackgroundServices.mock.results[0]?.value;
    await flushMicrotasks();
    expect(mocks.readBackgroundRecoveryProbe).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
    expect(services.autoSync.notionScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.obsidianScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.feishuScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flushCleanup).not.toHaveBeenCalled();
    expect(services.autoSync.imageBackfillScheduler.flush).not.toHaveBeenCalled();

    expect(runtimeMessageListener).not.toBeNull();
    const sendResponse = vi.fn();
    expect(runtimeMessageListener?.({ type: 'cold-start-probe' }, null, sendResponse)).toBe(true);
    await flushMicrotasks();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      data: null,
      error: { message: 'unknown message type: cold-start-probe', extra: null },
    });
  });

  it('serves the core router while the recovery probe is still pending', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    const probe = deferred<any>();
    mocks.readBackgroundRecoveryProbe.mockReturnValue(probe.promise);

    let runtimeMessageListener: ((msg: any, sender: any, sendResponse: any) => boolean) | null = null;
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            runtimeMessageListener = listener;
          }),
        },
      },
    };

    const callback = await loadBackground();
    callback();

    expect(runtimeMessageListener).not.toBeNull();
    const sendResponse = vi.fn();
    expect(runtimeMessageListener?.({ type: 'probe-pending-router-check' }, null, sendResponse)).toBe(true);
    await flushMicrotasks();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      data: null,
      error: { message: 'unknown message type: probe-pending-router-check', extra: null },
    });
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();

    probe.resolve(idleRecoveryProbe());
    await flushMicrotasks();
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
  });

  it('selectively reconciles only an old-instance durable running job', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.readBackgroundRecoveryProbe.mockResolvedValue({
      ...idleRecoveryProbe(),
      providers: {
        ...idleRecoveryProbe().providers,
        notion: { runningJob: recoveryRunningJob('notion', 'old-instance'), hasQueuedWork: false },
      },
    });
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    callback();
    await flushMicrotasks();

    expect(services.notionSyncOrchestrator.isRunActive).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileStartupSyncJob).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileStartupSyncJob).toHaveBeenCalledWith('notion');
    expect(services.autoSync.notionScheduler.flush).not.toHaveBeenCalled();
  });

  it('skips same-instance durable running jobs', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.readBackgroundRecoveryProbe.mockImplementation(async () => {
      const getInstanceId = mocks.createBackgroundServices.mock.calls[0]?.[0]?.getInstanceId;
      const instanceId = getInstanceId();
      return {
        ...idleRecoveryProbe(),
        providers: {
          ...idleRecoveryProbe().providers,
          notion: { runningJob: recoveryRunningJob('notion', instanceId), hasQueuedWork: false },
        },
      };
    });
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    callback();
    await flushMicrotasks();

    expect(services.notionSyncOrchestrator.isRunActive).not.toHaveBeenCalled();
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
  });

  it('rechecks live ownership before reconciling a stale old-instance probe result', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    const probe = deferred<any>();
    mocks.readBackgroundRecoveryProbe.mockReturnValue(probe.promise);
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    callback();
    services.notionSyncOrchestrator.isRunActive.mockReturnValue(true);
    probe.resolve({
      ...idleRecoveryProbe(),
      providers: {
        ...idleRecoveryProbe().providers,
        notion: { runningJob: recoveryRunningJob('notion', 'old-instance'), hasQueuedWork: false },
      },
    });
    await flushMicrotasks();

    expect(services.notionSyncOrchestrator.isRunActive).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
  });

  it('flushes only durable queued work and enabled GitHub cleanup', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.readBackgroundRecoveryProbe.mockResolvedValue({
      ...idleRecoveryProbe(),
      providers: {
        ...idleRecoveryProbe().providers,
        obsidian: { runningJob: null, hasQueuedWork: true },
      },
      imageBackfillHasQueuedWork: true,
      githubCleanupEnabled: true,
    });
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    callback();
    await flushMicrotasks();

    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
    expect(services.autoSync.notionScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.obsidianScheduler.flush).toHaveBeenCalledTimes(1);
    expect(services.autoSync.feishuScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flushCleanup).toHaveBeenCalledTimes(1);
    expect(services.autoSync.imageBackfillScheduler.flush).toHaveBeenCalledTimes(1);
  });

  it('display migration failure does not block router or context-menu startup', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.ensureDisplayMode.mockRejectedValueOnce(new Error('migration failed'));
    const onMessageAddListener = vi.fn();
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { onMessage: { addListener: onMessageAddListener } } };

    const callback = await loadBackground();
    expect(() => callback()).not.toThrow();
    expect(onMessageAddListener).toHaveBeenCalledTimes(1);
    expect(mocks.registerClipperContextMenu).toHaveBeenCalledTimes(1);
    await expect(mocks.registerClipperContextMenu.mock.calls[0]?.[0]?.ready).resolves.toBeUndefined();
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
    expect(mocks.storageOnChanged).toHaveBeenCalledTimes(1);
  });

  it('isolates GitHub settings registration failure from core router and selective startup recovery', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.registerGithubSettingsHandlers.mockImplementationOnce(() => {
      throw new Error('github settings registration failed');
    });
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    expect(() => callback()).not.toThrow();
    await flushMicrotasks();

    expect(mocks.registerUiMessageHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerSyncHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.onAlarm).toHaveBeenCalledTimes(1);
    expect(mocks.readBackgroundRecoveryProbe).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flush).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flushCleanup).not.toHaveBeenCalled();
  });

  it('wakes durable GitHub cleanup when auto-sync or provider gate becomes enabled', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);
    let storageListener: ((changes: any, areaName: string) => void) | null = null;
    mocks.storageOnChanged.mockImplementation((listener: any) => {
      storageListener = listener;
      return () => {};
    });

    const callback = await loadBackground();
    callback();
    expect(storageListener).not.toBeNull();

    storageListener?.({ github_auto_sync_enabled_v1: { oldValue: false, newValue: true } }, 'local');
    await flushMicrotasks();
    expect(services.autoSync.githubScheduler.scheduleCleanup).toHaveBeenCalledTimes(1);

    storageListener?.({ webclipper_sync_provider_github_enabled: { oldValue: false, newValue: undefined } }, 'local');
    await flushMicrotasks();
    expect(services.autoSync.githubScheduler.scheduleCleanup).toHaveBeenCalledTimes(2);

    storageListener?.({ github_auto_sync_enabled_v1: { oldValue: true, newValue: false } }, 'local');
    storageListener?.({ unrelated: { oldValue: false, newValue: true } }, 'local');
    storageListener?.({ github_auto_sync_enabled_v1: { oldValue: false, newValue: true } }, 'sync');
    await flushMicrotasks();
    expect(services.autoSync.githubScheduler.scheduleCleanup).toHaveBeenCalledTimes(2);
  });

  it('isolates storage-listener registration failure from selective startup recovery', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.storageOnChanged.mockImplementation(() => {
      throw new Error('storage listener failed');
    });
    mocks.readBackgroundRecoveryProbe.mockResolvedValue({
      ...idleRecoveryProbe(),
      providers: {
        ...idleRecoveryProbe().providers,
        github: { runningJob: null, hasQueuedWork: true },
      },
    });
    const services = createServices();
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    expect(() => callback()).not.toThrow();
    await flushMicrotasks();

    expect(mocks.onAlarm).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileStartupSyncJob).not.toHaveBeenCalled();
    expect(services.autoSync.githubScheduler.flush).toHaveBeenCalledTimes(1);
    expect(services.autoSync.githubScheduler.flushCleanup).not.toHaveBeenCalled();
  });

  it('falls back to full recovery on probe failure and isolates sibling failures', async () => {
    mocks.initializeLocale.mockResolvedValue(undefined);
    mocks.readBackgroundRecoveryProbe.mockRejectedValue(new Error('probe failed'));
    const services = createServices();
    mocks.reconcileStartupSyncJob.mockImplementation(async (provider: string) => {
      if (provider === 'notion') throw new Error('notion recovery failed');
    });
    services.autoSync.obsidianScheduler.flush.mockImplementation(() => {
      throw new Error('obsidian flush failed');
    });
    mocks.createBackgroundServices.mockReturnValue(services);

    const callback = await loadBackground();
    expect(() => callback()).not.toThrow();
    await flushMicrotasks();

    expect(mocks.reconcileStartupSyncJob).toHaveBeenCalledTimes(4);
    expect(mocks.reconcileStartupSyncJob).toHaveBeenCalledWith('obsidian');
    expect(mocks.reconcileStartupSyncJob).toHaveBeenCalledWith('feishu');
    expect(mocks.reconcileStartupSyncJob).toHaveBeenCalledWith('github');
    expect(services.autoSync.notionScheduler.flush).toHaveBeenCalledTimes(1);
    expect(services.autoSync.obsidianScheduler.flush).toHaveBeenCalledTimes(1);
    expect(services.autoSync.feishuScheduler.flush).toHaveBeenCalledTimes(1);
    expect(services.autoSync.githubScheduler.flush).toHaveBeenCalledTimes(1);
    expect(services.autoSync.githubScheduler.flushCleanup).toHaveBeenCalledTimes(1);
    expect(services.autoSync.imageBackfillScheduler.flush).toHaveBeenCalledTimes(1);
  });
});
