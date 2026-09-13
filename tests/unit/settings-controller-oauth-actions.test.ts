import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEISHU_MESSAGE_TYPES, NOTION_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { useSettingsSceneController } from '@viewmodels/settings/useSettingsSceneController';

const runtimeMocks = vi.hoisted(() => ({ send: vi.fn() }));
const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  onChanged: vi.fn(),
}));
const uiUtilsMocks = vi.hoisted(() => ({ openHttpUrl: vi.fn() }));

vi.mock('@services/shared/runtime', () => ({ send: runtimeMocks.send }));
vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
  storageRemove: storageMocks.remove,
  storageOnChanged: storageMocks.onChanged,
}));
vi.mock('@services/sync/sync-provider-gate', () => ({
  setSyncProviderEnabled: vi.fn(),
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
vi.mock('@i18n', () => ({
  getCurrentLocale: () => 'en',
  getLocalePreference: () => 'system',
  saveLocalePreference: async (value: any) => value,
  t: (key: string) => key,
}));
vi.mock('@viewmodels/settings/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@viewmodels/settings/utils')>();
  return { ...actual, openHttpUrl: uiUtilsMocks.openHttpUrl };
});

type Snapshot = ReturnType<typeof useSettingsSceneController>;
type ApiResponse = { ok: boolean; data: any; error: any };

let latestSnapshot: Snapshot | null = null;
let root: ReactDOM.Root | null = null;
let dom: JSDOM | null = null;
let notionConnected = false;
let feishuConnected = false;
let feishuSafeConfig = { clientId: '', clientSecretPresent: false, tokenExchangeProxyUrl: '' };
let storageState: Record<string, unknown> = {};

const ok = (data: any): ApiResponse => ({ ok: true, data, error: null });

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
  act(() => {
    root!.render(createElement(ControllerHarness));
  });
  await flushReact();
}

async function invoke(action: () => void | Promise<void>) {
  await act(async () => {
    await action();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

function callsOf(type: string) {
  return runtimeMocks.send.mock.calls.filter(([messageType]) => messageType === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  latestSnapshot = null;
  notionConnected = false;
  feishuConnected = false;
  feishuSafeConfig = { clientId: '', clientSecretPresent: false, tokenExchangeProxyUrl: '' };
  storageState = {};
  uiUtilsMocks.openHttpUrl.mockReturnValue(true);

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
  storageMocks.onChanged.mockImplementation(() => () => {});

  runtimeMocks.send.mockImplementation(async (type: string, payload?: Record<string, unknown>) => {
    if (type === NOTION_MESSAGE_TYPES.GET_AUTH_STATUS) {
      return ok({ connected: notionConnected, workspaceName: notionConnected ? 'Workspace' : '' });
    }
    if (type === NOTION_MESSAGE_TYPES.START_AUTH) return ok({ state: 'background-state' });
    if (type === NOTION_MESSAGE_TYPES.DISCONNECT) return ok({ disconnected: true });
    if (type === NOTION_MESSAGE_TYPES.GET_CONFIG) {
      return ok({ parentPageId: '', parentPageTitle: '', databaseIds: { chat: '', article: '', video: '' } });
    }
    if (type === FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS) {
      return ok({ connected: feishuConnected, pending: false, errorPresent: false });
    }
    if (type === FEISHU_MESSAGE_TYPES.GET_AUTH_CONFIG) return ok(feishuSafeConfig);
    if (type === FEISHU_MESSAGE_TYPES.START_AUTH) return ok({ state: 'feishu-background-state' });
    if (type === FEISHU_MESSAGE_TYPES.DISCONNECT) return ok({ disconnected: true });
    if (type === FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG) {
      const input = payload || {};
      feishuSafeConfig = {
        clientId: Object.prototype.hasOwnProperty.call(input, 'clientId')
          ? String(input.clientId || '')
          : feishuSafeConfig.clientId,
        clientSecretPresent: Object.prototype.hasOwnProperty.call(input, 'clientSecret')
          ? !!String(input.clientSecret || '')
          : feishuSafeConfig.clientSecretPresent,
        tokenExchangeProxyUrl: Object.prototype.hasOwnProperty.call(input, 'tokenExchangeProxyUrl')
          ? String(input.tokenExchangeProxyUrl || '')
          : feishuSafeConfig.tokenExchangeProxyUrl,
      };
      return ok(feishuSafeConfig);
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

describe('Settings OAuth actions', () => {
  it('Notion Connect delegates START_AUTH to background without direct pending writes or URL opening', async () => {
    await renderController();
    storageMocks.set.mockClear();
    uiUtilsMocks.openHttpUrl.mockClear();

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());

    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(1);
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ notion_oauth_pending_state: expect.anything() }),
    );
    expect(uiUtilsMocks.openHttpUrl).not.toHaveBeenCalled();
    expect(latestSnapshot!.pollingNotion).toBe(true);
    expect(latestSnapshot!.notionStatusText).toBe('statusWaiting');
  });

  it('rejects duplicate Notion START while waiting and allows retry after the 60s UI timeout', async () => {
    vi.useFakeTimers();
    await renderController();

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(latestSnapshot!.pollingNotion).toBe(false);

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());
    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(2);
  });

  it('Notion Disconnect resets local state without triggering a full Settings refresh', async () => {
    notionConnected = true;
    await renderController();
    const feishuReadsBefore = callsOf(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS).length;
    const obsidianReadsBefore = callsOf('obsidianGetSettings').length;
    const githubReadsBefore = callsOf('githubGetSettings').length;

    await invoke(() => latestSnapshot!.onNotionConnectOrDisconnect());

    expect(callsOf(NOTION_MESSAGE_TYPES.DISCONNECT)).toHaveLength(1);
    expect(callsOf(NOTION_MESSAGE_TYPES.START_AUTH)).toHaveLength(0);
    expect(callsOf(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(feishuReadsBefore);
    expect(callsOf('obsidianGetSettings')).toHaveLength(obsidianReadsBefore);
    expect(callsOf('githubGetSettings')).toHaveLength(githubReadsBefore);
    expect(latestSnapshot!.notionConnected).toBe(false);
    expect(latestSnapshot!.pollingNotion).toBe(false);
  });

  it('Feishu Connect persists only safe config fields then starts auth from durable config', async () => {
    feishuSafeConfig = { clientId: 'feishu-app', clientSecretPresent: true, tokenExchangeProxyUrl: '' };
    await renderController();
    storageMocks.set.mockClear();
    uiUtilsMocks.openHttpUrl.mockClear();

    await invoke(() => latestSnapshot!.onFeishuConnectOrDisconnect());

    expect(callsOf(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG)).toHaveLength(1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG)[0]?.[1]).toEqual({
      clientId: 'feishu-app',
      tokenExchangeProxyUrl: '',
    });
    expect(callsOf(FEISHU_MESSAGE_TYPES.START_AUTH)).toHaveLength(1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.START_AUTH)[0]?.[1]).toEqual({});
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ feishu_oauth_pending_state: expect.anything() }),
    );
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ feishu_oauth_client_id: expect.anything() }),
    );
    expect(uiUtilsMocks.openHttpUrl).not.toHaveBeenCalled();
    expect(latestSnapshot!.feishuClientSecret).toBe('');
    expect(latestSnapshot!.feishuClientSecretPresent).toBe(true);
    expect(latestSnapshot!.feishuPendingState).toBe('feishu-background-state');
    expect(latestSnapshot!.pollingFeishu).toBe(true);
    expect(latestSnapshot!.feishuStatusText).toBe('statusWaiting');
  });

  it('rejects duplicate Feishu START while waiting and allows retry after the 60s UI timeout', async () => {
    vi.useFakeTimers();
    feishuSafeConfig = { clientId: 'feishu-app', clientSecretPresent: true, tokenExchangeProxyUrl: '' };
    await renderController();

    await invoke(() => latestSnapshot!.onFeishuConnectOrDisconnect());
    await invoke(() => latestSnapshot!.onFeishuConnectOrDisconnect());
    expect(callsOf(FEISHU_MESSAGE_TYPES.START_AUTH)).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(latestSnapshot!.pollingFeishu).toBe(false);

    await invoke(() => latestSnapshot!.onFeishuConnectOrDisconnect());
    expect(callsOf(FEISHU_MESSAGE_TYPES.START_AUTH)).toHaveLength(2);
  });

  it('Feishu Advanced Save preserves an existing secret when the write-only draft was not edited', async () => {
    feishuSafeConfig = { clientId: 'feishu-app', clientSecretPresent: true, tokenExchangeProxyUrl: '' };
    await renderController();
    storageMocks.set.mockClear();

    await invoke(() => latestSnapshot!.onSaveFeishuAdvancedSettings());

    expect(callsOf(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG)).toHaveLength(1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG)[0]?.[1]).toEqual({
      clientId: 'feishu-app',
      tokenExchangeProxyUrl: '',
    });
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ feishu_oauth_client_id: expect.anything() }),
    );
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ feishu_oauth_client_secret: expect.anything() }),
    );
    expect(latestSnapshot!.feishuClientId).toBe('feishu-app');
    expect(latestSnapshot!.feishuClientSecret).toBe('');
    expect(latestSnapshot!.feishuClientSecretPresent).toBe(true);
  });

  it('Feishu sends a client secret only after the user edits the write-only draft, and reset explicitly clears it', async () => {
    feishuSafeConfig = { clientId: 'feishu-app', clientSecretPresent: true, tokenExchangeProxyUrl: '' };
    await renderController();
    runtimeMocks.send.mockClear();

    await invoke(() => latestSnapshot!.onChangeFeishuClientSecret('replacement-secret'));
    await invoke(() => latestSnapshot!.onSaveFeishuAdvancedSettings());

    expect(callsOf(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG)[0]?.[1]).toEqual({
      clientId: 'feishu-app',
      clientSecret: 'replacement-secret',
      tokenExchangeProxyUrl: '',
    });
    expect(latestSnapshot!.feishuClientSecret).toBe('');
    expect(latestSnapshot!.feishuClientSecretPresent).toBe(true);

    runtimeMocks.send.mockClear();
    await invoke(() => latestSnapshot!.onResetFeishuClientSecret());
    expect(callsOf(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG)[0]?.[1]).toEqual({ clientSecret: '' });
    expect(latestSnapshot!.feishuClientSecretPresent).toBe(false);
  });

  it('Feishu Disconnect resets local state without triggering a full Settings refresh', async () => {
    feishuConnected = true;
    await renderController();
    const notionReadsBefore = callsOf(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS).length;
    const obsidianReadsBefore = callsOf('obsidianGetSettings').length;
    const githubReadsBefore = callsOf('githubGetSettings').length;

    await invoke(() => latestSnapshot!.onFeishuConnectOrDisconnect());

    expect(callsOf(FEISHU_MESSAGE_TYPES.DISCONNECT)).toHaveLength(1);
    expect(callsOf(FEISHU_MESSAGE_TYPES.START_AUTH)).toHaveLength(0);
    expect(callsOf(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS)).toHaveLength(notionReadsBefore);
    expect(callsOf('obsidianGetSettings')).toHaveLength(obsidianReadsBefore);
    expect(callsOf('githubGetSettings')).toHaveLength(githubReadsBefore);
    expect(latestSnapshot!.feishuConnected).toBe(false);
    expect(latestSnapshot!.pollingFeishu).toBe(false);
  });
});
