import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({ send: vi.fn() }));
const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  onChanged: vi.fn(),
}));
const insightSourceMocks = vi.hoisted(() => ({ get: vi.fn() }));
const revisionMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  ready: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@services/shared/runtime', () => ({ send: runtimeMocks.send }));
vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
  storageRemove: storageMocks.remove,
  storageOnChanged: storageMocks.onChanged,
}));
vi.mock('@services/sync/sync-provider-gate', () => ({
  setSyncProviderEnabled: vi.fn(async () => {}),
  syncProviderEnabledStorageKey: (id: string) => `webclipper_sync_provider_${id}_enabled`,
}));
vi.mock('@services/integrations/anti-hotlink/anti-hotlink-settings', () => ({
  ANTI_HOTLINK_RULES_SETTINGS_STORAGE_KEY: 'anti_hotlink_rules_v1',
  getDefaultAntiHotlinkRulesForSettings: () => [],
  loadAntiHotlinkRulesForSettings: async () => [],
  resetAntiHotlinkRulesForSettings: async () => [],
  saveAntiHotlinkRulesForSettings: async () => [],
}));
vi.mock('@services/sync/feishu/settings-store', () => ({
  FEISHU_DEFAULTS: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
  FEISHU_STORAGE_KEYS: {
    chatFolder: 'feishu_chat_folder',
    articleFolder: 'feishu_article_folder',
    videoFolder: 'feishu_video_folder',
  },
  getFeishuPathConfig: async () => ({ chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' }),
  normalizeFeishuFolderPath: (value: unknown, fallback: string) => String(value || fallback),
  saveFeishuPathConfig: async (value: any) => value,
}));
vi.mock('@services/insight/insight-stats-source', () => ({
  getInsightStatsSourceData: () => insightSourceMocks.get(),
}));
vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (listener: (scopes: readonly string[]) => void) => revisionMocks.subscribe(listener),
  whenDataRevisionObserverReady: () => revisionMocks.ready(),
  requestDataRevisionRetry: (scopes: readonly string[]) => revisionMocks.retry(scopes),
}));
vi.mock('@i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@i18n')>()),
  getCurrentLocale: () => 'en',
  getLocalePreference: () => 'system',
  saveLocalePreference: async (value: any) => value,
  t: (key: string) => key,
}));

import { useSettingsSceneController } from '@viewmodels/settings/useSettingsSceneController';

type Snapshot = ReturnType<typeof useSettingsSceneController>;
type SettingsSection = Parameters<typeof useSettingsSceneController>[0]['activeSection'];

type InsightSource = {
  conversations: any[];
  messageCounts: Map<number, number>;
  commentCounts: Map<number, number>;
};

let latestSnapshot: Snapshot | null = null;
let statusHistory: string[] = [];
let root: ReactDOM.Root | null = null;
let dom: JSDOM | null = null;
let revisionListener: ((scopes: readonly string[]) => void) | null = null;
let revisionUnsubscribe: ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ok(data: any) {
  return { ok: true, data, error: null };
}

function chat(id: number, capturedAt = Date.now()) {
  return {
    id,
    sourceType: 'chat',
    source: 'chatgpt',
    conversationKey: `chat-${id}`,
    title: `Chat ${id}`,
    lastCapturedAt: capturedAt,
  };
}

function source(conversations: any[] = [], messageCounts: Array<[number, number]> = []): InsightSource {
  return {
    conversations,
    messageCounts: new Map(messageCounts),
    commentCounts: new Map(),
  };
}

function Harness({ activeSection }: { activeSection: SettingsSection }) {
  const snapshot = useSettingsSceneController({ activeSection });
  useEffect(() => {
    latestSnapshot = snapshot;
    const status = snapshot.insightLoadStatus;
    if (statusHistory.at(-1) !== status) statusHistory.push(status);
  }, [snapshot]);
  return null;
}

function setupDom() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/settings',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  root = ReactDOM.createRoot(document.getElementById('root')!);
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).location;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  dom?.window.close();
  dom = null;
}

async function flushReact() {
  await act(async () => {
    for (let index = 0; index < 24; index += 1) await Promise.resolve();
  });
}

async function renderController(activeSection: SettingsSection) {
  act(() => {
    root!.render(createElement(Harness, { activeSection }));
  });
  await flushReact();
}

async function rerenderController(activeSection: SettingsSection) {
  act(() => {
    root!.render(createElement(Harness, { activeSection }));
  });
  await flushReact();
}

beforeEach(() => {
  vi.clearAllMocks();
  latestSnapshot = null;
  statusHistory = [];
  revisionListener = null;
  revisionUnsubscribe = vi.fn();

  storageMocks.get.mockImplementation(async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, undefined])));
  storageMocks.set.mockResolvedValue(undefined);
  storageMocks.remove.mockResolvedValue(undefined);
  storageMocks.onChanged.mockImplementation(() => () => {});

  runtimeMocks.send.mockImplementation(async (type: string) => {
    if (type === 'getNotionAuthStatus') return ok({ connected: false });
    if (type === 'getFeishuAuthStatus') return ok({ connected: false });
    if (type === 'obsidianGetSettings') {
      return ok({
        apiBaseUrl: '',
        authHeaderName: '',
        apiKeyPresent: false,
        apiKeyMasked: '',
        chatFolder: '',
        articleFolder: '',
        videoFolder: '',
      });
    }
    if (type === 'githubGetSettings') {
      return ok({
        provider: 'github',
        settings: { repository: '', branch: '', defaults: { repository: '', branch: '' } },
        auth: { state: 'disconnected' },
        app: { verificationUrl: '', appUrl: '', installUrl: '' },
      });
    }
    return { ok: false, data: null, error: { message: `unexpected message: ${type}`, extra: null } };
  });

  revisionMocks.subscribe.mockImplementation((listener: (scopes: readonly string[]) => void) => {
    revisionListener = listener;
    return revisionUnsubscribe;
  });
  revisionMocks.ready.mockResolvedValue({ baselineAvailable: true });
  revisionMocks.retry.mockReset();
  insightSourceMocks.get.mockReset();
  insightSourceMocks.get.mockResolvedValue(source([chat(1)], [[1, 2]]));

  setupDom();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });
  }
  root = null;
  cleanupDom();
});

describe('Settings controller Insight revision lifecycle', () => {
  it('subscribes before the first source read and runs one idle -> loading -> ready transition after degraded readiness', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    const firstRead = deferred<InsightSource>();
    revisionMocks.ready.mockReturnValue(readiness.promise);
    insightSourceMocks.get.mockReturnValue(firstRead.promise);

    await renderController('aboutyou');
    expect(revisionMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(insightSourceMocks.get).not.toHaveBeenCalled();
    expect(latestSnapshot?.insightLoadStatus).toBe('idle');

    await act(async () => {
      readiness.resolve({ baselineAvailable: false });
      await Promise.resolve();
    });
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(1);
    expect(latestSnapshot?.insightLoadStatus).toBe('loading');

    await act(async () => {
      firstRead.resolve(source([chat(1)], [[1, 2]]));
      await firstRead.promise;
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(latestSnapshot?.insightLoadStatus, latestSnapshot?.insightError).toBe('ready');
    expect(latestSnapshot?.insightStats?.totalClips).toBe(1);
    expect(statusHistory).toEqual(['idle', 'loading', 'ready']);
  });

  it('keeps readiness and revisions side-effect free while inactive, then fresh-reads once on entry', async () => {
    await renderController('general');
    expect(insightSourceMocks.get).not.toHaveBeenCalled();

    act(() => {
      revisionListener?.(['conversations', 'messages', 'article_comments']);
    });
    await flushReact();
    expect(insightSourceMocks.get).not.toHaveBeenCalled();

    await rerenderController('aboutyou');
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(1);
    expect(latestSnapshot?.insightLoadStatus).toBe('ready');
  });

  it('coalesces revisions received during an active source read into one latest-generation trailing read', async () => {
    await renderController('aboutyou');
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(1);

    const staleRead = deferred<InsightSource>();
    insightSourceMocks.get.mockReturnValueOnce(staleRead.promise).mockResolvedValueOnce(source([chat(2), chat(3)]));

    act(() => revisionListener?.(['conversations']));
    await flushReact();
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(2);

    act(() => {
      revisionListener?.(['messages']);
      revisionListener?.(['article_comments']);
    });
    await flushReact();
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(2);

    await act(async () => {
      staleRead.resolve(source([chat(99)]));
      await staleRead.promise;
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });

    expect(insightSourceMocks.get).toHaveBeenCalledTimes(3);
    expect(latestSnapshot?.insightStats?.totalClips).toBe(2);
    expect(latestSnapshot?.insightLoadStatus).toBe('ready');
    expect(revisionMocks.retry).not.toHaveBeenCalled();
  });

  it('preserves last-good stats on a current reject, requests scoped replay, and converges on same-revision retry', async () => {
    await renderController('aboutyou');
    expect(latestSnapshot?.insightStats?.totalClips).toBe(1);
    revisionMocks.retry.mockClear();

    insightSourceMocks.get.mockRejectedValueOnce(new Error('insight source unavailable'));
    act(() => revisionListener?.(['messages']));
    await flushReact();

    expect(insightSourceMocks.get).toHaveBeenCalledTimes(2);
    expect(latestSnapshot?.insightLoadStatus).toBe('error');
    expect(latestSnapshot?.insightStats?.totalClips).toBe(1);
    expect(revisionMocks.retry).toHaveBeenCalledWith(['messages']);

    await flushReact();
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(2);

    revisionMocks.retry.mockClear();
    insightSourceMocks.get.mockResolvedValueOnce(source([chat(1), chat(2)]));
    act(() => revisionListener?.(['messages']));
    await flushReact();

    expect(insightSourceMocks.get).toHaveBeenCalledTimes(3);
    expect(latestSnapshot?.insightLoadStatus).toBe('ready');
    expect(latestSnapshot?.insightStats?.totalClips).toBe(2);
    expect(revisionMocks.retry).not.toHaveBeenCalled();
  });

  it('drops an in-flight reject after the section becomes inactive and rereads fresh on re-entry without retrying', async () => {
    await renderController('aboutyou');
    const staleRead = deferred<InsightSource>();
    insightSourceMocks.get.mockReturnValueOnce(staleRead.promise).mockResolvedValueOnce(source([chat(2), chat(3)]));
    revisionMocks.retry.mockClear();

    act(() => revisionListener?.(['conversations']));
    await flushReact();
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(2);

    await rerenderController('general');
    await act(async () => {
      staleRead.reject(new Error('late inactive failure'));
      try {
        await staleRead.promise;
      } catch (_error) {}
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(revisionMocks.retry).not.toHaveBeenCalled();
    expect(latestSnapshot?.insightStats?.totalClips).toBe(1);

    await rerenderController('aboutyou');
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(3);
    expect(latestSnapshot?.insightStats?.totalClips).toBe(2);
    expect(latestSnapshot?.insightLoadStatus).toBe('ready');
  });

  it('treats an authoritative empty source as success without a retry loop', async () => {
    await renderController('aboutyou');
    revisionMocks.retry.mockClear();
    insightSourceMocks.get.mockResolvedValueOnce(source([]));

    act(() => revisionListener?.(['article_comments']));
    await flushReact();

    expect(latestSnapshot?.insightLoadStatus).toBe('ready');
    expect(latestSnapshot?.insightStats?.totalClips).toBe(0);
    expect(revisionMocks.retry).not.toHaveBeenCalled();
  });

  it('recomputes range from a fresh source without another source read', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    insightSourceMocks.get.mockResolvedValue(source([chat(1, now), chat(2, now - 10 * day)]));
    await renderController('aboutyou');

    expect(latestSnapshot?.insightRange).toBe('7d');
    expect(latestSnapshot?.insightStats?.totalClips).toBe(1);
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(1);

    act(() => latestSnapshot?.setInsightRange('all'));
    await flushReact();

    expect(latestSnapshot?.insightStats?.totalClips).toBe(2);
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes before a pending readiness can start a late source read', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    revisionMocks.ready.mockReturnValue(readiness.promise);
    await renderController('aboutyou');
    expect(insightSourceMocks.get).not.toHaveBeenCalled();

    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;
    readiness.resolve({ baselineAvailable: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(insightSourceMocks.get).not.toHaveBeenCalled();
    expect(revisionMocks.retry).not.toHaveBeenCalled();
  });

  it('drops a pending source rejection after dispose without retrying', async () => {
    const pendingRead = deferred<InsightSource>();
    insightSourceMocks.get.mockReturnValue(pendingRead.promise);
    await renderController('aboutyou');
    expect(insightSourceMocks.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;
    pendingRead.reject(new Error('late dispose failure'));
    try {
      await pendingRead.promise;
    } catch (_error) {}
    await Promise.resolve();
    await Promise.resolve();

    expect(revisionMocks.retry).not.toHaveBeenCalled();
  });
});
