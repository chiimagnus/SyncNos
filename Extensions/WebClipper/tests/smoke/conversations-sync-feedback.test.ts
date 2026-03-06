import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsProvider } from '../../src/ui/conversations/conversations-context';
import { ConversationListPane } from '../../src/ui/conversations/ConversationListPane';

const listConversations = vi.fn();
const getConversationDetail = vi.fn();
const deleteConversations = vi.fn();
const syncNotionConversations = vi.fn();
const syncObsidianConversations = vi.fn();
const clearNotionSyncJobStatus = vi.fn();
const clearObsidianSyncStatus = vi.fn();
const getNotionSyncJobStatus = vi.fn();
const getObsidianSyncStatus = vi.fn();

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

vi.mock('../../src/conversations/client/repo', () => ({
  listConversations: (...args: any[]) => listConversations(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
}));

vi.mock('../../src/sync/repo', () => ({
  clearNotionSyncJobStatus: (...args: any[]) => clearNotionSyncJobStatus(...args),
  clearObsidianSyncStatus: (...args: any[]) => clearObsidianSyncStatus(...args),
  syncNotionConversations: (...args: any[]) => syncNotionConversations(...args),
  syncObsidianConversations: (...args: any[]) => syncObsidianConversations(...args),
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

  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);

    listConversations.mockReset();
    getConversationDetail.mockReset();
    deleteConversations.mockReset();
    syncNotionConversations.mockReset();
    syncObsidianConversations.mockReset();
    clearNotionSyncJobStatus.mockReset();
    clearObsidianSyncStatus.mockReset();
    getNotionSyncJobStatus.mockReset();
    getObsidianSyncStatus.mockReset();

    listConversations.mockResolvedValue([baseConversation]);
    getConversationDetail.mockResolvedValue({ id: 11, messages: [] });
    deleteConversations.mockResolvedValue(null);
    clearNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', job: null, instanceId: 'notion-test' });
    clearObsidianSyncStatus.mockResolvedValue({ provider: 'obsidian', job: null, instanceId: 'obsidian-test' });
    getNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', job: null, instanceId: 'notion-test' });
    getObsidianSyncStatus.mockResolvedValue({ provider: 'obsidian', job: null, instanceId: 'obsidian-test' });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.useRealTimers();
    cleanupDom();
  });

  async function renderPane() {
    await act(async () => {
      root!.render(
        createElement(ConversationsProvider, null, createElement(ConversationListPane)),
      );
      await flushMicrotasks();
    });
  }

  function selectFirstConversation() {
    const checkbox = document.querySelector('[data-conversation-id="11"] input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    act(() => {
      checkbox!.click();
    });
  }

  function clickNotionButton() {
    const button = Array.from(document.querySelectorAll('button')).find((el) => el.textContent?.trim().startsWith('Notion')) as HTMLButtonElement | undefined;
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

  function notionRunningJob(overrides: Record<string, unknown> = {}) {
    return {
      provider: 'notion',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      conversationIds: [11, 22],
      okCount: 1,
      failCount: 0,
      perConversation: [{ conversationId: 11, ok: true, mode: 'appended', appended: 3, error: '', at: Date.now() }],
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

    getNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', instanceId: 'notion-test', job: notionRunningJob() });

    await act(async () => {
      await flushMicrotasks();
    });

    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).toContain('Notion syncing 1/2');

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
    expect(successNotice?.textContent).toContain('Notion sync completed (2/2)');
  });

  it('hydrates an existing running notion job on mount', async () => {
    getNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', instanceId: 'notion-test', job: notionRunningJob() });
    await renderPane();

    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).toContain('Notion syncing 1/2');

    const notionButton = Array.from(document.querySelectorAll('button')).find((el) => el.textContent?.trim().startsWith('Notion')) as HTMLButtonElement | undefined;
    expect(notionButton?.disabled).toBe(true);
  });

  it('attaches to the existing running notion job instead of showing sync already in progress as failure', async () => {
    syncNotionConversations.mockRejectedValue(new Error('sync already in progress'));
    getNotionSyncJobStatus.mockResolvedValue({ provider: 'notion', instanceId: 'notion-test', job: notionRunningJob() });

    await renderPane();
    selectFirstConversation();
    clickNotionButton();

    await act(async () => {
      await flushMicrotasks();
    });

    const runningNotice = document.getElementById('conversationSyncFeedback');
    expect(runningNotice).toBeTruthy();
    expect(runningNotice?.getAttribute('data-phase')).toBe('running');
    expect(runningNotice?.textContent).toContain('Notion syncing 1/2');
    expect(runningNotice?.textContent).not.toContain('sync already in progress');
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
          { conversationId: 11, ok: false, mode: 'failed', appended: 0, error: 'missing parentPageId', at: Date.now() },
        ],
      },
    });

    await renderPane();

    const failureNotice = document.getElementById('conversationSyncFeedback');
    expect(failureNotice).toBeTruthy();
    expect(failureNotice?.getAttribute('data-phase')).toBe('failed');
    expect(failureNotice?.textContent).toContain('Notion sync failed (1/1)');
    expect(failureNotice?.textContent).toContain('#11: missing parentPageId');

    clickDismissButton();

    await act(async () => {
      await flushMicrotasks();
    });

    expect(clearNotionSyncJobStatus).toHaveBeenCalledTimes(1);
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
    expect(failureNotice?.textContent).toContain('Notion sync failed: notion not connected');
    expect(failureNotice?.textContent).not.toContain('0/1');
    expect(failureNotice?.textContent).not.toContain('#?:');
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
