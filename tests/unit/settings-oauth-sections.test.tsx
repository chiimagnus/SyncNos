import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeishuOAuthSection } from '@ui/settings/sections/FeishuOAuthSection';
import { NotionOAuthSection } from '@ui/settings/sections/NotionOAuthSection';

vi.mock('@i18n', () => ({ t: (key: string) => key }));

type NotionProps = Parameters<typeof NotionOAuthSection>[0];
type FeishuProps = Parameters<typeof FeishuOAuthSection>[0];

let dom: JSDOM | null = null;
let root: ReactDOM.Root | null = null;

function setupDom() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/settings',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  root = ReactDOM.createRoot(document.getElementById('root')!);
}

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root!.render(element);
    await Promise.resolve();
  });
}

function noOp() {}

function notionProps(overrides: Partial<NotionProps> = {}): NotionProps {
  return {
    busy: false,
    syncEnabled: true,
    autoSyncEnabled: false,
    notionStatusText: 'statusNotConnected',
    notionConnected: false,
    pollingNotion: false,
    loadingNotionPages: false,
    notionAdvancedOpen: false,
    notionParentPageId: '',
    notionChatDatabaseId: '',
    notionArticleDatabaseId: '',
    notionVideoDatabaseId: '',
    notionChatDatabaseLabel: 'chat-db',
    notionArticleDatabaseLabel: 'article-db',
    notionVideoDatabaseLabel: 'video-db',
    notionPageOptions: [],
    notionLogoUrl: 'https://example.com/notion.png',
    onToggleSyncEnabled: noOp,
    onToggleAutoSyncEnabled: noOp,
    onToggleAdvancedOpen: noOp,
    onConnectOrDisconnect: noOp,
    onSaveNotionParentPage: noOp,
    onChangeNotionChatDatabaseId: noOp,
    onChangeNotionArticleDatabaseId: noOp,
    onChangeNotionVideoDatabaseId: noOp,
    onSaveNotionDatabaseId: noOp,
    onResetNotionDatabaseId: noOp,
    onLoadNotionPages: noOp,
    ...overrides,
  };
}

function feishuProps(overrides: Partial<FeishuProps> = {}): FeishuProps {
  return {
    busy: false,
    syncEnabled: true,
    autoSyncEnabled: false,
    feishuStatusText: 'statusNotConnected',
    feishuConnected: false,
    pollingFeishu: false,
    feishuPendingState: '',
    feishuLastError: '',
    feishuClientId: 'client-id',
    feishuClientSecret: 'client-secret',
    feishuTokenExchangeProxyUrl: 'https://worker.example.com/exchange',
    feishuChatFolder: 'AIChats',
    feishuArticleFolder: 'WebArticles',
    feishuVideoFolder: 'Videos',
    feishuLogoUrl: 'https://example.com/feishu.png',
    setupGuideUrl: 'https://example.com/guide',
    onToggleSyncEnabled: noOp,
    onToggleAutoSyncEnabled: noOp,
    onConnectOrDisconnect: noOp,
    onChangeClientId: noOp,
    onChangeClientSecret: noOp,
    onChangeTokenExchangeProxyUrl: noOp,
    onChangeChatFolder: noOp,
    onChangeArticleFolder: noOp,
    onChangeVideoFolder: noOp,
    onSavePaths: noOp,
    onSaveAdvanced: noOp,
    onOpenSetupGuide: noOp,
    ...overrides,
  };
}

beforeEach(() => setupDom());

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  dom?.window.close();
  dom = null;
});

describe('Settings OAuth sections', () => {
  it('disables disconnected Connect while the current surface is waiting, but never locks connected Disconnect', async () => {
    await render(createElement(NotionOAuthSection, notionProps({ pollingNotion: true })));
    let button = document.querySelector('section[aria-label="notionOAuth"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('connectingDots');

    await render(createElement(NotionOAuthSection, notionProps({ notionConnected: true, pollingNotion: true })));
    button = document.querySelector('section[aria-label="notionOAuth"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('disconnect');

    await render(createElement(FeishuOAuthSection, feishuProps({ pollingFeishu: true })));
    button = document.querySelector('section[aria-label="feishuOAuth"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('connectingDots');

    await render(createElement(FeishuOAuthSection, feishuProps({ feishuConnected: true, pollingFeishu: true })));
    button = document.querySelector('section[aria-label="feishuOAuth"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('disconnect');
  });

  it('disables Feishu auth config inputs while the current surface is waiting', async () => {
    await render(createElement(FeishuOAuthSection, feishuProps({ pollingFeishu: true })));

    for (const label of [
      'feishuOAuthClientIdLabel',
      'feishuOAuthClientSecretLabel',
      'feishuTokenExchangeProxyUrlLabel',
    ]) {
      const input = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      expect(input.disabled).toBe(true);
    }
  });
});
