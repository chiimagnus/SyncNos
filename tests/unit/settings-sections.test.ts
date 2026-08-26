import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from '../../src/viewmodels/settings/types';
import { BackupSection } from '../../src/ui/settings/sections/BackupSection';
import { InpageSection } from '../../src/ui/settings/sections/InpageSection';
import { ObsidianSettingsSection } from '../../src/ui/settings/sections/ObsidianSettingsSection';
import { SettingsSidebarNav } from '../../src/ui/settings/SettingsSidebarNav';

describe('settings section definitions', () => {
  it('keeps the flattened settings navigation order stable', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'general',
      'articles',
      'ai_chats',
      'videos',
      'chat_with',
      'backup',
      'notion',
      'feishu',
      'obsidian',
      'aboutyou',
      'aboutme',
    ]);
  });

  it('groups sections into integrations, behavior, and about areas', () => {
    expect(SETTINGS_SECTION_GROUPS.map((group) => group.sections.map((section) => section.key))).toEqual([
      ['general', 'articles', 'ai_chats', 'videos', 'chat_with'],
      ['backup', 'notion', 'feishu', 'obsidian'],
      ['aboutyou', 'aboutme'],
    ]);
  });

  it('hides group titles and separates sidebar groups', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);

    act(() => {
      root.render(createElement(SettingsSidebarNav, { activeSection: 'general', onSelectSection: () => {} }));
    });

    const groupList = document.querySelector('nav')?.firstElementChild;
    const groups = groupList ? Array.from(groupList.children) : [];
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.querySelectorAll('button').length)).toEqual([5, 4, 2]);
    expect(groups.slice(1).every((group) => group.firstElementChild?.classList.contains('tw-h-px'))).toBe(true);
    expect(groups.slice(1).every((group) => group.firstElementChild?.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
    expect(groups.every((group) => group.querySelectorAll('[aria-hidden="true"]').length <= 1)).toBe(true);

    act(() => root.unmount());
    cleanupDom();
  });

  it('uses the supplied Obsidian setup guide URL', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);
    const setupGuideUrl = 'https://github.com/chiimagnus/SyncNos/blob/main/docs/guide/obsidian/LocalRestAPI.en.md';
    const onTest = vi.fn();

    act(() => {
      root.render(
        createElement(ObsidianSettingsSection, {
          busy: false,
          syncEnabled: true,
          autoSyncEnabled: false,
          apiBaseUrl: 'http://127.0.0.1:27123',
          authHeaderName: 'Authorization',
          apiKeyDraft: '',
          apiKeyPresent: false,
          apiKeyMasked: '',
          chatFolder: 'SyncNos-AIChats',
          articleFolder: 'SyncNos-WebArticles',
          videoFolder: 'SyncNos-Videos',
          statusText: '',
          obsidianLogoUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
          setupGuideUrl,
          onChangeApiBaseUrl: () => {},
          onChangeAuthHeaderName: () => {},
          onChangeApiKeyDraft: () => {},
          onChangeChatFolder: () => {},
          onChangeArticleFolder: () => {},
          onChangeVideoFolder: () => {},
          onToggleSyncEnabled: () => {},
          onToggleAutoSyncEnabled: () => {},
          onSave: () => {},
          onSaveApiKey: () => {},
          onTest,
          onOpenSetupGuide: () => {},
        }),
      );
    });

    expect(document.querySelector(`a[href="${setupGuideUrl}"]`)).toBeTruthy();
    const section = document.querySelector('section[aria-label="Obsidian Local REST API"]');
    const header = section?.firstElementChild;
    const testButton = Array.from(header?.querySelectorAll('button') || []).find(
      (button) => button.textContent?.trim() === 'Test',
    ) as HTMLButtonElement | undefined;
    expect(testButton).toBeTruthy();
    expect(header?.contains(testButton!)).toBe(true);

    act(() => {
      testButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onTest).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    cleanupDom();
  });
});

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
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: dom.window.CustomEvent,
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).Event;
  delete (globalThis as any).CustomEvent;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

async function flushReactScheduler() {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

describe('inpage anti-hotlink advanced editor', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    act(() => {
      root?.unmount();
    });
    root = null;
    await flushReactScheduler();
    cleanupDom();
  });

  function renderInpage(props: Partial<Parameters<typeof InpageSection>[0]> = {}) {
    const baseProps: Parameters<typeof InpageSection>[0] = {
      busy: false,
      userName: '',
      onChangeUserName: () => {},
      onSaveUserName: () => {},
      displayMode: 'supported',
      onChangeDisplayMode: () => {},
      localePreference: 'system',
      onChangeLocalePreference: () => {},
      aiChatAutoSaveEnabled: true,
      onToggleAiChatAutoSaveEnabled: () => {},
      aiChatCacheImagesEnabled: true,
      onToggleAiChatCacheImagesEnabled: () => {},
      webArticleCacheImagesEnabled: true,
      onToggleWebArticleCacheImagesEnabled: () => {},
      xiaohongshuCommentsCaptureEnabled: false,
      onToggleXiaohongshuCommentsCaptureEnabled: () => {},
      antiHotlinkAdvancedOpen: false,
      onToggleAntiHotlinkAdvancedOpen: () => {},
      antiHotlinkRules: [],
      antiHotlinkRuleErrors: [],
      onChangeAntiHotlinkRule: () => {},
      onAddAntiHotlinkRule: () => {},
      onRemoveAntiHotlinkRule: () => {},
      onApplyAntiHotlinkRules: () => {},
      onResetAntiHotlinkRules: () => {},
      aiChatDollarMentionEnabled: true,
      onToggleAiChatDollarMentionEnabled: () => {},
    };

    act(() => {
      root!.render(createElement(InpageSection, { ...baseProps, ...props }));
    });
  }

  it('renders advanced toggle button and triggers callback', () => {
    const onToggleAdvanced = vi.fn();
    renderInpage({ onToggleAntiHotlinkAdvancedOpen: onToggleAdvanced });

    const button = document.querySelector(
      'button[aria-controls="anti-hotlink-domains-editor"]',
    ) as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(document.querySelector('#anti-hotlink-domains-editor')).toBeFalsy();

    act(() => {
      button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it('uses the shared select menu for interface language', () => {
    const onChangeLocalePreference = vi.fn();
    renderInpage({ onChangeLocalePreference });

    const trigger = document.querySelector('button#interface-locale') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain('Follow system');

    act(() => {
      trigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const chinese = Array.from(document.querySelectorAll('button[role="menuitemradio"]')).find((button) =>
      button.textContent?.includes('Chinese'),
    ) as HTMLButtonElement | undefined;
    expect(chinese).toBeTruthy();
    act(() => {
      chinese!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onChangeLocalePreference).toHaveBeenCalledWith('zh');
  });

  it('keeps the username save behavior in general settings', () => {
    const onSaveUserName = vi.fn();
    renderInpage({ userName: 'Ada', onSaveUserName });

    const input = document.querySelector('input[autocomplete="off"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input?.value).toBe('Ada');

    act(() => {
      input!.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    });

    expect(onSaveUserName).toHaveBeenCalledTimes(1);
  });

  it('renders editor rows and validation errors when expanded', () => {
    renderInpage({
      antiHotlinkAdvancedOpen: true,
      antiHotlinkRules: [{ domain: 'https://bad-domain', referer: 'notaurl' }],
      antiHotlinkRuleErrors: [
        { domain: 'Domain must be a valid hostname.', referer: 'Referer must be a valid http(s) URL.' },
      ],
    });

    expect(document.querySelector('#anti-hotlink-domains-editor')).toBeTruthy();
    expect(document.querySelector('input[aria-label="Domain 1"]')).toBeTruthy();
    expect(document.querySelector('input[aria-label="Referer 1"]')).toBeTruthy();
    expect(document.body.textContent || '').toContain('Domain must be a valid hostname.');
    expect(document.body.textContent || '').toContain('Referer must be a valid http(s) URL.');
  });

  it('wires editor add/remove/reset callbacks', () => {
    const onAddRule = vi.fn();
    const onRemoveRule = vi.fn();
    const onResetRules = vi.fn();

    renderInpage({
      antiHotlinkAdvancedOpen: true,
      antiHotlinkRules: [{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }],
      onAddAntiHotlinkRule: onAddRule,
      onRemoveAntiHotlinkRule: onRemoveRule,
      onResetAntiHotlinkRules: onResetRules,
    });

    expect(document.querySelector('input[aria-label="Domain 1"]')).toBeTruthy();
    expect(document.querySelector('input[aria-label="Referer 1"]')).toBeTruthy();

    const buttons = Array.from(document.querySelectorAll('button'));
    const addButton = buttons.find((button) => button.textContent?.trim() === 'Add domain') as
      | HTMLButtonElement
      | undefined;
    const deleteButton = buttons.find((button) => button.textContent?.trim() === 'Delete') as
      | HTMLButtonElement
      | undefined;
    const resetButton = buttons.find((button) => button.textContent?.trim() === 'Reset') as
      | HTMLButtonElement
      | undefined;

    expect(addButton).toBeTruthy();
    expect(deleteButton).toBeTruthy();
    expect(resetButton).toBeTruthy();

    act(() => {
      addButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      deleteButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      resetButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(onAddRule).toHaveBeenCalledTimes(1);
    expect(onRemoveRule).toHaveBeenCalledWith(0);
    expect(onResetRules).toHaveBeenCalledTimes(1);
  });
});

describe('backup feedback', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    act(() => {
      root?.unmount();
    });
    root = null;
    await flushReactScheduler();
    cleanupDom();
  });

  function renderBackup(props: Partial<Parameters<typeof BackupSection>[0]> = {}) {
    const baseProps: Parameters<typeof BackupSection>[0] = {
      busy: false,
      exportStatus: '',
      importStatus: '',
      importStats: null,
      lastBackupExportAt: 0,
      backupImportRef: createRef<HTMLDivElement>(),
      fileInputRef: createRef<HTMLInputElement>(),
      onExport: () => {},
      onImportFile: () => {},
    };

    act(() => {
      root!.render(createElement(BackupSection, { ...baseProps, ...props }));
    });
  }

  it('hides empty feedback and shows completed backup feedback', () => {
    renderBackup();
    expect(document.body.textContent || '').not.toContain('Idle');
    expect(document.body.textContent || '').not.toContain('Ready');
    expect(document.body.textContent || '').not.toContain('last export:');

    renderBackup({ exportStatus: 'Exported', importStatus: 'Imported', lastBackupExportAt: 1 });
    expect(document.body.textContent || '').toContain('Exported');
    expect(document.body.textContent || '').toContain('Imported');
    expect(document.body.textContent || '').toContain('last export:');
  });
});
