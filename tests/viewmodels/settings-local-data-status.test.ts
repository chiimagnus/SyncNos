import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getInsightFactsSnapshot: vi.fn(),
  startMigration: vi.fn(),
  resumeMigration: vi.fn(),
  send: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageRemove: vi.fn(),
  storageListener: null as ((changes: any, areaName: string) => void) | null,
  portListener: null as ((message: any) => void) | null,
  clipboardWrite: vi.fn(),
}));

vi.mock('@services/local-data/client', () => ({
  getLocalDataMigrationStatus: mocks.getStatus,
  startLocalDataMigration: mocks.startMigration,
  resumeLocalDataMigration: mocks.resumeMigration,
}));

vi.mock('@services/conversations/client/repo', () => ({
  getInsightFactsSnapshot: mocks.getInsightFactsSnapshot,
}));

vi.mock('@services/shared/runtime', () => ({
  send: mocks.send,
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: mocks.storageGet,
  storageSet: mocks.storageSet,
  storageRemove: mocks.storageRemove,
  storageOnChanged: (listener: (changes: any, areaName: string) => void) => {
    mocks.storageListener = listener;
    return () => {
      if (mocks.storageListener === listener) mocks.storageListener = null;
    };
  },
}));

vi.mock('@services/shared/ports', () => ({
  connectPort: () => ({
    onMessage: {
      addListener(listener: (message: any) => void) {
        mocks.portListener = listener;
      },
      removeListener(listener: (message: any) => void) {
        if (mocks.portListener === listener) mocks.portListener = null;
      },
    },
    disconnect: vi.fn(),
  }),
}));

vi.mock('@services/sync/feishu/settings-store', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getFeishuPathConfig: vi.fn(async () => null),
    saveFeishuPathConfig: vi.fn(async (value: any) => value),
  };
});

vi.mock('@services/integrations/chatwith/chatwith-settings', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadChatWithSettings: vi.fn(async () => ({
      promptTemplate: actual.DEFAULT_CHAT_WITH_PROMPT_TEMPLATE,
      platforms: actual.DEFAULT_CHAT_WITH_PLATFORMS,
    })),
  };
});

vi.mock('@services/integrations/anti-hotlink/anti-hotlink-settings', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadAntiHotlinkRulesForSettings: vi.fn(async () => []),
  };
});

vi.mock('@viewmodels/settings/utils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, openHttpUrl: vi.fn(() => true) };
});

import { useSettingsSceneController } from '../../src/viewmodels/settings/useSettingsSceneController';
import { UI_EVENT_TYPES } from '../../src/services/protocols/message-contracts';
import type { LocalDataMigrationStatus } from '../../src/services/local-data/migration-status';
import type { SettingsSectionKey } from '../../src/viewmodels/settings/types';

function setupStatus(
  profileState: LocalDataMigrationStatus['profileState'] = 'setup_required',
): LocalDataMigrationStatus {
  const journal =
    profileState === 'active'
      ? ({ mode: 'active', stage: 'active' } as const)
      : profileState === 'migration_in_progress'
        ? ({ mode: 'transitional', stage: 'staging', migrationId: '11111111-1111-4111-8111-111111111111' } as const)
        : ({ mode: 'not_started', stage: 'not_started' } as const);
  return {
    actions: {
      canStart: profileState === 'setup_required' || profileState === 'join_existing_required',
      canResume: profileState === 'migration_in_progress',
    },
    capability: { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true },
    database: {
      presence: profileState === 'setup_required' ? 'missing' : 'present',
      factsHealth: profileState === 'setup_required' ? 'unknown' : 'healthy',
      factsRevision: profileState === 'setup_required' ? null : 1,
      ftsAvailable: profileState === 'setup_required' ? null : true,
    },
    diagnostics: [],
    host: { registration: 'available', compatibility: 'compatible' },
    journal,
    profileState,
    resumeReceipt: profileState === 'migration_in_progress' ? 'absent' : 'not_applicable',
  } as LocalDataMigrationStatus;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.clipboardWrite },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  for (const key of [
    'window',
    'document',
    'navigator',
    'location',
    'HTMLElement',
    'Node',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as any)[key];
  }
}

async function flush() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('settings Local Database status controller', () => {
  let root: ReactDOM.Root | null = null;
  let latest: ReturnType<typeof useSettingsSceneController>;

  function Harness(props: { activeSection: SettingsSectionKey }) {
    latest = useSettingsSceneController({ activeSection: props.activeSection });
    return null;
  }

  async function renderSection(activeSection: SettingsSectionKey) {
    await act(async () => {
      root!.render(createElement(Harness, { activeSection }));
      await flush();
    });
  }

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    mocks.getStatus.mockReset();
    mocks.getInsightFactsSnapshot.mockReset();
    mocks.startMigration.mockReset();
    mocks.resumeMigration.mockReset();
    mocks.send.mockReset();
    mocks.storageGet.mockReset();
    mocks.storageSet.mockReset();
    mocks.storageRemove.mockReset();
    mocks.storageListener = null;
    mocks.portListener = null;
    mocks.clipboardWrite.mockReset();
    mocks.clipboardWrite.mockResolvedValue(undefined);
    mocks.getStatus.mockResolvedValue(setupStatus());
    mocks.getInsightFactsSnapshot.mockResolvedValue({
      articleCount: 0,
      articleDailyCounts: [],
      articleDomainCounts: [],
      articleOtherDomainCount: 0,
      articleUnknownDateCount: 0,
      chatCount: 1,
      chatDailyCounts: [],
      chatOtherSourceCount: 0,
      chatSourceCounts: [{ key: 'chatgpt', count: 1 }],
      chatUnknownDateCount: 0,
      topConversations: [
        {
          conversationId: 91,
          source: 'chatgpt',
          conversationKey: 'native-thread',
          title: 'Native thread',
          messageCount: 3,
        },
      ],
      totalMessages: 3,
    });
    mocks.startMigration.mockResolvedValue(setupStatus('active'));
    mocks.resumeMigration.mockResolvedValue(setupStatus('active'));
    mocks.storageGet.mockResolvedValue({});
    mocks.storageSet.mockResolvedValue(undefined);
    mocks.storageRemove.mockResolvedValue(undefined);
    mocks.send.mockResolvedValue({ ok: true, data: { connected: false }, error: null });
  });

  afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    await flush();
    cleanupDom();
  });

  it('keeps provider/settings refreshes separate, loads once on first Backup entry, and reloads only on explicit recheck', async () => {
    await renderSection('notion');
    expect(mocks.getStatus).not.toHaveBeenCalled();

    await act(async () => {
      mocks.storageListener?.({ notion_oauth_pending_state: { newValue: 'pending' } }, 'local');
      await flush();
    });
    expect(mocks.getStatus).not.toHaveBeenCalled();

    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
    expect(latest.localDataStatus?.profileState).toBe('setup_required');

    await renderSection('general');
    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest.onLocalDataRetryStatus();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
  });

  it('rechecks an active profile exactly once after Host repair without changing active ownership', async () => {
    const unhealthy = {
      ...setupStatus('active'),
      host: { registration: 'unavailable', compatibility: 'unknown' } as const,
      database: { presence: 'unknown', factsHealth: 'unknown' } as const,
    } as LocalDataMigrationStatus;
    mocks.getStatus.mockResolvedValueOnce(unhealthy).mockResolvedValueOnce(setupStatus('active'));

    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
    expect(latest.localDataStatus?.profileState).toBe('active');
    expect(latest.localDataStatus?.host.registration).toBe('unavailable');

    await act(async () => {
      await latest.onLocalDataRetryStatus();
      await flush();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(latest.localDataStatus?.profileState).toBe('active');
    expect(latest.localDataStatus?.host).toEqual({ registration: 'available', compatibility: 'compatible' });
  });

  it('keeps Feishu OAuth polling on provider refreshInternal without probing Local Database status', async () => {
    await renderSection('feishu');
    expect(mocks.getStatus).not.toHaveBeenCalled();
    const sendsBeforePolling = mocks.send.mock.calls.length;

    vi.useFakeTimers();
    try {
      act(() => {
        latest.setFeishuClientId('cli_test');
        latest.setFeishuClientSecret('secret_test');
      });
      await act(async () => {
        await latest.onFeishuConnectOrDisconnect();
        await Promise.resolve();
      });
      expect(latest.pollingFeishu).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_600);
        await Promise.resolve();
      });
      expect(mocks.send.mock.calls.length).toBeGreaterThan(sendsBeforePolling);
      expect(mocks.getStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a stale status response after leaving Backup and issues a new latest request on return', async () => {
    const first = deferred<LocalDataMigrationStatus>();
    mocks.getStatus
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(setupStatus('join_existing_required'));

    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
    await renderSection('general');
    first.resolve(setupStatus('setup_required'));
    await act(async () => {
      await flush();
    });
    expect(latest.localDataStatus).toBeNull();

    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(latest.localDataStatus?.profileState).toBe('join_existing_required');
  });

  it('does not start before confirmation; Cancel is side-effect free; one terminal start causes exactly one latest status reload even with activation event', async () => {
    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    act(() => latest.onLocalDataRequestMigration());
    expect(latest.localDataMigrationDialogMode).toBe('start');
    expect(mocks.startMigration).not.toHaveBeenCalled();

    act(() => latest.onLocalDataCancelMigration());
    expect(latest.localDataMigrationDialogMode).toBeNull();
    expect(mocks.startMigration).not.toHaveBeenCalled();
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    const start = deferred<LocalDataMigrationStatus>();
    mocks.startMigration.mockImplementationOnce(() => start.promise);
    act(() => latest.onLocalDataRequestMigration());
    let confirmation!: Promise<void>;
    await act(async () => {
      confirmation = latest.onLocalDataConfirmMigration();
      await Promise.resolve();
    });
    expect(mocks.startMigration).toHaveBeenCalledTimes(1);
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.portListener?.({
        type: UI_EVENT_TYPES.CONVERSATIONS_CHANGED,
        payload: { reason: 'localDataMigrationActivated' },
      });
    });
    await act(async () => {
      await flush();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    start.resolve(setupStatus('active'));
    await act(async () => {
      await confirmation;
      await flush();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(latest.localDataMigrationDialogMode).toBeNull();
  });

  it('uses the join confirmation mode and keeps double clicks inhibited while the action is running', async () => {
    mocks.getStatus.mockResolvedValue(setupStatus('join_existing_required'));
    await renderSection('backup');
    act(() => latest.onLocalDataRequestMigration());
    expect(latest.localDataMigrationDialogMode).toBe('join');

    const start = deferred<LocalDataMigrationStatus>();
    mocks.startMigration.mockImplementationOnce(() => start.promise);
    let first!: Promise<void>;
    await act(async () => {
      first = latest.onLocalDataConfirmMigration();
      await Promise.resolve();
    });
    await act(async () => {
      await latest.onLocalDataConfirmMigration();
    });
    expect(mocks.startMigration).toHaveBeenCalledTimes(1);
    start.resolve(setupStatus('active'));
    await act(async () => {
      await first;
      await flush();
    });
  });

  it('performs one status reload after a resume terminal and never reopens the confirmation dialog', async () => {
    mocks.getStatus.mockResolvedValue(setupStatus('migration_in_progress'));
    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest.onLocalDataResumeMigration();
      await flush();
    });

    expect(mocks.resumeMigration).toHaveBeenCalledTimes(1);
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(latest.localDataMigrationDialogMode).toBeNull();
  });

  it('copies fixed setup help through the Clipboard API without any command execution surface', async () => {
    await renderSection('backup');
    const text = 'syncnoscli doctor --fix';

    await act(async () => {
      await latest.onLocalDataCopyHelpText(text);
    });

    expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1);
    expect(mocks.clipboardWrite).toHaveBeenCalledWith(text);
    expect(latest.localDataCopiedHelpText).toBe(text);
  });

  it('reloads About You through the backend-neutral Insight service after migration and ignores the stale pre-activation read', async () => {
    const stale = deferred<any>();
    const freshSnapshot = {
      articleCount: 0,
      articleDailyCounts: [],
      articleDomainCounts: [],
      articleOtherDomainCount: 0,
      articleUnknownDateCount: 0,
      chatCount: 1,
      chatDailyCounts: [],
      chatOtherSourceCount: 0,
      chatSourceCounts: [{ key: 'gemini', count: 1 }],
      chatUnknownDateCount: 0,
      topConversations: [
        {
          conversationId: 92,
          source: 'gemini',
          conversationKey: 'native-after-migration',
          title: 'Native after migration',
          messageCount: 9,
        },
      ],
      totalMessages: 9,
    };
    mocks.getInsightFactsSnapshot.mockImplementationOnce(() => stale.promise).mockResolvedValueOnce(freshSnapshot);

    await renderSection('aboutyou');
    expect(mocks.getInsightFactsSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.portListener?.({
        type: UI_EVENT_TYPES.CONVERSATIONS_CHANGED,
        payload: { reason: 'localDataMigrationActivated' },
      });
    });
    await act(async () => {
      await flush();
      await flush();
    });

    expect(mocks.getInsightFactsSnapshot).toHaveBeenCalledTimes(2);
    expect(latest.insightStats?.totalMessages).toBe(9);
    expect(latest.insightStats?.topConversations[0]).toMatchObject({
      openSource: 'gemini',
      openConversationKey: 'native-after-migration',
    });
    expect(mocks.getInsightFactsSnapshot.mock.calls[1]?.[0]).toMatchObject({
      timeZone: expect.any(String),
      since: expect.any(Number),
      until: expect.any(Number),
    });

    stale.resolve({
      ...freshSnapshot,
      chatSourceCounts: [{ key: 'chatgpt', count: 1 }],
      topConversations: [
        { conversationId: 1, source: 'chatgpt', conversationKey: 'stale-idb', title: 'Stale IDB', messageCount: 1 },
      ],
      totalMessages: 1,
    });
    await act(async () => {
      await flush();
    });
    expect(latest.insightStats?.totalMessages).toBe(9);
    expect(latest.insightStats?.topConversations[0]?.openConversationKey).toBe('native-after-migration');
  });

  it('marks status dirty on a coordinator event outside Backup without probing Native until Backup is entered', async () => {
    await renderSection('aboutyou');
    expect(mocks.getStatus).not.toHaveBeenCalled();

    act(() => {
      mocks.portListener?.({
        type: UI_EVENT_TYPES.CONVERSATIONS_CHANGED,
        payload: { reason: 'localDataMigrationActivated' },
      });
    });
    await act(async () => {
      await flush();
    });
    expect(mocks.getStatus).not.toHaveBeenCalled();

    await renderSection('backup');
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
  });
});
