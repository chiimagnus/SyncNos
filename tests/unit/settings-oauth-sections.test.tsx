import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeishuOAuthSection } from '@ui/settings/sections/FeishuOAuthSection';
import { NotionOAuthSection } from '@ui/settings/sections/NotionOAuthSection';

vi.mock('@i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en',
}));

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
  (dom.window.HTMLElement.prototype as any).attachEvent ||= () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent ||= () => {};
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
    notionPageSearchEmpty: false,
    notionLogoUrl: 'https://example.com/notion.png',
    onToggleSyncEnabled: noOp,
    onToggleAutoSyncEnabled: noOp,
    onToggleAdvancedOpen: noOp,
    onConnectOrDisconnect: noOp,
    onClearError: noOp,
    onSaveNotionParentPage: async () => true,
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
  it('uses switches for both provider and automatic sync, preserving checked and disabled states', async () => {
    const onToggleSyncEnabled = vi.fn();
    const onToggleAutoSyncEnabled = vi.fn();
    const callbacks = { onToggleSyncEnabled, onToggleAutoSyncEnabled };
    for (const [provider, renderSection] of [
      [
        'notion',
        (overrides: Partial<NotionProps>) => render(createElement(NotionOAuthSection, notionProps(overrides))),
      ],
      [
        'feishu',
        (overrides: Partial<FeishuProps>) => render(createElement(FeishuOAuthSection, feishuProps(overrides))),
      ],
    ] as const) {
      onToggleSyncEnabled.mockClear();
      onToggleAutoSyncEnabled.mockClear();
      await renderSection(callbacks);
      const sync = document.querySelector<HTMLInputElement>(`#${provider}SyncEnabledToggle`)!;
      const auto = document.querySelector<HTMLInputElement>(`#${provider}AutoSyncEnabledToggle`)!;
      for (const control of [sync, auto]) {
        expect(control.type).toBe('checkbox');
        expect(control.getAttribute('role')).toBe('switch');
        expect(control.classList.contains('webclipper-switch')).toBe(true);
      }
      expect(document.querySelector('.settings-group .settings-form-row input')).toBe(sync);
      expect(document.querySelectorAll('.settings-group').length).toBeGreaterThan(1);
      expect(sync.closest('.settings-group')?.getAttribute('aria-label')).toBe('settingsSync');
      expect(sync.closest('.settings-group')?.querySelector('h2')).toBeNull();
      expect(sync.closest('.settings-group')?.querySelector('.settings-info')).toBeNull();
      expect(sync.checked).toBe(true);
      expect(auto.checked).toBe(false);
      act(() => auto.click());
      expect(onToggleAutoSyncEnabled).toHaveBeenCalledWith(true);
      act(() => sync.click());
      expect(onToggleSyncEnabled).toHaveBeenCalledWith(false);
      await renderSection({ ...callbacks, busy: true, autoSyncEnabled: true });
      expect(sync.disabled).toBe(true);
      expect(auto.disabled).toBe(true);
      expect(auto.checked).toBe(true);
      act(() => auto.click());
      expect(onToggleAutoSyncEnabled).toHaveBeenCalledTimes(1);
      await renderSection({ ...callbacks, syncEnabled: false, autoSyncEnabled: true });
      expect(sync.checked).toBe(false);
      expect(document.querySelectorAll('.settings-group')).toHaveLength(1);
      expect(Array.from(document.querySelectorAll('input'))).toEqual([sync]);
      expect(document.querySelector(`#${provider}AutoSyncEnabledToggle`)).toBeNull();
      act(() => sync.click());
      expect(onToggleSyncEnabled).toHaveBeenLastCalledWith(true);
      await renderSection({ ...callbacks, autoSyncEnabled: true });
      expect(document.querySelector(`#${provider}SyncEnabledToggle`)).toBe(sync);
      expect(document.querySelector<HTMLInputElement>(`#${provider}AutoSyncEnabledToggle`)?.checked).toBe(true);
      expect(document.querySelectorAll('.settings-group').length).toBeGreaterThan(1);
      expect(onToggleAutoSyncEnabled).toHaveBeenCalledTimes(1);
    }
  });

  it('offers link selection inside the destination menu and only shows one input at a time', async () => {
    const onClearError = vi.fn();
    const props = notionProps({ notionConnected: true, notionPageSearchEmpty: true, onClearError });
    await render(createElement(NotionOAuthSection, { ...props, notionConnected: false }));
    expect(document.querySelector<HTMLButtonElement>('#notionPages')?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('notionNoParentPages');

    await render(createElement(NotionOAuthSection, { ...props, loadingNotionPages: true }));
    expect(document.querySelector<HTMLButtonElement>('#notionPages')?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('notionNoParentPages');

    await render(createElement(NotionOAuthSection, props));
    expect(document.body.textContent).toContain('notionNoParentPages');
    expect(document.querySelector('#notionParentPageLink')).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('#notionPages')!.click());
    const chooseByLink = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(
      (button) => button.textContent === 'notionChoosePageByLink',
    )!;
    act(() => chooseByLink.click());
    expect(document.querySelector('#notionPages')).toBeNull();
    const input = document.querySelector<HTMLInputElement>('#notionParentPageLink')!;
    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-label')).toBe('notionParentPageLink');
    expect(document.activeElement).toBe(input);
    expect(document.body.textContent).toContain('notionParentPageLinkHint');

    act(() =>
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('#notionParentPageLink')).toBeNull();
    expect(document.querySelector('#notionPages')).toBeTruthy();
    expect(document.body.textContent).toContain('notionNoParentPages');
    expect(onClearError).toHaveBeenCalledOnce();
  });

  it('keeps a failed link selection editable and returns to the saved page after success', async () => {
    const onSaveNotionParentPage = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const props = notionProps({
      notionConnected: true,
      notionParentPageId: 'existing',
      notionPageOptions: [{ id: 'existing', title: 'Existing' }],
      onSaveNotionParentPage,
    });
    await render(createElement(NotionOAuthSection, props));
    act(() => document.querySelector<HTMLButtonElement>('#notionPages')!.click());
    act(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
        .find((button) => button.textContent === 'notionChoosePageByLink')!
        .click(),
    );
    const input = document.querySelector<HTMLInputElement>('#notionParentPageLink')!;
    const link = 'https://www.notion.so/' + 'a'.repeat(32);
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, link);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'saveButton',
    )!;
    await act(async () => save.click());
    expect(onSaveNotionParentPage).toHaveBeenCalledWith(link);
    expect(document.querySelector('#notionParentPageLink')).toBe(input);
    expect(input.value).toBe(link);
    await act(async () => save.click());
    expect(onSaveNotionParentPage).toHaveBeenCalledTimes(2);
    await render(
      createElement(NotionOAuthSection, {
        ...props,
        notionParentPageId: 'a'.repeat(32),
        notionPageOptions: [{ id: 'a'.repeat(32), title: 'New destination' }],
      }),
    );
    expect(document.querySelector('#notionParentPageLink')).toBeNull();
    expect(document.querySelector('#notionPages')?.textContent).toContain('New destination');
  });

  it('selects a discovered page directly and resets an unfinished link on disconnect', async () => {
    const onSaveNotionParentPage = vi.fn().mockResolvedValue(true);
    const props = notionProps({
      notionConnected: true,
      notionPageOptions: [{ id: 'page-1', title: 'Page' }],
      onSaveNotionParentPage,
    });
    await render(createElement(NotionOAuthSection, props));
    act(() => document.querySelector<HTMLButtonElement>('#notionPages')!.click());
    act(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
        .find((button) => button.textContent === 'Page')!
        .click(),
    );
    expect(onSaveNotionParentPage).toHaveBeenCalledWith('page-1');
    expect(document.querySelector('#notionParentPageLink')).toBeNull();

    act(() => document.querySelector<HTMLButtonElement>('#notionPages')!.click());
    act(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
        .find((button) => button.textContent === 'notionChoosePageByLink')!
        .click(),
    );
    expect(document.querySelector('#notionParentPageLink')).toBeTruthy();
    await render(createElement(NotionOAuthSection, { ...props, notionConnected: false }));
    expect(document.querySelector('#notionParentPageLink')).toBeNull();
    await render(createElement(NotionOAuthSection, props));
    expect(document.querySelector('#notionParentPageLink')).toBeNull();
    expect(document.querySelector('#notionPages')).toBeTruthy();
  });

  it('keeps provider text fields and select triggers on the compact settings control width', async () => {
    await render(
      createElement(
        NotionOAuthSection,
        notionProps({ notionConnected: true, notionPageOptions: [{ id: 'page-1', title: 'Page' }] }),
      ),
    );
    const notionPageTrigger = document.querySelector('button#notionPages') as HTMLButtonElement | null;
    expect(notionPageTrigger?.parentElement?.className || '').toContain('tw-max-w-[180px]');

    await render(createElement(FeishuOAuthSection, feishuProps()));
    const clientIdInput = document.querySelector(
      'input[aria-label="feishuOAuthClientIdLabel"]',
    ) as HTMLInputElement | null;
    expect(clientIdInput?.className || '').toContain('tw-max-w-[180px]');
  });

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

  it('matches GitHub connection button emphasis for Notion and Feishu', async () => {
    await render(createElement(NotionOAuthSection, notionProps()));
    let button = document.querySelector('section[aria-label="notionOAuth"] button') as HTMLButtonElement;
    expect(button.className).toContain('webclipper-btn--filled');

    await render(createElement(NotionOAuthSection, notionProps({ notionConnected: true })));
    button = document.querySelector('section[aria-label="notionOAuth"] button') as HTMLButtonElement;
    expect(button.className).toContain('webclipper-btn--danger-tint');

    await render(createElement(FeishuOAuthSection, feishuProps()));
    button = document.querySelector('section[aria-label="feishuOAuth"] button') as HTMLButtonElement;
    expect(button.className).toContain('webclipper-btn--filled');

    await render(createElement(FeishuOAuthSection, feishuProps({ feishuConnected: true })));
    button = document.querySelector('section[aria-label="feishuOAuth"] button') as HTMLButtonElement;
    expect(button.className).toContain('webclipper-btn--danger-tint');
  });

  it('uses the unified Feishu help docs link', async () => {
    await render(createElement(FeishuOAuthSection, feishuProps()));
    expect(document.querySelector('a[href="https://chiimagnus.github.io/SyncNos/docs/en/sync/feishu/"]')).toBeTruthy();
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
