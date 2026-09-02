import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { t } from '../../src/ui/i18n';
import { ConversationsProvider, useConversationsApp } from '../../src/viewmodels/conversations/conversations-context';
import { useConversationSyncFeedback } from '../../src/viewmodels/conversations/useConversationSyncFeedback';
import { ConversationListPane } from '../../src/ui/conversations/ConversationListPane';
import { SYNC_JOB_STORAGE_KEYS } from '../../src/services/sync/sync-job-store';

const getConversationListBootstrap = vi.fn();
const getConversationDetail = vi.fn();
const deleteConversations = vi.fn();
const syncNotionConversations = vi.fn();
const syncObsidianConversations = vi.fn();
const syncFeishuConversations = vi.fn();
const syncGithubConversations = vi.fn();
const clearNotionSyncJobStatus = vi.fn();
const clearObsidianSyncStatus = vi.fn();
const clearFeishuSyncStatus = vi.fn();
const clearGithubSyncStatus = vi.fn();
const getNotionSyncJobStatus = vi.fn();
const getObsidianSyncStatus = vi.fn();
const getFeishuSyncStatus = vi.fn();
const getGithubSyncStatus = vi.fn();

const storageEventMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((changes: Record<string, unknown>, areaName: string) => void) | null,
}));

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  syncProviderEnabledStorageKey: (provider: string) => `webclipper_sync_provider_${provider}_enabled`,
  getSyncProviderEnabledStorageKeys: () => [
    'webclipper_sync_provider_obsidian_enabled',
    'webclipper_sync_provider_notion_enabled',
    'webclipper_sync_provider_feishu_enabled',
    'webclipper_sync_provider_github_enabled',
  ],
  hasSyncProviderEnabledStorageChange: () => false,
  getEnabledSyncProviders: async () => ['obsidian', 'notion', 'feishu', 'github'],
  isSyncProviderEnabled: async () => true,
  ensureSyncProviderEnabled: async () => null,
  setSyncProviderEnabled: async () => {},
}));

vi.mock('@services/sync/repo', () => ({
  clearFeishuSyncStatus: (...args: any[]) => clearFeishuSyncStatus(...args),
  clearGithubSyncStatus: (...args: any[]) => clearGithubSyncStatus(...args),
  clearNotionSyncJobStatus: (...args: any[]) => clearNotionSyncJobStatus(...args),
  clearObsidianSyncStatus: (...args: any[]) => clearObsidianSyncStatus(...args),
  syncFeishuConversations: (...args: any[]) => syncFeishuConversations(...args),
  syncGithubConversations: (...args: any[]) => syncGithubConversations(...args),
  syncNotionConversations: (...args: any[]) => syncNotionConversations(...args),
  syncObsidianConversations: (...args: any[]) => syncObsidianConversations(...args),
  getFeishuSyncStatus: (...args: any[]) => getFeishuSyncStatus(...args),
  getGithubSyncStatus: (...args: any[]) => getGithubSyncStatus(...args),
  getNotionSyncJobStatus: (...args: any[]) => getNotionSyncJobStatus(...args),
  getObsidianSyncStatus: (...args: any[]) => getObsidianSyncStatus(...args),
}));

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsCreate: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageOnChanged: (listener: (changes: Record<string, unknown>, areaName: string) => void) => {
    storageEventMocks.subscribe(listener);
    storageEventMocks.listener = listener;
    return () => {
      storageEventMocks.unsubscribe(listener);
      if (storageEventMocks.listener === listener) storageEventMocks.listener = null;
    };
  },
}));

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return dom;
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseConversation = {
  id: 11,
  title: 'Sync feedback chat',
  source: 'chatgpt',
  conversationKey: 'conv-11',
  lastCapturedAt: Date.now(),
  url: 'https://example.com/chat/11',
};

describe('Conversations sync feedback', () => {
  let root: ReactDOM.Root | null = null;
  let latestApp: ReturnType<typeof useConversationsApp> | null = null;
  let latestFeedback: ReturnType<typeof useConversationSyncFeedback> | null = null;

  function AppProbe() {
    latestApp = useConversationsApp();
    return null;
  }

  function FeedbackProbe() {
    latestFeedback = useConversationSyncFeedback();
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    latestApp = null;
    latestFeedback = null;

    getConversationListBootstrap.mockReset();
    getConversationDetail.mockReset();
    deleteConversations.mockReset();
    syncNotionConversations.mockReset();
    syncObsidianConversations.mockReset();
    syncFeishuConversations.mockReset();
    syncGithubConversations.mockReset();
    clearNotionSyncJobStatus.mockReset();
    clearObsidianSyncStatus.mockReset();
    clearFeishuSyncStatus.mockReset();
    clearGithubSyncStatus.mockReset();
    getNotionSyncJobStatus.mockReset();
    getObsidianSyncStatus.mockReset();
    getFeishuSyncStatus.mockReset();
    getGithubSyncStatus.mockReset();
    storageEventMocks.subscribe.mockClear();
    storageEventMocks.unsubscribe.mockClear();
    storageEventMocks.listener = null;

    getConversationListBootstrap.mockResolvedValue({
      items: [baseConversation],
      cursor: null,
      hasMore: false,
      summary: { totalCount: 1, todayCount: 1 },
      facets: {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
        sites: [],
      },
    });
    getConversationDetail.mockResolvedValue({ id: 11, messages: [] });
    deleteConversations.mockResolvedValue(null);
    clearNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: null,
      instanceId: 'notion-test',
    });
    clearObsidianSyncStatus.mockResolvedValue({
      provider: 'obsidian',
      active: false,
      job: null,
      instanceId: 'obsidian-test',
    });
    clearFeishuSyncStatus.mockResolvedValue({
      provider: 'feishu',
      active: false,
      job: null,
      instanceId: 'feishu-test',
    });
    clearGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: false,
      job: null,
      instanceId: 'github-test',
    });
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: null,
      instanceId: 'notion-test',
    });
    getObsidianSyncStatus.mockResolvedValue({
      provider: 'obsidian',
      active: false,
      job: null,
      instanceId: 'obsidian-test',
    });
    getFeishuSyncStatus.mockResolvedValue({ provider: 'feishu', active: false, job: null, instanceId: 'feishu-test' });
    getGithubSyncStatus.mockResolvedValue({ provider: 'github', active: false, job: null, instanceId: 'github-test' });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    latestApp = null;
    latestFeedback = null;
    vi.useRealTimers();
    cleanupDom();
  });

  async function renderPane() {
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, createElement(ConversationListPane)));
      await flushMicrotasks();
    });
  }

  async function renderAppProbe() {
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, createElement(AppProbe)));
      await flushMicrotasks();
    });
    expect(latestApp).toBeTruthy();
  }

  async function renderFeedbackProbe() {
    await act(async () => {
      root!.render(createElement(FeedbackProbe));
      await flushMicrotasks();
    });
    expect(latestFeedback).toBeTruthy();
  }

  async function emitStorageChanges(changes: Record<string, unknown>) {
    expect(storageEventMocks.listener).toBeTruthy();
    await act(async () => {
      storageEventMocks.listener!(changes, 'local');
      await flushMicrotasks();
      await flushMicrotasks();
    });
  }

  function clearStatusGetterCalls() {
    getNotionSyncJobStatus.mockClear();
    getObsidianSyncStatus.mockClear();
    getFeishuSyncStatus.mockClear();
    getGithubSyncStatus.mockClear();
  }

  function expectStatusGetterCalls(expected: Partial<Record<'notion' | 'obsidian' | 'feishu' | 'github', number>>) {
    expect(getNotionSyncJobStatus).toHaveBeenCalledTimes(expected.notion ?? 0);
    expect(getObsidianSyncStatus).toHaveBeenCalledTimes(expected.obsidian ?? 0);
    expect(getFeishuSyncStatus).toHaveBeenCalledTimes(expected.feishu ?? 0);
    expect(getGithubSyncStatus).toHaveBeenCalledTimes(expected.github ?? 0);
  }

  function selectFirstConversation() {
    const checkbox = document.querySelector(
      '[data-conversation-id="11"] input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    act(() => {
      checkbox!.click();
    });
  }

  function clickNotionButton() {
    const button = Array.from(document.querySelectorAll('button')).find((el) =>
      el.textContent?.trim().startsWith('Notion'),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    act(() => {
      button!.click();
    });
  }

  function clickDismissButton() {
    const button = document.querySelector('[aria-label="Dismiss sync feedback"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    act(() => {
      button!.click();
    });
  }

  function clickOpenDetailsButton() {
    const button = document.querySelector('[aria-label="Open Notion sync details"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    act(() => {
      button!.click();
    });
  }

  function notionRunningJob(overrides: Record<string, unknown> = {}) {
    return {
      provider: 'notion',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      conversationIds: [11, 22],
      currentConversationId: 22,
      currentConversationTitle: 'Current sync target',
      currentStage: 'uploading_message_blocks',
      okCount: 1,
      failCount: 0,
      perConversation: [{ conversationId: 11, ok: true, mode: 'appended', appended: 3, error: '', at: Date.now() }],
      ...overrides,
    };
  }

  function notionTerminalJob(overrides: Record<string, unknown> = {}) {
    return notionRunningJob({
      status: 'done',
      finishedAt: Date.now(),
      currentConversationId: undefined,
      currentConversationTitle: '',
      currentStage: 'done',
      okCount: 1,
      failCount: 0,
      perConversation: [
        {
          conversationId: 11,
          conversationTitle: 'Sync feedback chat',
          ok: true,
          mode: 'created',
          appended: 1,
          error: '',
          at: Date.now(),
        },
      ],
      ...overrides,
    });
  }

  function githubJob(overrides: Record<string, unknown> = {}) {
    return {
      provider: 'github',
      status: 'running',
      startedAt: Date.now() - 500,
      updatedAt: Date.now(),
      finishedAt: null,
      conversationIds: [11],
      currentConversationId: 11,
      currentConversationTitle: 'GitHub sync target',
      currentStage: 'committing_tree',
      okCount: 0,
      failCount: 0,
      perConversation: [],
      ...overrides,
    };
  }

  it('reads all four providers exactly once on initial mount and subscribes to storage once', async () => {
    await renderFeedbackProbe();

    expectStatusGetterCalls({ notion: 1, obsidian: 1, feishu: 1, github: 1 });
    expect(storageEventMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(storageEventMocks.unsubscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['notion', syncNotionConversations, getNotionSyncJobStatus],
    ['obsidian', syncObsidianConversations, getObsidianSyncStatus],
    ['feishu', syncFeishuConversations, getFeishuSyncStatus],
    ['github', syncGithubConversations, getGithubSyncStatus],
  ] as const)(
    'converges a successful %s start with only the target provider status read',
    async (provider, starter, getter) => {
      starter.mockResolvedValue({ provider, started: true });
      getter.mockResolvedValue({ provider, active: true, job: null, instanceId: `${provider}-test` });
      await renderFeedbackProbe();
      clearStatusGetterCalls();

      await act(async () => {
        await latestFeedback!.startSync(provider, [11]);
        await flushMicrotasks();
      });

      expect(starter).toHaveBeenCalledWith([11]);
      expectStatusGetterCalls({ [provider]: 1 });
      expect(latestFeedback?.feedback).toMatchObject({ provider, phase: 'running' });
    },
  );

  it('establishes Obsidian optimistic running state before the starter promise settles', async () => {
    const starter = deferred<any>();
    syncObsidianConversations.mockImplementation(() => starter.promise);
    getObsidianSyncStatus.mockResolvedValue({
      provider: 'obsidian',
      active: true,
      job: null,
      instanceId: 'obsidian-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    let startPromise!: Promise<any>;
    act(() => {
      startPromise = latestFeedback!.startSync('obsidian', [11]);
    });

    expect(latestFeedback?.feedback).toMatchObject({ provider: 'obsidian', phase: 'running', total: 1, done: 0 });
    expectStatusGetterCalls({});

    starter.resolve({ provider: 'obsidian', started: true });
    await act(async () => {
      await startPromise;
      await flushMicrotasks();
    });
    expectStatusGetterCalls({ obsidian: 1 });
  });

  it('consumes a running SyncJob storage payload directly, normalizes provider by key, and keeps one listener subscription', async () => {
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const listener = storageEventMocks.listener;

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        newValue: notionRunningJob({
          provider: 'github',
          totalCount: 4,
          conversationIds: [],
          okCount: 2,
          currentConversationTitle: 'Storage progress one',
        }),
      },
    });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      total: 4,
      done: 2,
      currentConversationTitle: 'Storage progress one',
    });
    expectStatusGetterCalls({});
    expect(storageEventMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(storageEventMocks.listener).toBe(listener);

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        newValue: notionRunningJob({
          provider: undefined,
          totalCount: 4,
          conversationIds: [],
          okCount: 3,
          currentConversationTitle: 'Storage progress two',
        }),
      },
    });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      total: 4,
      done: 3,
      currentConversationTitle: 'Storage progress two',
    });
    expectStatusGetterCalls({});
    expect(storageEventMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(storageEventMocks.unsubscribe).not.toHaveBeenCalled();
    expect(storageEventMocks.listener).toBe(listener);
  });

  it('uses synchronously committed refs across consecutive storage events without waiting for a React effect', async () => {
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const listener = storageEventMocks.listener!;

    await act(async () => {
      listener(
        {
          [SYNC_JOB_STORAGE_KEYS.notion]: {
            newValue: notionRunningJob({ totalCount: 2, currentConversationTitle: 'First durable observation' }),
          },
        },
        'local',
      );
      listener(
        {
          [SYNC_JOB_STORAGE_KEYS.notion]: {
            newValue: notionRunningJob({
              totalCount: 2,
              okCount: 1,
              currentConversationTitle: 'Second durable observation',
            }),
          },
        },
        'local',
      );
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      done: 1,
      currentConversationTitle: 'Second durable observation',
    });
    expectStatusGetterCalls({});
  });

  it('does not let a non-current running storage event steal the preferred live provider or trigger a getter', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob({ currentConversationTitle: 'Preferred Notion' }),
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.github]: {
        newValue: githubJob({ currentConversationTitle: 'Should stay hidden', updatedAt: Date.now() + 10_000 }),
      },
    });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      currentConversationTitle: 'Preferred Notion',
    });
    expectStatusGetterCalls({});
  });

  it('keeps fixed scan order when multiple providers are active without comparable durable running jobs', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: null,
      instanceId: 'notion-test',
    });
    getObsidianSyncStatus.mockResolvedValue({
      provider: 'obsidian',
      active: true,
      job: null,
      instanceId: 'obsidian-test',
    });
    getFeishuSyncStatus.mockResolvedValue({ provider: 'feishu', active: true, job: null, instanceId: 'feishu-test' });
    getGithubSyncStatus.mockResolvedValue({ provider: 'github', active: true, job: null, instanceId: 'github-test' });

    await renderFeedbackProbe();

    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'running' });
  });

  it('treats an idle terminal storage event as a transition boundary until ownership is confirmed inactive', async () => {
    const terminal = notionTerminalJob();
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: terminal,
      instanceId: 'notion-test',
    });

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: terminal } });

    expectStatusGetterCalls({ notion: 1, obsidian: 1, feishu: 1, github: 1 });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'running' });
    expect(latestFeedback?.feedback.summary).toBeNull();

    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
    expect(latestFeedback?.feedback.summary).not.toBeNull();
  });

  it('keeps a terminal storage seed pending when its status getter fails without a trusted inactive fact', async () => {
    const terminal = notionTerminalJob();
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockRejectedValue(new Error('notion status unavailable'));

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: terminal } });

    expectStatusGetterCalls({ notion: 1, obsidian: 1, feishu: 1, github: 1 });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'running', summary: null });

    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
  });

  it('does not resurrect a terminal seed when the handoff getter successfully reports canonical clear', async () => {
    const terminal = notionTerminalJob();
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: notionRunningJob({ currentConversationTitle: 'Before terminal' }) },
    });
    clearStatusGetterCalls();
    getNotionSyncJobStatus
      .mockResolvedValueOnce({ provider: 'notion', active: false, job: terminal, instanceId: 'notion-test' })
      .mockResolvedValueOnce({ provider: 'notion', active: false, job: null, instanceId: 'notion-test' });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
    expect(latestFeedback?.feedback.summary).toBeNull();
  });

  it('uses a terminal seed only when inactive ownership was already observed and the handoff getter then rejects', async () => {
    const terminal = notionTerminalJob();
    await renderFeedbackProbe();
    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: notionRunningJob({ currentConversationTitle: 'Before terminal' }) },
    });
    clearStatusGetterCalls();
    getNotionSyncJobStatus
      .mockResolvedValueOnce({ provider: 'notion', active: false, job: terminal, instanceId: 'notion-test' })
      .mockRejectedValueOnce(new Error('handoff read failed'));

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
    expect(latestFeedback?.feedback.summary).not.toBeNull();
  });

  it('keeps the preferred live provider when its terminal durable write arrives before ownership settles, then hands off', async () => {
    const terminal = notionTerminalJob();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ currentConversationTitle: 'Notion still owns' }),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: terminal,
      instanceId: 'notion-test',
    });
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: true,
      job: githubJob({ currentConversationTitle: 'Hidden GitHub' }),
      instanceId: 'github-test',
    });

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: terminal } });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      currentConversationTitle: 'Notion still owns',
    });

    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'github',
      phase: 'running',
      currentConversationTitle: 'Hidden GitHub',
    });
  });

  it('blocks handoff to another active provider while the preferred live provider status is unknown', async () => {
    const terminal = notionTerminalJob();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ currentConversationTitle: 'Notion preferred' }),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockRejectedValueOnce(new Error('notion status unavailable'));
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: true,
      job: githubJob({ currentConversationTitle: 'GitHub must wait' }),
      instanceId: 'github-test',
    });

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: terminal } });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      currentConversationTitle: 'Notion preferred',
    });

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'github', phase: 'running' });
  });

  it('ignores a non-current terminal clear but rescans when the visible terminal provider is cleared', async () => {
    const terminal = notionTerminalJob();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
    clearStatusGetterCalls();

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.github]: { newValue: null } });
    expectStatusGetterCalls({});
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: null,
      instanceId: 'notion-test',
    });
    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: null } });
    expectStatusGetterCalls({ notion: 1, obsidian: 1, feishu: 1, github: 1 });
    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
  });

  it.each(['terminal-first', 'running-first'] as const)(
    'arbitrates a multi-key current-terminal plus other-running event independently of key order: %s',
    async (order) => {
      const terminal = notionTerminalJob();
      getNotionSyncJobStatus.mockResolvedValue({
        provider: 'notion',
        active: true,
        job: notionRunningJob({ currentConversationTitle: 'Current Notion' }),
        instanceId: 'notion-test',
      });
      await renderFeedbackProbe();
      clearStatusGetterCalls();
      getNotionSyncJobStatus.mockResolvedValue({
        provider: 'notion',
        active: false,
        job: terminal,
        instanceId: 'notion-test',
      });
      getGithubSyncStatus.mockResolvedValue({
        provider: 'github',
        active: true,
        job: githubJob({ currentConversationTitle: 'Surviving GitHub' }),
        instanceId: 'github-test',
      });
      const terminalChange = [SYNC_JOB_STORAGE_KEYS.notion, { newValue: terminal }] as const;
      const runningChange = [SYNC_JOB_STORAGE_KEYS.github, { newValue: githubJob() }] as const;
      const entries = order === 'terminal-first' ? [terminalChange, runningChange] : [runningChange, terminalChange];

      await emitStorageChanges(Object.fromEntries(entries));

      expect(latestFeedback?.feedback).toMatchObject({
        provider: 'github',
        phase: 'running',
        currentConversationTitle: 'Surviving GitHub',
      });
    },
  );

  it('does not overlap the 500ms active poll while an earlier poll is still pending', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob(),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const poll = deferred<any>();
    getNotionSyncJobStatus.mockImplementation(() => poll.promise);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
    });
    expectStatusGetterCalls({ notion: 1 });

    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await flushMicrotasks();
    });
    expectStatusGetterCalls({ notion: 1 });

    poll.resolve({ provider: 'notion', active: true, job: notionRunningJob(), instanceId: 'notion-test' });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });
  });

  it('does not let a delayed poll roll back a newer direct durable storage observation', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ currentConversationTitle: 'Initial' }),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const oldPoll = deferred<any>();
    getNotionSyncJobStatus.mockImplementation(() => oldPoll.promise);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
    });
    expectStatusGetterCalls({ notion: 1 });

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        newValue: notionRunningJob({ currentConversationTitle: 'New durable observation', okCount: 2, totalCount: 3 }),
      },
    });
    expect(latestFeedback?.feedback).toMatchObject({ currentConversationTitle: 'New durable observation', done: 2 });

    oldPoll.resolve({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ currentConversationTitle: 'Old poll response', okCount: 0, totalCount: 3 }),
      instanceId: 'notion-test',
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ currentConversationTitle: 'New durable observation', done: 2 });
  });

  it('suppresses interval polling while a handoff full scan remains pending beyond 500ms', async () => {
    const terminal = notionTerminalJob();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob(),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const handoffRead = deferred<any>();
    getNotionSyncJobStatus.mockImplementationOnce(() => handoffRead.promise);

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: terminal } });
    expectStatusGetterCalls({ notion: 1, obsidian: 1, feishu: 1, github: 1 });

    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await flushMicrotasks();
    });
    expect(getNotionSyncJobStatus).toHaveBeenCalledTimes(1);

    handoffRead.resolve({ provider: 'notion', active: false, job: terminal, instanceId: 'notion-test' });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
  });

  it('lets a newer storage event replace an older handoff without the old settle clearing the new identity', async () => {
    const firstTerminal = notionTerminalJob({ id: 'terminal-one', updatedAt: Date.now() });
    const secondTerminal = notionTerminalJob({ id: 'terminal-two', updatedAt: Date.now() + 1 });
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob(),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const firstRead = deferred<any>();
    const secondRead = deferred<any>();
    getNotionSyncJobStatus
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: firstTerminal } });
    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: secondTerminal } });
    expect(getNotionSyncJobStatus).toHaveBeenCalledTimes(2);

    firstRead.resolve({ provider: 'notion', active: false, job: firstTerminal, instanceId: 'notion-test' });
    await act(async () => {
      await flushMicrotasks();
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
    });
    expect(getNotionSyncJobStatus).toHaveBeenCalledTimes(2);

    secondRead.resolve({ provider: 'notion', active: false, job: secondTerminal, instanceId: 'notion-test' });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback.summary?.jobId).toBe('terminal-two');
  });

  it('keeps Obsidian attached through active=true with no durable job after structured sync_already_running, then settles', async () => {
    const conflict: any = new Error('sync already in progress');
    conflict.code = 'sync_already_running';
    conflict.extra = { code: 'sync_already_running' };
    syncObsidianConversations.mockRejectedValue(conflict);
    getObsidianSyncStatus.mockResolvedValue({
      provider: 'obsidian',
      active: true,
      job: null,
      instanceId: 'obsidian-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    await act(async () => {
      await latestFeedback!.startSync('obsidian', [11]);
      await flushMicrotasks();
    });

    expect(syncObsidianConversations).toHaveBeenCalledTimes(1);
    expectStatusGetterCalls({ obsidian: 1 });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'obsidian', phase: 'running', summary: null });

    clearStatusGetterCalls();
    getObsidianSyncStatus.mockResolvedValue({
      provider: 'obsidian',
      active: false,
      job: null,
      instanceId: 'obsidian-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
  });

  it('normalizes all running keys in one storage event and adopts by stable order without status RPCs', async () => {
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.github]: { newValue: githubJob({ currentConversationTitle: 'GitHub same event' }) },
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        newValue: notionRunningJob({ currentConversationTitle: 'Notion same event', provider: 'github' }),
      },
    });

    expectStatusGetterCalls({});
    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      currentConversationTitle: 'Notion same event',
    });
  });

  it('lets a durable running event replace a local failure and later settles it when status proves it is residue', async () => {
    syncNotionConversations.mockRejectedValue(new Error('local notion failure'));
    await renderFeedbackProbe();
    await act(async () => {
      await expect(latestFeedback!.startSync('notion', [11])).rejects.toThrow('local notion failure');
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'failed', summary: null });
    clearStatusGetterCalls();

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.github]: { newValue: githubJob({ currentConversationTitle: 'Tentative GitHub' }) },
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'github', phase: 'running' });
    expectStatusGetterCalls({});

    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: false,
      job: githubJob({ currentConversationTitle: 'Residue GitHub' }),
      instanceId: 'github-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
  });

  it('does not let a delayed known-provider response roll back a newer storage progress observation', async () => {
    const knownRead = deferred<any>();
    syncNotionConversations.mockResolvedValue({ provider: 'notion', started: true });
    getNotionSyncJobStatus.mockImplementation(() => knownRead.promise);
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    let startPromise!: Promise<any>;
    await act(async () => {
      startPromise = latestFeedback!.startSync('notion', [11]);
      await flushMicrotasks();
    });
    expectStatusGetterCalls({ notion: 1 });

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        newValue: notionRunningJob({
          totalCount: 3,
          okCount: 2,
          currentConversationTitle: 'Newer storage progress',
        }),
      },
    });

    knownRead.resolve({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ totalCount: 3, okCount: 0, currentConversationTitle: 'Older known read' }),
      instanceId: 'notion-test',
    });
    await act(async () => {
      await startPromise;
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ currentConversationTitle: 'Newer storage progress', done: 2 });
  });

  it('does not let an older running poll revive state after a terminal storage event has already settled', async () => {
    const terminal = notionTerminalJob();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ currentConversationTitle: 'Before terminal' }),
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();
    const oldPoll = deferred<any>();
    getNotionSyncJobStatus
      .mockImplementationOnce(() => oldPoll.promise)
      .mockResolvedValueOnce({ provider: 'notion', active: false, job: terminal, instanceId: 'notion-test' });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
    });
    expect(getNotionSyncJobStatus).toHaveBeenCalledTimes(1);

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: terminal } });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });

    oldPoll.resolve({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ currentConversationTitle: 'Stale running poll' }),
      instanceId: 'notion-test',
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
  });

  it('does not let a non-current terminal storage event replace the visible durable terminal', async () => {
    const notionTerminal = notionTerminalJob({ id: 'notion-visible' });
    const githubTerminal = githubJob({
      id: 'github-hidden',
      status: 'done',
      finishedAt: Date.now(),
      currentConversationId: undefined,
      currentConversationTitle: '',
      currentStage: 'done',
      okCount: 1,
    });
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: notionTerminal,
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.github]: { newValue: githubTerminal } });

    expectStatusGetterCalls({});
    expect(latestFeedback?.feedback.summary?.jobId).toBe('notion-visible');
    expect(latestFeedback?.feedback.provider).toBe('notion');
  });

  it('lets a non-current running durable event supersede an old visible terminal without a status read', async () => {
    const terminal = notionTerminalJob({ id: 'notion-old-terminal' });
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.github]: { newValue: githubJob({ currentConversationTitle: 'New GitHub run' }) },
    });

    expectStatusGetterCalls({});
    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'github',
      phase: 'running',
      currentConversationTitle: 'New GitHub run',
    });
  });

  it('hands off a cleared visible terminal to a surviving active provider and keeps the same storage subscription', async () => {
    const terminal = notionTerminalJob();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await renderFeedbackProbe();
    const listener = storageEventMocks.listener;
    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: null,
      instanceId: 'notion-test',
    });
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: true,
      job: githubJob({ currentConversationTitle: 'Surviving after clear' }),
      instanceId: 'github-test',
    });

    await emitStorageChanges({ [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: null } });

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'github',
      phase: 'running',
      currentConversationTitle: 'Surviving after clear',
    });
    expect(storageEventMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(storageEventMocks.unsubscribe).not.toHaveBeenCalled();
    expect(storageEventMocks.listener).toBe(listener);
  });

  it('keeps polling through active=true with a terminal job and only exposes terminal after a later inactive observation', async () => {
    const terminal = notionTerminalJob();
    await renderFeedbackProbe();
    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: { newValue: notionRunningJob({ currentConversationTitle: 'Live progress' }) },
    });
    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      job: terminal,
      instanceId: 'notion-test',
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
    });
    expectStatusGetterCalls({ notion: 1 });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'running', summary: null });

    clearStatusGetterCalls();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      job: terminal,
      instanceId: 'notion-test',
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'success' });
  });

  it.each([
    ['notion', syncNotionConversations, getNotionSyncJobStatus],
    ['obsidian', syncObsidianConversations, getObsidianSyncStatus],
    ['feishu', syncFeishuConversations, getFeishuSyncStatus],
    ['github', syncGithubConversations, getGithubSyncStatus],
  ] as const)(
    'attaches %s conflict with only the target status read even before durable progress exists',
    async (provider, starter, getter) => {
      const conflict: any = new Error('sync already in progress');
      conflict.code = 'sync_already_running';
      conflict.extra = { code: 'sync_already_running' };
      starter.mockRejectedValue(conflict);
      getter.mockResolvedValue({ provider, active: true, job: null, instanceId: `${provider}-test` });
      await renderFeedbackProbe();
      clearStatusGetterCalls();

      await act(async () => {
        await latestFeedback!.startSync(provider, [11]);
        await flushMicrotasks();
      });

      expectStatusGetterCalls({ [provider]: 1 });
      expect(latestFeedback?.feedback).toMatchObject({ provider, phase: 'running', summary: null });
    },
  );

  it('drops an older initial full-scan response after a newer durable storage observation arrives', async () => {
    const oldMountRead = deferred<any>();
    getNotionSyncJobStatus.mockImplementationOnce(() => oldMountRead.promise);
    await renderFeedbackProbe();
    expect(storageEventMocks.listener).toBeTruthy();

    await emitStorageChanges({
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        newValue: notionRunningJob({ totalCount: 3, okCount: 2, currentConversationTitle: 'Durable wins' }),
      },
    });
    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      done: 2,
      currentConversationTitle: 'Durable wins',
    });

    oldMountRead.resolve({
      provider: 'notion',
      active: true,
      job: notionRunningJob({ totalCount: 3, okCount: 0, currentConversationTitle: 'Stale mount' }),
      instanceId: 'old-mount',
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ done: 2, currentConversationTitle: 'Durable wins' });
  });

  it('settles a known-provider ACK when its targeted status proves the durable running job is only residue', async () => {
    syncGithubConversations.mockResolvedValue({ provider: 'github', started: true });
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: false,
      job: githubJob({ currentConversationTitle: 'Ownerless residue' }),
      instanceId: 'github-test',
    });
    await renderFeedbackProbe();
    clearStatusGetterCalls();

    await act(async () => {
      await latestFeedback!.startSync('github', [11]);
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(getGithubSyncStatus).toHaveBeenCalledTimes(2);
    expect(getNotionSyncJobStatus).toHaveBeenCalledTimes(1);
    expect(getObsidianSyncStatus).toHaveBeenCalledTimes(1);
    expect(getFeishuSyncStatus).toHaveBeenCalledTimes(1);
    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
  });

  it('shows running progress and then success summary', async () => {
    const run = deferred<any>();
    syncNotionConversations.mockImplementation(() => run.promise);
    await renderPane();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: null,
    });
    selectFirstConversation();
    clickNotionButton();

    const optimisticNotice = document.getElementById('conversationSyncFeedback');
    expect(optimisticNotice).toBeTruthy();
    expect(optimisticNotice?.getAttribute('data-phase')).toBe('running');
    expect(optimisticNotice?.textContent).toContain(t('syncStagePreparingQueue'));
    expect(optimisticNotice?.textContent).not.toContain(`${t('conversationLabel')} #11`);
    expect(optimisticNotice?.textContent).not.toContain(t('currentPrefix'));

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob(),
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).toContain(t('currentPrefix'));
    expect(runningNotice?.textContent).toContain('Current sync target');
    expect(runningNotice?.textContent).toContain(t('stagePrefix'));
    expect(runningNotice?.textContent).toContain(t('syncStageUploadingMessageBlocks'));
    expect(runningNotice?.textContent).not.toContain(`${t('providerNotion')} ${t('phaseRunning').toLowerCase()} 1/2`);

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: {
        provider: 'notion',
        status: 'done',
        startedAt: Date.now() - 500,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        conversationIds: [11, 22],
        okCount: 2,
        failCount: 0,
        perConversation: [
          { conversationId: 11, ok: true, mode: 'appended', appended: 3, error: '', at: Date.now() },
          { conversationId: 22, ok: true, mode: 'created', appended: 4, error: '', at: Date.now() },
        ],
      },
    });

    await act(async () => {
      run.resolve({
        provider: 'notion',
        okCount: 2,
        failCount: 0,
        failures: [],
        results: [
          { conversationId: 11, ok: true, mode: 'appended', appended: 3, error: '', at: Date.now() },
          { conversationId: 22, ok: true, mode: 'created', appended: 4, error: '', at: Date.now() },
        ],
        jobId: 'job-success',
        instanceId: 'notion-test',
      });
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const successNotice = document.getElementById('conversationSyncFeedback');
    expect(successNotice).toBeTruthy();
    expect(successNotice?.getAttribute('data-phase')).toBe('success');
    expect(successNotice?.textContent).toContain(t('providerNotion'));
    expect(successNotice?.textContent).toContain(t('phaseSuccess'));
    expect(successNotice?.textContent).toContain('2/2');
  });

  it('hydrates an existing running notion job on mount', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob(),
    });
    await renderPane();

    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).toContain(t('currentPrefix'));
    expect(runningNotice?.textContent).toContain('Current sync target');
    expect(runningNotice?.textContent).toContain(t('stagePrefix'));
    expect(runningNotice?.textContent).toContain(t('syncStageUploadingMessageBlocks'));
    expect(runningNotice?.textContent).not.toContain(`${t('providerNotion')} ${t('phaseRunning').toLowerCase()} 1/2`);

    const notionButton = Array.from(document.querySelectorAll('button')).find((el) =>
      el.textContent?.trim().startsWith('Notion'),
    ) as HTMLButtonElement | undefined;
    expect(notionButton?.disabled).toBe(true);
  });

  it('hydrates compact running progress from totalCount without durable queue or result rows', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob({
        totalCount: 5,
        conversationIds: [],
        currentConversationId: 22,
        okCount: 2,
        failCount: 1,
        perConversation: [],
      }),
    });

    await renderFeedbackProbe();

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      total: 5,
      done: 3,
      currentConversationId: 22,
      currentConversationTitle: 'Current sync target',
    });
  });

  it('does not treat an ownerless durable running snapshot as live feedback', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: notionRunningJob({ updatedAt: Date.now() - 10 * 60_000 }),
    });

    await renderFeedbackProbe();

    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
    expect(latestFeedback?.syncingNotion).toBe(false);
  });

  it('shows generic running feedback when ownership is active before a durable running snapshot exists', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: null,
    });

    await renderFeedbackProbe();

    expect(latestFeedback?.feedback).toMatchObject({
      provider: 'notion',
      phase: 'running',
      total: 0,
      done: 0,
      currentConversationId: null,
      currentConversationTitle: '',
      currentStage: '',
    });
    expect(latestFeedback?.syncingNotion).toBe(true);
  });

  it('keeps a terminal snapshot non-dismissible while ownership is active and exposes it only after settle', async () => {
    const terminalJob = {
      provider: 'notion',
      status: 'done',
      startedAt: Date.now() - 500,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      conversationIds: [11],
      okCount: 1,
      failCount: 0,
      perConversation: [
        {
          conversationId: 11,
          conversationTitle: 'Sync feedback chat',
          ok: true,
          mode: 'created',
          appended: 1,
          error: '',
          at: Date.now(),
        },
      ],
    };
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: terminalJob,
    });

    await renderPane();
    expect(document.getElementById('conversationSyncFeedback')?.getAttribute('data-phase')).toBe('running');
    expect(document.querySelector('[aria-label="Dismiss sync feedback"]')).toBeNull();

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: terminalJob,
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(document.getElementById('conversationSyncFeedback')?.getAttribute('data-phase')).toBe('success');
    clickDismissButton();
    await act(async () => {
      await flushMicrotasks();
    });
    expect(clearNotionSyncJobStatus).toHaveBeenCalledTimes(1);
  });

  it('preserves a live provider across status read rejection and settles only after a trusted inactive observation', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob(),
    });
    await renderFeedbackProbe();
    expect(latestFeedback?.feedback.phase).toBe('running');

    getNotionSyncJobStatus.mockRejectedValue(new Error('status unavailable'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'running' });
    expect(latestFeedback?.syncingNotion).toBe(true);

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: null,
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: null, phase: 'idle' });
    expect(latestFeedback?.syncingNotion).toBe(false);
  });

  it('drops an older mount observation after a local start failure advances the observation generation', async () => {
    const staleMount = deferred<any>();
    getNotionSyncJobStatus.mockImplementationOnce(() => staleMount.promise);
    syncNotionConversations.mockRejectedValue(new Error('notion not connected'));

    await renderFeedbackProbe();
    await act(async () => {
      await expect(latestFeedback!.startSync('notion', [11])).rejects.toThrow('notion not connected');
      await flushMicrotasks();
    });
    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'failed', summary: null });

    staleMount.resolve({
      provider: 'notion',
      active: true,
      instanceId: 'stale-mount',
      job: notionRunningJob({ id: 'stale-running' }),
    });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestFeedback?.feedback).toMatchObject({ provider: 'notion', phase: 'failed', summary: null });
    expect(latestFeedback?.syncingNotion).toBe(false);
  });

  it('hydrates a reload-aborted notion job instead of keeping the running progress visible', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: {
        provider: 'notion',
        status: 'aborted',
        startedAt: Date.now() - 2_000,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        conversationIds: [11, 22],
        currentConversationId: 22,
        currentConversationTitle: 'Current sync target',
        currentStage: 'ensuring_database',
        okCount: 0,
        failCount: 0,
        perConversation: [],
        abortedReason: 'extension reloaded',
      },
    });
    await renderPane();

    const notice = document.getElementById('conversationSyncFeedback');
    expect(notice).toBeTruthy();
    expect(notice?.getAttribute('data-phase')).toBe('failed');
    expect(notice?.textContent).toContain(t('syncStopped'));
    expect(notice?.textContent).toContain('extension reloaded');
    expect(notice?.textContent).not.toContain(t('syncStageEnsuringDatabase'));

    const dismissButton = document.querySelector('[aria-label="Dismiss sync feedback"]') as HTMLButtonElement | null;
    expect(dismissButton?.disabled).not.toBe(true);
  });

  it('attaches to a live notion run after the starter returns structured sync_already_running', async () => {
    const conflict: any = new Error('sync already in progress');
    conflict.code = 'sync_already_running';
    conflict.extra = { code: 'sync_already_running' };
    syncNotionConversations.mockRejectedValue(conflict);

    await renderPane();
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob(),
    });

    selectFirstConversation();
    clickNotionButton();

    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(syncNotionConversations).toHaveBeenCalledTimes(1);
    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).not.toContain('sync already in progress');
    expect(runningNotice?.textContent).toContain(t('currentPrefix'));
    expect(runningNotice?.textContent).toContain('Current sync target');
    expect(runningNotice?.textContent).toContain(t('stagePrefix'));
    expect(runningNotice?.textContent).toContain(t('syncStageUploadingMessageBlocks'));
  });

  it('hydrates persisted terminal feedback and clears the persisted job on dismiss', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: {
        provider: 'notion',
        status: 'done',
        startedAt: Date.now() - 800,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        conversationIds: [11],
        okCount: 0,
        failCount: 1,
        perConversation: [
          {
            conversationId: 11,
            conversationTitle: 'Sync feedback chat',
            ok: false,
            mode: 'failed',
            appended: 0,
            error: 'missing parentPageId',
            at: Date.now(),
          },
        ],
      },
    });

    await renderPane();

    const failureNotice = document.getElementById('conversationSyncFeedback');
    expect(failureNotice).toBeTruthy();
    expect(failureNotice?.getAttribute('data-phase')).toBe('failed');
    expect(failureNotice?.textContent).toContain(t('providerNotion'));
    expect(failureNotice?.textContent).toContain(t('phaseFailed'));
    expect(failureNotice?.textContent).toContain('1/1');
    expect(failureNotice?.textContent).not.toContain('missing parentPageId');

    clickOpenDetailsButton();

    const details = document.querySelector('[aria-label="Notion sync details"]');
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain('Sync feedback chat');
    expect(details?.textContent).not.toContain('Conversation #11');
    expect(details?.textContent).toContain('missing parentPageId');

    clickDismissButton();

    await act(async () => {
      await flushMicrotasks();
    });

    expect(clearNotionSyncJobStatus).toHaveBeenCalledTimes(1);
  });

  it('shows warnings inside the details popover without failing the overall sync', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: false,
      instanceId: 'notion-test',
      job: {
        provider: 'notion',
        status: 'done',
        startedAt: Date.now() - 800,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        conversationIds: [11],
        okCount: 1,
        failCount: 0,
        perConversation: [
          {
            conversationId: 11,
            conversationTitle: 'Sync feedback chat',
            ok: true,
            mode: 'created',
            appended: 1,
            error: '',
            warnings: [{ code: 'notion_image_upload_degraded', message: 'Some images could not be uploaded.' }],
            at: Date.now(),
          },
        ],
      },
    });

    await renderPane();

    const notice = document.getElementById('conversationSyncFeedback');
    expect(notice).toBeTruthy();
    expect(notice?.getAttribute('data-phase')).toBe('success');

    clickOpenDetailsButton();
    const details = document.querySelector('[aria-label="Notion sync details"]');
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain('Warnings');
    expect(details?.textContent).toContain('Sync feedback chat');
    expect(details?.textContent).toContain('Some images could not be uploaded.');
  });

  it('shows direct preflight failure without fake progress counters', async () => {
    const alertSpy = vi.fn();
    Object.defineProperty(globalThis, 'alert', { configurable: true, value: alertSpy });

    syncNotionConversations.mockRejectedValue(new Error('notion not connected'));

    await renderPane();
    selectFirstConversation();
    clickNotionButton();

    await act(async () => {
      await flushMicrotasks();
    });

    const failureNotice = document.getElementById('conversationSyncFeedback');
    expect(failureNotice).toBeTruthy();
    expect(failureNotice?.getAttribute('data-phase')).toBe('failed');
    expect(failureNotice?.textContent).toContain(t('providerNotion'));
    expect(failureNotice?.textContent).toContain(t('phaseFailed'));
    expect(failureNotice?.textContent).toContain('notion not connected');
    expect(failureNotice?.textContent).not.toContain('0/1');
    expect(failureNotice?.textContent).not.toContain('#?:');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('localizes sync_provider_disabled failures', async () => {
    const error: any = new Error('sync provider disabled');
    error.extra = { code: 'sync_provider_disabled', provider: 'notion' };
    syncNotionConversations.mockRejectedValue(error);

    await renderPane();
    selectFirstConversation();
    clickNotionButton();

    await act(async () => {
      await flushMicrotasks();
    });

    const failureNotice = document.getElementById('conversationSyncFeedback');
    expect(failureNotice).toBeTruthy();
    expect(failureNotice?.getAttribute('data-phase')).toBe('failed');
    expect(failureNotice?.textContent).toContain(t('providerNotion'));
    expect(failureNotice?.textContent).toContain(t('phaseFailed'));
    expect(failureNotice?.textContent).toContain(t('syncProviderDisabled'));
    expect(failureNotice?.textContent).not.toContain('sync provider disabled');
  });

  it('hydrates a running GitHub job through the shared feedback surface', async () => {
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: true,
      instanceId: 'github-test',
      job: githubJob(),
    });

    await renderPane();

    const notice = document.getElementById('conversationSyncFeedback');
    expect(notice).toBeTruthy();
    expect(notice?.getAttribute('data-phase')).toBe('running');
    expect(notice?.textContent).toContain(t('providerGithub'));
    expect(notice?.textContent).toContain('GitHub sync target');
    expect(notice?.textContent).toContain('committing_tree');
  });

  it('hydrates a successful GitHub terminal job through the shared feedback surface', async () => {
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: false,
      instanceId: 'github-test',
      job: githubJob({
        status: 'done',
        finishedAt: Date.now(),
        currentConversationId: undefined,
        currentConversationTitle: '',
        currentStage: 'done',
        okCount: 1,
        perConversation: [{ conversationId: 11, ok: true, mode: 'synced', appended: 0, error: '', at: Date.now() }],
      }),
    });
    await renderPane();

    const notice = document.getElementById('conversationSyncFeedback');
    expect(notice?.getAttribute('data-phase')).toBe('success');
    expect(notice?.textContent).toContain(t('providerGithub'));
  });

  it('hydrates a failed GitHub terminal job and clears the GitHub job on dismiss', async () => {
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: false,
      instanceId: 'github-test',
      job: githubJob({
        status: 'done',
        finishedAt: Date.now(),
        currentConversationId: undefined,
        currentConversationTitle: '',
        currentStage: 'done',
        okCount: 0,
        failCount: 1,
        perConversation: [
          {
            conversationId: 11,
            conversationTitle: 'GitHub sync target',
            ok: false,
            mode: 'failed',
            appended: 0,
            error: 'github_repository_unavailable',
            at: Date.now(),
          },
        ],
      }),
    });
    await renderPane();

    const notice = document.getElementById('conversationSyncFeedback');
    expect(notice?.getAttribute('data-phase')).toBe('failed');
    expect(notice?.textContent).toContain(t('providerGithub'));

    clickDismissButton();
    await act(async () => {
      await flushMicrotasks();
    });
    expect(clearGithubSyncStatus).toHaveBeenCalledTimes(1);
  });

  it('dispatches the translated GitHub menu item through the production context callback', async () => {
    syncGithubConversations.mockResolvedValue({ provider: 'github', started: true });
    await renderPane();
    selectFirstConversation();

    const syncMenuButton = document.getElementById('btnSyncTo') as HTMLButtonElement | null;
    expect(syncMenuButton).toBeTruthy();
    await act(async () => {
      syncMenuButton!.click();
      await flushMicrotasks();
    });

    const githubMenuItem = document.getElementById('menuSyncToGithub') as HTMLButtonElement | null;
    expect(githubMenuItem).toBeTruthy();
    expect(githubMenuItem?.textContent).toBe(t('githubSync'));
    expect(githubMenuItem?.textContent).toBe(t('providerGithub'));

    await act(async () => {
      githubMenuItem!.click();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(syncGithubConversations).toHaveBeenCalledWith([11]);
  });

  it('keeps GitHub as the preferred provider when another running job is newer', async () => {
    await renderAppProbe();
    syncGithubConversations.mockResolvedValue({ provider: 'github', started: true });
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      active: true,
      instanceId: 'notion-test',
      job: notionRunningJob({ updatedAt: Date.now() + 10_000 }),
    });
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
      active: true,
      instanceId: 'github-test',
      job: githubJob({ updatedAt: Date.now() }),
    });

    await act(async () => {
      latestApp!.toggleSelected(11);
      await flushMicrotasks();
    });
    await act(async () => {
      await latestApp!.syncSelectedGithub();
      await flushMicrotasks();
    });

    expect(syncGithubConversations).toHaveBeenCalledWith([11]);
    expect(latestApp!.syncFeedback.provider).toBe('github');
    expect(latestApp!.syncingGithub).toBe(true);
  });

  it('rejects a synthetic unknown provider without falling back to the Notion starter', async () => {
    await renderFeedbackProbe();

    await expect((latestFeedback!.startSync as any)('future-provider', [11])).rejects.toThrow(
      'unsupported sync provider: future-provider',
    );

    expect(syncNotionConversations).not.toHaveBeenCalled();
    expect(syncObsidianConversations).not.toHaveBeenCalled();
    expect(syncFeishuConversations).not.toHaveBeenCalled();
    expect(syncGithubConversations).not.toHaveBeenCalled();
  });
});
