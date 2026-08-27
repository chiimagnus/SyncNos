import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { t } from '../../src/ui/i18n';
import { ConversationsProvider, useConversationsApp } from '../../src/viewmodels/conversations/conversations-context';
import { useConversationSyncFeedback } from '../../src/viewmodels/conversations/useConversationSyncFeedback';
import { ConversationListPane } from '../../src/ui/conversations/ConversationListPane';

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

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
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
    clearNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', job: null, instanceId: 'notion-test' });
    clearObsidianSyncStatus.mockResolvedValue({ provider: 'obsidian', job: null, instanceId: 'obsidian-test' });
    clearFeishuSyncStatus.mockResolvedValue({ provider: 'feishu', job: null, instanceId: 'feishu-test' });
    clearGithubSyncStatus.mockResolvedValue({ provider: 'github', job: null, instanceId: 'github-test' });
    getNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', job: null, instanceId: 'notion-test' });
    getObsidianSyncStatus.mockResolvedValue({ provider: 'obsidian', job: null, instanceId: 'obsidian-test' });
    getFeishuSyncStatus.mockResolvedValue({ provider: 'feishu', job: null, instanceId: 'feishu-test' });
    getGithubSyncStatus.mockResolvedValue({ provider: 'github', job: null, instanceId: 'github-test' });
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

  it('shows running progress and then success summary', async () => {
    const run = deferred<any>();
    syncNotionConversations.mockImplementation(() => run.promise);
    getNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', instanceId: 'notion-test', job: null });

    await renderPane();
    selectFirstConversation();
    clickNotionButton();

    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      instanceId: 'notion-test',
      job: notionRunningJob(),
    });

    await act(async () => {
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

  it('hydrates a reload-aborted notion job instead of keeping the running progress visible', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
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

  it('attaches to the existing running notion job instead of showing sync already in progress as failure', async () => {
    syncNotionConversations.mockRejectedValue(new Error('sync already in progress'));
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
      instanceId: 'notion-test',
      job: notionRunningJob(),
    });

    await renderPane();
    selectFirstConversation();
    clickNotionButton();

    await act(async () => {
      await flushMicrotasks();
    });

    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).not.toContain('sync already in progress');
    expect(runningNotice?.textContent).toContain(t('currentPrefix'));
    expect(runningNotice?.textContent).toContain('Current sync target');
    expect(runningNotice?.textContent).toContain(t('stagePrefix'));
    expect(runningNotice?.textContent).toContain(t('syncStageUploadingMessageBlocks'));
    expect(runningNotice?.textContent).not.toContain(`${t('providerNotion')} ${t('phaseRunning').toLowerCase()} 1/2`);
  });

  it('hydrates persisted terminal feedback and clears the persisted job on dismiss', async () => {
    getNotionSyncJobStatus.mockResolvedValue({
      provider: 'notion',
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
      instanceId: 'notion-test',
      job: notionRunningJob({ updatedAt: Date.now() + 10_000 }),
    });
    getGithubSyncStatus.mockResolvedValue({
      provider: 'github',
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
