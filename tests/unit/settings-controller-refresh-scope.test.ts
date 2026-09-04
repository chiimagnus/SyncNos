import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FEISHU_MESSAGE_TYPES,
  INPAGE_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
} from '@services/protocols/message-contracts';
import { useSettingsSceneController } from '@viewmodels/settings/useSettingsSceneController';

const runtimeMocks = vi.hoisted(() => ({ send: vi.fn() }));
const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  onChanged: vi.fn(),
}));
const antiHotlinkMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));
const feishuSettingsMocks = vi.hoisted(() => ({
  getPathConfig: vi.fn(),
}));
const feishuClientMocks = vi.hoisted(() => ({ disconnect: vi.fn() }));

vi.mock('@services/shared/runtime', () => ({ send: runtimeMocks.send }));
vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
  storageRemove: storageMocks.remove,
  storageOnChanged: storageMocks.onChanged,
}));
vi.mock('@services/sync/feishu/auth/settings-client', () => ({ disconnectFeishu: feishuClientMocks.disconnect }));
vi.mock('@services/sync/sync-provider-gate', () => ({
  setSyncProviderEnabled: vi.fn(),
  syncProviderEnabledStorageKey: (id: string) => `webclipper_sync_provider_${id}_enabled`,
}));
vi.mock('@services/integrations/anti-hotlink/anti-hotlink-settings', () => ({
  ANTI_HOTLINK_RULES_SETTINGS_STORAGE_KEY: 'anti_hotlink_rules_v1',
  getDefaultAntiHotlinkRulesForSettings: () => [],
  loadAntiHotlinkRulesForSettings: (...args: unknown[]) => antiHotlinkMocks.load(...args),
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
  getFeishuPathConfig: (...args: unknown[]) => feishuSettingsMocks.getPathConfig(...args),
  normalizeFeishuFolderPath: (value: unknown, fallback: string) => String(value || fallback),
  saveFeishuPathConfig: async (value: any) => value,
}));
vi.mock('@i18n', () => ({
  getCurrentLocale: () => 'en',
  getLocalePreference: () => 'system',
  saveLocalePreference: async (value: any) => value,
  t: (key: string) => key,
}));
vi.mock('@viewmodels/settings/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@viewmodels/settings/utils')>();
  return { ...actual, openHttpUrl: vi.fn(() => true) };
});

type Snapshot = ReturnType<typeof useSettingsSceneController>;
type ApiResponse = { ok: boolean; data: any; error: any };
type StorageListener = (changes: any, areaName: string) => void;

const ok = (data: any): ApiResponse => ({ ok: true, data, error: null });

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let latestSnapshot: Snapshot | null = null;
let root: ReactDOM.Root | null = null;
let dom: JSDOM | null = null;
let storageState: Record<string, unknown> = {};
let storageListener: StorageListener | null = null;
let notionStatus = { connected: false, workspaceName: '' };
let feishuStatus = { connected: false };
let notionGetQueue: Array<ApiResponse | Promise<ApiResponse>> = [];
let feishuGetQueue: Array<ApiResponse | Promise<ApiResponse>> = [];
let notionStartQueue: Array<ApiResponse | Promise<ApiResponse>> = [];
let feishuStartQueue: Array<ApiResponse | Promise<ApiResponse>> = [];
let displaySetQueue: Array<ApiResponse | Promise<ApiResponse>> = [];

function ControllerHarness() {
  const snapshot = useSettingsSceneController({ activeSection: 'notion' });
  useEffect(() => {
    latestSnapshot = snapshot;
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

async function flushReact() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

async function renderController() {
  act(() => root!.render(createElement(ControllerHarness)));
  await flushReact();
}

async function invoke(action: () => void | Promise<void>) {
  await act(async () => {
    await action();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

function begin(action: () => Promise<void>): Promise<void> {
  let result!: Promise<void>;
  act(() => {
    result = action();
  });
  return result;
}

function callsOf(type: string) {
  return runtimeMocks.send.mock.calls.filter(([messageType]) => messageType === type);
}

function takeQueued(queue: Array<ApiResponse | Promise<ApiResponse>>, fallback: ApiResponse) {
  return queue.length ? queue.shift()! : fallback;
}

function dispatchStorage(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) {
  for (const [key, change] of Object.entries(changes)) {
    if (change.newValue === undefined) delete storageState[key];
    else storageState[key] = change.newValue;
  }
  act(() => storageListener?.(changes, 'local'));
}

beforeEach(() => {
  vi.clearAllMocks();
  latestSnapshot = null;
  storageState = {};
  storageListener = null;
  notionStatus = { connected: false, workspaceName: '' };
  feishuStatus = { connected: false };
  notionGetQueue = [];
  feishuGetQueue = [];
  notionStartQueue = [];
  feishuStartQueue = [];
  displaySetQueue = [];

  antiHotlinkMocks.load.mockResolvedValue([{ domain: 'initial.example', referer: 'https://initial.example/' }]);
  feishuSettingsMocks.getPathConfig.mockResolvedValue({
    chatFolder: 'Chats',
    articleFolder: 'Articles',
    videoFolder: 'Videos',
  });
  feishuClientMocks.disconnect.mockResolvedValue(undefined);

  storageMocks.get.mockImplementation(async (keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys || []) out[key] = storageState[key];
    return out;
  });
  storageMocks.set.mockImplementation(async (payload: Record<string, unknown>) => {
    Object.assign(storageState, payload || {});
  });
  storageMocks.remove.mockImplementation(async (keys: string[]) => {
    for (const key of keys || []) delete storageState[key];
  });
  storageMocks.onChanged.mockImplementation((listener: StorageListener) => {
    storageListener = listener;
    return () => {
      if (storageListener === listener) storageListener = null;
    };
  });

  runtimeMocks.send.mockImplementation(async (type: string, payload?: Record<string, unknown>) => {
    if (type === NOTION_MESSAGE_TYPES.GET_AUTH_STATUS) {
      return await takeQueued(notionGetQueue, ok(notionStatus));
    }
    if (type === NOTION_MESSAGE_TYPES.START_AUTH) {
      return await takeQueued(notionStartQueue, ok({ state: 'notion-state' }));
    }
    if (type === NOTION_MESSAGE_TYPES.DISCONNECT) {
      notionStatus = { connected: false, workspaceName: '' };
      return ok({ disconnected: true });
    }
    if (type === NOTION_MESSAGE_TYPES.LIST_PARENT_PAGES) return ok({ pages: [], resolvedSaved: null });
    if (type === FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS) {
      return await takeQueued(feishuGetQueue, ok(feishuStatus));
    }
    if (type === FEISHU_MESSAGE_TYPES.START_AUTH) {
      return await takeQueued(feishuStartQueue, ok({ state: 'feishu-state' }));
    }
    if (type === FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG) {
      return ok({ clientId: 'feishu-app', clientSecretPresent: true, tokenExchangeProxyUrl: '' });
    }
    if (type === INPAGE_MESSAGE_TYPES.SET_DISPLAY_MODE) {
      return await takeQueued(displaySetQueue, ok({ mode: String(payload?.mode || '') }));
    }
    if (type === 'obsidianGetSettings') {
      return ok({
        apiBaseUrl: 'http://127.0.0.1:27123',
        authHeaderName: 'Authorization',
        apiKeyPresent: false,
        apiKeyMasked: '',
        chatFolder: 'Chats',
        articleFolder: 'Articles',
        videoFolder: 'Videos',
      });
    }
    if (type === 'githubGetSettings') {
      return ok({
        settings: { repository: '', branch: '', defaults: { repository: '', branch: '' } },
        auth: { state: 'disconnected' },
        app: { verificationUrl: '', appUrl: '', installUrl: '' },
      });
    }
    throw new Error(`unexpected runtime message: ${type}`);
  });

  setupDom();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = null;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).location;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  dom?.window.close();
  dom = null;
});

describe('Settings scoped refresh', () => {
  it('mount performs one full hydrate without duplicating the anti-hotlink storage read', async () => {
    await renderController();

    expect(callsOf(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(1);
    expect(callsOf('obsidianGetSettings')).toHaveLength(1);
    expect(callsOf('githubGetSettings')).toHaveLength(1);
    expect(storageMocks.get).toHaveBeenCalledTimes(2);
    const storageReads = storageMocks.get.mock.calls.map(([keys]) => keys as string[]);
    const bulkRead = storageReads.find((keys) => keys.includes('notion_parent_page_id'))!;
    const displayRead = storageReads.find((keys) => keys.includes('inpage_display_mode'))!;
    expect(bulkRead).not.toContain('inpage_display_mode');
    expect(bulkRead).not.toContain('anti_hotlink_rules_v1');
    expect(displayRead).toEqual(['inpage_display_mode']);
    expect(storageMocks.onChanged.mock.invocationCallOrder[0]).toBeLessThan(
      storageMocks.get.mock.invocationCallOrder[0],
    );
    expect(antiHotlinkMocks.load).toHaveBeenCalledTimes(1);
    expect(antiHotlinkMocks.load).toHaveBeenCalledWith({ forceRefresh: true });
    expect(feishuSettingsMocks.getPathConfig).toHaveBeenCalledTimes(1);
  });

  it('display wakes update only display state and removed canonical falls back through the shared reader', async () => {
    storageState = { inpage_display_mode: 'all' };
    await renderController();
    expect(latestSnapshot!.inpageDisplayMode).toBe('all');
    const baselineRuntime = runtimeMocks.send.mock.calls.length;
    const baselineStorageReads = storageMocks.get.mock.calls.length;

    dispatchStorage({ inpage_display_mode: { oldValue: 'all', newValue: 'off' } });
    await flushReact();
    expect(latestSnapshot!.inpageDisplayMode).toBe('off');
    expect(runtimeMocks.send).toHaveBeenCalledTimes(baselineRuntime);
    expect(storageMocks.get).toHaveBeenCalledTimes(baselineStorageReads);

    dispatchStorage({ inpage_display_mode: { oldValue: 'off', newValue: undefined } });
    await flushReact();
    expect(latestSnapshot!.inpageDisplayMode).toBe('all');
    expect(storageMocks.get).toHaveBeenCalledTimes(baselineStorageReads + 1);
  });

  it('a live display wake beats a late mount effective read', async () => {
    const displayRead = deferred<Record<string, unknown>>();
    const defaultGet = storageMocks.get.getMockImplementation()!;
    storageMocks.get.mockImplementation(async (keys: string[]) => {
      if ((keys || []).includes('inpage_display_mode')) return await displayRead.promise;
      return await defaultGet(keys);
    });

    act(() => root!.render(createElement(ControllerHarness)));
    await flushReact();
    expect(storageListener).not.toBeNull();
    dispatchStorage({ inpage_display_mode: { newValue: 'off' } });
    await flushReact();
    expect(latestSnapshot!.inpageDisplayMode).toBe('off');
    displayRead.resolve({ inpage_display_mode: 'all' });
    await flushReact();
    expect(latestSnapshot!.inpageDisplayMode).toBe('off');
  });

  it('display action uses the background route, supports same-value-no-wake fallback, and rejects stale responses', async () => {
    storageState = { inpage_display_mode: 'all' };
    await renderController();
    await invoke(() => latestSnapshot!.onChangeInpageDisplayMode('off'));
    expect(callsOf(INPAGE_MESSAGE_TYPES.SET_DISPLAY_MODE)).toHaveLength(1);
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ inpage_display_mode: expect.anything() }),
    );
    expect(latestSnapshot!.inpageDisplayMode).toBe('off');

    const late = deferred<ApiResponse>();
    displaySetQueue.push(late.promise);
    const action = begin(() => latestSnapshot!.onChangeInpageDisplayMode('all'));
    await flushReact();
    dispatchStorage({ inpage_display_mode: { oldValue: 'off', newValue: 'supported' } });
    late.resolve(ok({ mode: 'all' }));
    await act(async () => action);
    expect(latestSnapshot!.inpageDisplayMode).toBe('supported');
  });

  it('display route failure does not report a successful UI state', async () => {
    storageState = { inpage_display_mode: 'all' };
    await renderController();
    displaySetQueue.push({ ok: false, data: null, error: { message: 'display write failed' } });
    await invoke(() => latestSnapshot!.onChangeInpageDisplayMode('off'));
    expect(latestSnapshot!.inpageDisplayMode).toBe('all');
    expect(latestSnapshot!.error).toBe('display write failed');
  });

  it('autosave and dollar wakes update only their own Settings state without a full refresh', async () => {
    storageState = { ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: true };
    await renderController();
    const baselineRuntime = runtimeMocks.send.mock.calls.length;
    const baselineStorageReads = storageMocks.get.mock.calls.length;

    dispatchStorage({ ai_chat_auto_save_enabled: { oldValue: true, newValue: false } });
    await flushReact();
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(false);
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(true);
    expect(runtimeMocks.send).toHaveBeenCalledTimes(baselineRuntime);
    expect(storageMocks.get).toHaveBeenCalledTimes(baselineStorageReads);

    dispatchStorage({ ai_chat_dollar_mention_enabled: { oldValue: true, newValue: false } });
    await flushReact();
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(false);
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(false);
    expect(runtimeMocks.send).toHaveBeenCalledTimes(baselineRuntime);
    expect(storageMocks.get).toHaveBeenCalledTimes(baselineStorageReads);
  });

  it('an autosave wake beats only its own late hydrate while dollar still applies from that hydrate', async () => {
    const bulkRead = deferred<Record<string, unknown>>();
    const defaultGet = storageMocks.get.getMockImplementation()!;
    storageMocks.get.mockImplementation(async (keys: string[]) => {
      if ((keys || []).includes('notion_parent_page_id')) return await bulkRead.promise;
      return await defaultGet(keys);
    });

    act(() => root!.render(createElement(ControllerHarness)));
    await flushReact();
    dispatchStorage({ ai_chat_auto_save_enabled: { newValue: false } });
    await flushReact();
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(false);

    bulkRead.resolve({ ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: false });
    await flushReact();
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(false);
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(false);
  });

  it('a dollar wake beats only its own late hydrate while autosave still applies from that hydrate', async () => {
    const bulkRead = deferred<Record<string, unknown>>();
    const defaultGet = storageMocks.get.getMockImplementation()!;
    storageMocks.get.mockImplementation(async (keys: string[]) => {
      if ((keys || []).includes('notion_parent_page_id')) return await bulkRead.promise;
      return await defaultGet(keys);
    });

    act(() => root!.render(createElement(ControllerHarness)));
    await flushReact();
    dispatchStorage({ ai_chat_dollar_mention_enabled: { newValue: false } });
    await flushReact();
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(false);

    bulkRead.resolve({ ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: true });
    await flushReact();
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(false);
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(false);
  });

  it('runtime-setting actions use per-key fallback observations and newer same-key wakes win', async () => {
    storageState = { ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: true };
    await renderController();

    await invoke(() => latestSnapshot!.onToggleAiChatAutoSaveEnabled(true));
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(true);

    await invoke(() => latestSnapshot!.onToggleAiChatDollarMentionEnabled(false));
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(false);

    const pendingWrite = deferred<void>();
    storageMocks.set.mockImplementationOnce(async () => {
      await pendingWrite.promise;
    });
    const staleAutoAction = begin(() => latestSnapshot!.onToggleAiChatAutoSaveEnabled(false));
    await flushReact();
    dispatchStorage({ ai_chat_auto_save_enabled: { oldValue: true, newValue: true } });
    pendingWrite.resolve();
    await act(async () => staleAutoAction);
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(true);
  });

  it('an unrelated runtime-setting wake does not suppress another key action fallback', async () => {
    storageState = { ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: true };
    await renderController();
    const pendingWrite = deferred<void>();
    storageMocks.set.mockImplementationOnce(async (payload: Record<string, unknown>) => {
      await pendingWrite.promise;
      Object.assign(storageState, payload || {});
    });

    const autoAction = begin(() => latestSnapshot!.onToggleAiChatAutoSaveEnabled(true));
    await flushReact();
    dispatchStorage({ ai_chat_dollar_mention_enabled: { oldValue: true, newValue: false } });
    pendingWrite.resolve();
    await act(async () => autoAction);
    expect(latestSnapshot!.aiChatAutoSaveEnabled).toBe(true);
    expect(latestSnapshot!.aiChatDollarMentionEnabled).toBe(false);
  });

  it('Notion and Feishu token wakes rehydrate only their own safe auth status', async () => {
    await renderController();
    const baseline = {
      notion: callsOf(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS).length,
      feishu: callsOf(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS).length,
      obsidian: callsOf('obsidianGetSettings').length,
      github: callsOf('githubGetSettings').length,
      storage: storageMocks.get.mock.calls.length,
      anti: antiHotlinkMocks.load.mock.calls.length,
      paths: feishuSettingsMocks.getPathConfig.mock.calls.length,
    };

    dispatchStorage({ notion_oauth_token_v1: { newValue: { accessToken: 'n' } } });
    await flushReact();
    expect(callsOf(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(baseline.notion + 1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(baseline.feishu);
    expect(callsOf('obsidianGetSettings')).toHaveLength(baseline.obsidian);
    expect(callsOf('githubGetSettings')).toHaveLength(baseline.github);
    expect(storageMocks.get).toHaveBeenCalledTimes(baseline.storage);
    expect(antiHotlinkMocks.load).toHaveBeenCalledTimes(baseline.anti);
    expect(feishuSettingsMocks.getPathConfig).toHaveBeenCalledTimes(baseline.paths);

    dispatchStorage({ feishu_oauth_token_v1: { newValue: { accessToken: 'f' } } });
    await flushReact();
    expect(callsOf(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(baseline.notion + 1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(baseline.feishu + 1);
    expect(callsOf('obsidianGetSettings')).toHaveLength(baseline.obsidian);
    expect(callsOf('githubGetSettings')).toHaveLength(baseline.github);
    expect(storageMocks.get).toHaveBeenCalledTimes(baseline.storage);
  });

  it('pending and error wakes apply directly without runtime reads and terminate current waiting when terminal', async () => {
    await renderController();
    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(latestSnapshot!.pollingNotion).toBe(true);
    const runtimeCount = runtimeMocks.send.mock.calls.length;

    dispatchStorage({ notion_oauth_last_error: { newValue: 'denied' } });
    await flushReact();
    expect(runtimeMocks.send).toHaveBeenCalledTimes(runtimeCount);
    expect(latestSnapshot!.pollingNotion).toBe(false);
    expect(latestSnapshot!.notionStatusText).toBe('statusError');

    await invoke(() => {
      latestSnapshot!.setFeishuClientId('feishu-app');
      latestSnapshot!.setFeishuClientSecret('secret');
    });
    await invoke(() => latestSnapshot!.onFeishuConnectOrDisconnect());
    expect(latestSnapshot!.pollingFeishu).toBe(true);
    const afterStart = runtimeMocks.send.mock.calls.length;
    dispatchStorage({ feishu_oauth_pending_state: { newValue: undefined } });
    await flushReact();
    expect(runtimeMocks.send).toHaveBeenCalledTimes(afterStart);
    expect(latestSnapshot!.pollingFeishu).toBe(false);
  });

  it('anti-hotlink wake reloads only canonical rules and preserves last-good rules on failure', async () => {
    await renderController();
    const baselineRuntime = runtimeMocks.send.mock.calls.length;
    const baselineStorage = storageMocks.get.mock.calls.length;

    antiHotlinkMocks.load.mockResolvedValueOnce([{ domain: 'next.example', referer: 'https://next.example/' }]);
    dispatchStorage({ anti_hotlink_rules_v1: { newValue: [{ domain: 'ignored-direct-value' }] } });
    await flushReact();
    expect(latestSnapshot!.antiHotlinkRules).toEqual([{ domain: 'next.example', referer: 'https://next.example/' }]);
    expect(runtimeMocks.send).toHaveBeenCalledTimes(baselineRuntime);
    expect(storageMocks.get).toHaveBeenCalledTimes(baselineStorage);

    antiHotlinkMocks.load.mockRejectedValueOnce(new Error('reload failed'));
    dispatchStorage({ anti_hotlink_rules_v1: { newValue: [] } });
    await flushReact();
    expect(latestSnapshot!.antiHotlinkRules).toEqual([{ domain: 'next.example', referer: 'https://next.example/' }]);
  });

  it('uses one 60s UI timeout without 750ms refreshes and allows retry after timeout', async () => {
    vi.useFakeTimers();
    await renderController();
    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(latestSnapshot!.pollingNotion).toBe(true);
    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(1);

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(1);
    const runtimeCount = runtimeMocks.send.mock.calls.length;
    const storageReads = storageMocks.get.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(latestSnapshot!.pollingNotion).toBe(true);
    expect(runtimeMocks.send).toHaveBeenCalledTimes(runtimeCount);
    expect(storageMocks.get).toHaveBeenCalledTimes(storageReads);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(latestSnapshot!.pollingNotion).toBe(false);
    expect(latestSnapshot!.notionStatusText).toBe('statusWaiting');
    expect(storageMocks.remove).not.toHaveBeenCalledWith(expect.arrayContaining(['notion_oauth_pending_state']));

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(2);
  });

  it('mount with durable historical pending shows Waiting without starting a polling timer', async () => {
    storageState = {
      notion_oauth_pending_state: 'historical-notion',
      feishu_oauth_pending_state: 'historical-feishu',
    };
    vi.useFakeTimers();
    await renderController();

    expect(latestSnapshot!.notionStatusText).toBe('statusWaiting');
    expect(latestSnapshot!.pollingNotion).toBe(false);
    expect(latestSnapshot!.feishuStatusText).toBe('statusWaiting');
    expect(latestSnapshot!.pollingFeishu).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts ACK before storage wake and same-state wake before ACK, but rejects a newer different pending', async () => {
    await renderController();

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(latestSnapshot!.pollingNotion).toBe(true);
    expect(latestSnapshot!.notionStatusText).toBe('statusWaiting');

    dispatchStorage({ notion_oauth_pending_state: { newValue: undefined } });
    await flushReact();
    const sameState = deferred<ApiResponse>();
    notionStartQueue.push(sameState.promise);
    const sameStateAction = begin(() => latestSnapshot!.onNotionConnectOrDisconnect());
    await flushReact();
    dispatchStorage({ notion_oauth_pending_state: { newValue: 'same-state' } });
    sameState.resolve(ok({ state: 'same-state' }));
    await act(async () => sameStateAction);
    expect(latestSnapshot!.pollingNotion).toBe(true);

    storageState = {
      feishu_oauth_client_id: 'feishu-app',
      feishu_oauth_client_secret: 'secret',
    };
    const newerPending = deferred<ApiResponse>();
    feishuStartQueue.push(newerPending.promise);
    const staleAction = begin(() => latestSnapshot!.onFeishuConnectOrDisconnect());
    await flushReact();
    dispatchStorage({ feishu_oauth_pending_state: { newValue: 'other-surface-state' } });
    newerPending.resolve(ok({ state: 'stale-own-state' }));
    await act(async () => staleAction);
    expect(latestSnapshot!.feishuPendingState).toBe('other-surface-state');
    expect(latestSnapshot!.pollingFeishu).toBe(false);
  });

  it('historical pending does not block a new START ACK after timeout-style retry', async () => {
    storageState = { notion_oauth_pending_state: 'historical' };
    await renderController();
    expect(latestSnapshot!.pollingNotion).toBe(false);

    notionStartQueue.push(ok({ state: 'replacement' }));
    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(latestSnapshot!.pollingNotion).toBe(true);
    expect(latestSnapshot!.notionStatusText).toBe('statusWaiting');
  });

  it('terminal pending removal or connected token wake before deferred START reply prevents ACK resurrection', async () => {
    await renderController();
    const pendingRemoval = deferred<ApiResponse>();
    notionStartQueue.push(pendingRemoval.promise);
    const notionAction = begin(() => latestSnapshot!.onNotionConnectOrDisconnect());
    await flushReact();
    dispatchStorage({ notion_oauth_pending_state: { newValue: undefined } });
    pendingRemoval.resolve(ok({ state: 'late-notion' }));
    await act(async () => notionAction);
    expect(latestSnapshot!.pollingNotion).toBe(false);
    expect(latestSnapshot!.notionStatusText).toBe('statusNotConnected');

    storageState = {
      feishu_oauth_client_id: 'feishu-app',
      feishu_oauth_client_secret: 'secret',
    };
    const tokenTerminal = deferred<ApiResponse>();
    feishuStartQueue.push(tokenTerminal.promise);
    const feishuAction = begin(() => latestSnapshot!.onFeishuConnectOrDisconnect());
    await flushReact();
    feishuStatus = { connected: true };
    dispatchStorage({ feishu_oauth_token_v1: { newValue: { accessToken: 'connected' } } });
    await flushReact();
    tokenTerminal.resolve(ok({ state: 'late-feishu' }));
    await act(async () => feishuAction);
    expect(latestSnapshot!.feishuConnected).toBe(true);
    expect(latestSnapshot!.pollingFeishu).toBe(false);
  });

  it('token wake failure preserves last-good status and does not surface a global Settings error', async () => {
    await renderController();
    notionGetQueue.push(Promise.reject(new Error('notion wake failed')));
    feishuGetQueue.push(Promise.reject(new Error('feishu wake failed')));

    dispatchStorage({
      notion_oauth_token_v1: { newValue: { accessToken: 'n' } },
      feishu_oauth_token_v1: { newValue: { accessToken: 'f' } },
    });
    await flushReact();
    expect(latestSnapshot!.notionConnected).toBe(false);
    expect(latestSnapshot!.feishuConnected).toBe(false);
    expect(latestSnapshot!.error).toBeNull();
  });

  it('older safe auth response cannot overwrite a later direct disconnect', async () => {
    notionStatus = { connected: true, workspaceName: 'Workspace' };
    await renderController();
    expect(latestSnapshot!.notionConnected).toBe(true);

    const staleWake = deferred<ApiResponse>();
    notionGetQueue.push(staleWake.promise);
    dispatchStorage({ notion_oauth_token_v1: { newValue: { accessToken: 'old' } } });
    await flushReact();

    notionGetQueue.push(ok({ connected: true, workspaceName: 'Workspace' }));
    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(latestSnapshot!.notionConnected).toBe(false);

    staleWake.resolve(ok({ connected: true, workspaceName: 'Stale' }));
    await flushReact();
    expect(latestSnapshot!.notionConnected).toBe(false);
    expect(latestSnapshot!.notionStatusText).toBe('statusNotConnected');
  });
});
