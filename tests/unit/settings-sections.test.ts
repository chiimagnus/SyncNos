// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from '../../src/viewmodels/settings/types';
import { BackupSection } from '../../src/ui/settings/sections/BackupSection';
import { InpageSection } from '../../src/ui/settings/sections/InpageSection';
import { ObsidianSettingsSection } from '../../src/ui/settings/sections/ObsidianSettingsSection';
import { GitHubSettingsSection } from '../../src/ui/settings/sections/GitHubSettingsSection';
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
      'github',
      'aboutyou',
      'aboutme',
    ]);
  });

  it('groups sections into integrations, behavior, and about areas', () => {
    expect(SETTINGS_SECTION_GROUPS.map((group) => group.sections.map((section) => section.key))).toEqual([
      ['general', 'articles', 'ai_chats', 'videos', 'chat_with'],
      ['backup', 'notion', 'feishu', 'obsidian', 'github'],
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
    expect(groups.map((group) => group.querySelectorAll('button').length)).toEqual([5, 5, 2]);
    expect(groups.slice(1).every((group) => group.firstElementChild?.classList.contains('tw-h-px'))).toBe(true);
    expect(groups.slice(1).every((group) => group.firstElementChild?.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
    expect(groups.every((group) => group.querySelectorAll('[aria-hidden="true"]').length <= 1)).toBe(true);

    act(() => root.unmount());
    cleanupDom();
  });

  it('wires GitHub connect, pending Device Flow, and connected repository actions without a token input', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);
    const callbacks = {
      onConnect: vi.fn(),
      onCancelDeviceFlow: vi.fn(),
      onDisconnect: vi.fn(),
      onRefreshRepositories: vi.fn(),
      onChangeRepository: vi.fn(),
      onSaveTarget: vi.fn(),
      onTestConnection: vi.fn(),
    };
    const baseProps: Parameters<typeof GitHubSettingsSection>[0] = {
      busy: false,
      syncEnabled: true,
      autoSyncEnabled: false,
      auth: { state: 'disconnected' },
      account: null,
      repositoryStatus: null,
      repositories: [],
      targetUnavailable: false,
      repository: '',
      branch: 'main',
      chatFolder: 'SyncNos-AIChats',
      articleFolder: 'SyncNos-WebArticles',
      videoFolder: 'SyncNos-Videos',
      verificationUrl: 'https://github.com/login/device',
      appUrl: 'https://github.com/apps/syncnos',
      installUrl: 'https://github.com/apps/syncnos/installations/new',
      connectionTest: { status: 'idle' },
      githubLogoUrl: '/icons/github.svg',
      onToggleSyncEnabled: () => {},
      onToggleAutoSyncEnabled: () => {},
      onConnect: callbacks.onConnect,
      onCancelDeviceFlow: callbacks.onCancelDeviceFlow,
      onDisconnect: callbacks.onDisconnect,
      onRefreshRepositories: callbacks.onRefreshRepositories,
      onChangeRepository: callbacks.onChangeRepository,
      onChangeBranch: () => {},
      onChangeChatFolder: () => {},
      onChangeArticleFolder: () => {},
      onChangeVideoFolder: () => {},
      onSaveTarget: callbacks.onSaveTarget,
      onTestConnection: callbacks.onTestConnection,
    };

    act(() => {
      root.render(createElement(GitHubSettingsSection, baseProps));
    });
    const connectButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Connect GitHub',
    ) as HTMLButtonElement | undefined;
    expect(connectButton).toBeTruthy();
    act(() => connectButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(callbacks.onConnect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.textContent || '').not.toContain('Personal Access Token');
    expect(document.body.textContent || '').not.toContain('PAT');

    act(() => {
      root.render(
        createElement(GitHubSettingsSection, {
          ...baseProps,
          auth: {
            state: 'pending',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://github.com/login/device',
            expiresAt: Date.now() + 60_000,
            nextPollAt: Date.now() + 5_000,
          },
        }),
      );
    });
    expect(document.querySelector('[data-github-device-user-code="true"]')?.textContent).toContain('ABCD-EFGH');
    const openGithubLink = document.querySelector('[data-github-device-link="true"]') as HTMLAnchorElement | null;
    expect(openGithubLink?.getAttribute('href')).toBe('https://github.com/login/device');
    const openClick = vi.fn((event: Event) => event.preventDefault());
    openGithubLink?.addEventListener('click', openClick);
    act(() => openGithubLink!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(openClick).toHaveBeenCalledTimes(1);
    const cancelButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement | undefined;
    act(() => cancelButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(callbacks.onCancelDeviceFlow).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        createElement(GitHubSettingsSection, {
          ...baseProps,
          auth: { state: 'connected' },
          account: { login: 'octocat', avatarUrl: '', url: 'https://github.com/octocat' },
          repositoryStatus: 'ready',
          repositories: [
            { fullName: 'owner/repo', contentWriteCapable: true },
            { fullName: 'owner/other', contentWriteCapable: true },
            { fullName: 'owner/read-only', contentWriteCapable: false },
          ],
          repository: 'owner/repo',
        }),
      );
    });
    expect(document.body.textContent || '').toContain('Connected as octocat');
    expect(document.querySelector('input[aria-label="Repository"]')).toBeNull();
    expect(document.querySelector('input[aria-label="Branch"]')).toBeTruthy();
    expect((document.querySelector('input[aria-label="AI Chats Folder"]') as HTMLInputElement | null)?.value).toBe(
      'SyncNos-AIChats',
    );
    expect((document.querySelector('input[aria-label="Web Clipper Folder"]') as HTMLInputElement | null)?.value).toBe(
      'SyncNos-WebArticles',
    );
    expect((document.querySelector('input[aria-label="Video Scripts Folder"]') as HTMLInputElement | null)?.value).toBe(
      'SyncNos-Videos',
    );
    expect(document.body.textContent || '').toContain(
      'Changing repository or branch never cleans up the previous target.',
    );
    expect(document.querySelector('a[href="https://github.com/apps/syncnos"]')).toBeTruthy();

    const repositoryTrigger = document.querySelector('button#githubRepository') as HTMLButtonElement | null;
    act(() => repositoryTrigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    const repositoryOptions = Array.from(document.querySelectorAll('button[role="menuitemradio"]'));
    expect(repositoryOptions.some((button) => button.textContent?.includes('owner/not-authorized'))).toBe(false);
    const otherRepository = repositoryOptions.find((button) => button.textContent?.includes('owner/other')) as
      | HTMLButtonElement
      | undefined;
    act(() => otherRepository!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(callbacks.onChangeRepository).toHaveBeenCalledWith('owner/other');

    const chatFolderInput = document.querySelector('input[aria-label="AI Chats Folder"]') as HTMLInputElement;
    act(() =>
      chatFolderInput.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    expect(callbacks.onSaveTarget).toHaveBeenCalledTimes(1);
    act(() => chatFolderInput.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })));
    expect(callbacks.onSaveTarget).toHaveBeenCalledTimes(2);

    for (const [label, callback] of [
      ['Disconnect', callbacks.onDisconnect],
      ['Refresh repositories', callbacks.onRefreshRepositories],
      ['Save target', callbacks.onSaveTarget],
      ['Test connection', callbacks.onTestConnection],
    ] as const) {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      expect(button).toBeTruthy();
      act(() => button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
      expect(callback).toHaveBeenCalledTimes(callback === callbacks.onSaveTarget ? 3 : 1);
    }

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
