// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  DEFAULT_SETTINGS_SECTION_KEY,
  SETTINGS_ACTIVE_SECTION_STORAGE_KEY,
  SETTINGS_SECTION_GROUPS,
  SETTINGS_SECTIONS,
  coerceSettingsSectionKey,
  readStoredSettingsSection,
} from '../../src/viewmodels/settings/types';
import { AiChatsSection } from '../../src/ui/settings/sections/AiChatsSection';
import { BackupSection } from '../../src/ui/settings/sections/BackupSection';
import { InpageSection } from '../../src/ui/settings/sections/InpageSection';
import { KeyboardShortcutsSection } from '../../src/ui/settings/sections/KeyboardShortcutsSection';
import { VideosSection } from '../../src/ui/settings/sections/VideosSection';
import { ObsidianSettingsSection } from '../../src/ui/settings/sections/ObsidianSettingsSection';
import { GitHubSettingsSection } from '../../src/ui/settings/sections/GitHubSettingsSection';
import { SettingsSidebarNav } from '../../src/ui/settings/SettingsSidebarNav';
import { buildSettingsDocsUrl } from '../../src/ui/settings/SettingsDocsLink';

describe('settings section definitions', () => {
  it('builds localized website docs URLs for settings links', () => {
    expect(buildSettingsDocsUrl('cli', 'en')).toBe('https://chiimagnus.github.io/SyncNos/docs/en/cli/');
    expect(buildSettingsDocsUrl('cli', 'zh')).toBe('https://chiimagnus.github.io/SyncNos/docs/cli/');
    expect(buildSettingsDocsUrl('sync/github', 'en')).toBe('https://chiimagnus.github.io/SyncNos/docs/en/sync/github/');
    expect(buildSettingsDocsUrl('sync/github', 'zh')).toBe('https://chiimagnus.github.io/SyncNos/docs/sync/github/');
  });

  it('keeps the flattened settings navigation order stable', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'general',
      'shortcuts',
      'articles',
      'ai_chats',
      'videos',
      'backup',
      'notion',
      'feishu',
      'obsidian',
      'github',
      'aboutyou',
      'aboutme',
    ]);
  });

  it('accepts only current settings section keys and drops retired deep-link aliases', () => {
    expect(coerceSettingsSectionKey('shortcuts')).toBe('shortcuts');
    expect(coerceSettingsSectionKey('aboutyou')).toBe('aboutyou');
    expect(coerceSettingsSectionKey('aboutme')).toBe('aboutme');
    expect(coerceSettingsSectionKey('insight')).toBeNull();
    expect(coerceSettingsSectionKey('about')).toBeNull();
  });

  it('falls back to the current default for retired stored section aliases', () => {
    setupDom();
    try {
      window.localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, 'insight');
      expect(readStoredSettingsSection()).toBe(DEFAULT_SETTINGS_SECTION_KEY);
      window.localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, 'about');
      expect(readStoredSettingsSection()).toBe(DEFAULT_SETTINGS_SECTION_KEY);
    } finally {
      cleanupDom();
    }
  });

  it('groups sections into integrations, behavior, and about areas', () => {
    expect(SETTINGS_SECTION_GROUPS.map((group) => group.sections.map((section) => section.key))).toEqual([
      ['general', 'shortcuts', 'articles', 'ai_chats', 'videos'],
      ['backup', 'notion', 'feishu', 'obsidian', 'github'],
      ['aboutyou', 'aboutme'],
    ]);
  });

  it('shows the ChatGPT Advanced API toggle only as an explicit default-off capable AI Chats control', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);
    const onToggle = vi.fn();

    act(() => {
      root.render(
        createElement(AiChatsSection, {
          busy: false,
          chatgptApiCaptureEnabled: false,
          onToggleChatgptApiCaptureEnabled: onToggle,
        }),
      );
    });

    const toggle = document.querySelector(
      'input[aria-label="Use the ChatGPT API for the current conversation"]',
    ) as HTMLInputElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle?.checked).toBe(false);
    const text = document.body.textContent || '';
    expect(text).toContain('ChatGPT Advanced capture');
    expect(text).toContain('Off by default');
    expect(text).toContain('no same-save DOM fallback');
    expect(text).not.toContain('How to fetch');
    expect(text).not.toContain('Troubleshooting');
    const helpLink = document.querySelector('a[href="https://chiimagnus.github.io/SyncNos/docs/en/capture-ai-chats/"]');
    expect(helpLink?.textContent).toContain('Help docs');

    act(() => toggle!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(onToggle).toHaveBeenCalledWith(true);

    act(() => root.unmount());
    cleanupDom();
  });

  it('shows the exact supported video URL forms and bounded Bilibili chapter capability', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);

    act(() => {
      root.render(createElement(VideosSection));
    });

    const monoTokens = Array.from(document.querySelectorAll('.tw-font-mono')).map((node) => node.textContent?.trim());
    expect(monoTokens).toEqual([
      'youtube.com/watch',
      'youtu.be',
      'bilibili.com/video/BV…',
      'bilibili.com/list/watchlater?bvid=BV…',
    ]);
    expect(monoTokens).not.toContain('bilibili.com/video');
    const text = document.body.textContent || '';
    expect(text).toContain('loaded chapters');
    expect(text).toContain('official and auto-generated captions');
    expect(text).not.toContain('How to fetch');
    expect(text).not.toContain('Troubleshooting');
    expect(text.toLowerCase()).not.toContain('chapter images');
    expect(text.toLowerCase()).not.toContain('click chapter');

    act(() => root.unmount());
    cleanupDom();
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
    expect(Array.from(groups[0]?.querySelectorAll('button') || []).map((button) => button.textContent?.trim())).toEqual(
      ['General', 'Keyboard shortcuts', 'Web article capture', 'AI chat capture', 'Video capture'],
    );
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
      onSaveBranch: vi.fn(),
      onTestConnection: vi.fn(),
      onInitializeRepository: vi.fn(),
    };
    const baseProps: Parameters<typeof GitHubSettingsSection>[0] = {
      busy: false,
      syncEnabled: true,
      autoSyncEnabled: false,
      auth: { state: 'disconnected' },
      account: null,
      repositoryStatus: null,
      repositories: [],
      repositoriesLoading: false,
      repositoryDiscoveryError: '',
      targetUnavailable: false,
      repository: '',
      branch: 'main',
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
      onSaveBranch: callbacks.onSaveBranch,
      onTestConnection: callbacks.onTestConnection,
      onInitializeRepository: callbacks.onInitializeRepository,
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
    const branchInput = document.querySelector('input[aria-label="Branch"]') as HTMLInputElement | null;
    expect(branchInput).toBeTruthy();
    expect(branchInput?.className || '').toContain('webclipper-field');
    expect(document.querySelector('input[aria-label="AI Chats Folder"]')).toBeNull();
    expect(document.querySelector('input[aria-label="Web Clipper Folder"]')).toBeNull();
    expect(document.querySelector('input[aria-label="Video Scripts Folder"]')).toBeNull();
    expect(document.body.textContent || '').not.toContain('GitHub Paths');
    expect(document.body.textContent || '').not.toContain('Disconnect removes GitHub credentials');
    expect(document.body.textContent || '').not.toContain('To revoke authorization completely');
    expect(document.body.textContent || '').not.toContain('One-way output');
    expect(document.body.textContent || '').not.toContain('Save target');
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

    const refreshButton = document.querySelector(
      'button[aria-label="Refresh repositories"]',
    ) as HTMLButtonElement | null;
    expect(refreshButton).toBeTruthy();
    expect(repositoryTrigger?.parentElement?.parentElement?.contains(refreshButton)).toBe(true);
    act(() => refreshButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(callbacks.onRefreshRepositories).toHaveBeenCalledTimes(1);

    act(() =>
      branchInput!.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    expect(callbacks.onSaveBranch).toHaveBeenCalledTimes(1);
    act(() => branchInput!.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })));
    expect(callbacks.onSaveBranch).toHaveBeenCalledTimes(2);

    for (const [label, callback] of [
      ['Disconnect', callbacks.onDisconnect],
      ['Test connection', callbacks.onTestConnection],
    ] as const) {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      expect(button).toBeTruthy();
      act(() => button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
      expect(callback).toHaveBeenCalledTimes(1);
    }

    act(() => {
      root.render(
        createElement(GitHubSettingsSection, {
          ...baseProps,
          auth: { state: 'connected' },
          account: { login: 'octocat', avatarUrl: '', url: 'https://github.com/octocat' },
          repositoryStatus: 'ready',
          repositories: [{ fullName: 'owner/repo', contentWriteCapable: true }],
          repository: 'owner/repo',
          connectionTest: { status: 'uninitialized' },
        }),
      );
    });
    expect(document.body.textContent || '').toContain(
      'This repository is empty. Initialize it to create README.md and the first commit.',
    );
    const initializeButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Initialize repository',
    ) as HTMLButtonElement | undefined;
    expect(initializeButton).toBeTruthy();
    act(() => initializeButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(callbacks.onInitializeRepository).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    cleanupDom();
  });

  it('scopes GitHub repository discovery loading and errors to repository controls', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);
    const baseProps: Parameters<typeof GitHubSettingsSection>[0] = {
      busy: false,
      syncEnabled: true,
      autoSyncEnabled: true,
      auth: { state: 'connected' },
      account: { login: 'octocat', avatarUrl: '', url: 'https://github.com/octocat' },
      repositoryStatus: 'ready',
      repositories: [{ fullName: 'owner/repo', contentWriteCapable: true }],
      repositoriesLoading: true,
      repositoryDiscoveryError: '',
      targetUnavailable: false,
      repository: 'owner/repo',
      branch: 'main',
      verificationUrl: 'https://github.com/login/device',
      appUrl: 'https://github.com/apps/syncnos',
      installUrl: 'https://github.com/apps/syncnos/installations/new',
      connectionTest: { status: 'uninitialized' },
      githubLogoUrl: '/icons/github.svg',
      onToggleSyncEnabled: () => {},
      onToggleAutoSyncEnabled: () => {},
      onConnect: () => {},
      onCancelDeviceFlow: () => {},
      onDisconnect: () => {},
      onRefreshRepositories: () => {},
      onChangeRepository: () => {},
      onChangeBranch: () => {},
      onSaveBranch: () => {},
      onTestConnection: () => {},
      onInitializeRepository: () => {},
    };

    act(() => {
      root.render(createElement(GitHubSettingsSection, baseProps));
    });

    const repositoryTrigger = document.querySelector('button#githubRepository') as HTMLButtonElement | null;
    const refreshButton = document.querySelector(
      'button[aria-label="Refresh repositories"]',
    ) as HTMLButtonElement | null;
    const disconnectButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Disconnect',
    ) as HTMLButtonElement | undefined;
    const syncToggle = document.querySelector('#githubSyncEnabledToggle') as HTMLInputElement | null;
    const autoSyncToggle = document.querySelector('#githubAutoSyncEnabledToggle') as HTMLInputElement | null;
    const branchInput = document.querySelector('input[aria-label="Branch"]') as HTMLInputElement | null;
    const testButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Test connection',
    ) as HTMLButtonElement | undefined;
    const initializeButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Initialize repository',
    ) as HTMLButtonElement | undefined;
    const appLink = document.querySelector('a[href="https://github.com/apps/syncnos"]') as HTMLAnchorElement | null;

    expect(repositoryTrigger?.disabled).toBe(true);
    expect(refreshButton?.disabled).toBe(true);
    expect(refreshButton?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton?.textContent).toContain('⏳');
    expect(disconnectButton?.disabled).toBe(false);
    expect(syncToggle?.disabled).toBe(false);
    expect(autoSyncToggle?.disabled).toBe(false);
    expect(branchInput?.disabled).toBe(false);
    expect(testButton?.disabled).toBe(false);
    expect(initializeButton?.disabled).toBe(false);
    expect(appLink).toBeTruthy();

    act(() => {
      root.render(
        createElement(GitHubSettingsSection, {
          ...baseProps,
          repositoriesLoading: false,
          repositoryDiscoveryError: 'github_repository_list_failed',
        }),
      );
    });

    const repositoryCard = document.querySelector('section[aria-label="Repository"]');
    const discoveryError = document.querySelector('[data-github-repository-discovery-error="true"]');
    expect(discoveryError?.textContent || '').toContain('github_repository_list_failed');
    expect(repositoryCard?.contains(discoveryError)).toBe(true);
    expect(document.querySelector('[aria-label="settings-error"]')).toBeNull();

    act(() => root.unmount());
    cleanupDom();
  });

  it('uses the unified Obsidian help docs link', () => {
    setupDom();
    const root = ReactDOM.createRoot(document.getElementById('root')!);
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
        }),
      );
    });

    const helpLink = document.querySelector('a[href="https://chiimagnus.github.io/SyncNos/docs/en/sync/obsidian/"]');
    expect(helpLink?.textContent).toContain('Help docs');
    const section = document.querySelector('section[aria-label="Obsidian"]');
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
      cliIntegrationAvailable: true,
      cliIntegrationEnabled: false,
      onToggleCliIntegration: () => {},
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

  function renderShortcuts(props: Partial<Parameters<typeof KeyboardShortcutsSection>[0]> = {}) {
    const baseProps: Parameters<typeof KeyboardShortcutsSection>[0] = {
      status: 'ready',
      items: [
        { action: 'open-popup', shortcut: 'Ctrl+Shift+P' },
        { action: 'capture-current-page', shortcut: '' },
        { action: 'open-app', shortcut: '' },
      ],
      managerAccess: 'openable',
      onOpenManager: () => {},
    };

    act(() => {
      root!.render(createElement(KeyboardShortcutsSection, { ...baseProps, ...props }));
    });
  }

  it('keeps keyboard shortcuts out of General settings', () => {
    renderInpage();

    expect(document.querySelector('section[aria-label="Keyboard shortcuts"]')).toBeNull();
    expect(document.querySelector('section[aria-label="Language"]')).toBeTruthy();
    expect(document.querySelector('section[aria-label="Local CLI Integration"]')).toBeTruthy();
  });

  it('renders browser-managed keyboard shortcuts in the dedicated section', () => {
    renderShortcuts();

    const shortcutSection = document.querySelector('section[aria-label="Keyboard shortcuts"]');
    expect(shortcutSection?.textContent).toContain('Open SyncNos popup');
    expect(shortcutSection?.textContent).toContain('Save current page');
    expect(shortcutSection?.textContent).toContain('Open SyncNos app');
    expect(shortcutSection?.querySelector('kbd')?.textContent).toBe('Ctrl+Shift+P');
    expect(shortcutSection?.textContent).toContain('Unassigned');
  });

  it('opens the native shortcut manager only from the dedicated section callback', () => {
    const onOpenManager = vi.fn();
    renderShortcuts({ onOpenManager });

    const button = document.querySelector('button[aria-label="Manage shortcuts"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    act(() => button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(onOpenManager).toHaveBeenCalledTimes(1);
  });

  it('shows manual shortcut guidance without a dead manage button', () => {
    renderShortcuts({ managerAccess: 'manual' });

    expect(document.body.textContent || '').toContain(
      'Configure these actions in your browser’s extension keyboard shortcut settings.',
    );
    expect(document.querySelector('button[aria-label="Manage shortcuts"]')).toBeNull();
  });

  it('shows unsupported shortcut discovery inside the dedicated page only', () => {
    renderShortcuts({ status: 'unsupported', managerAccess: 'unsupported' });

    expect(document.body.textContent || '').toContain('This browser cannot read extension keyboard shortcuts.');
    expect(document.querySelector('section[aria-label="Local CLI Integration"]')).toBeNull();
  });

  it('renders Local CLI Integration and forwards the user toggle', () => {
    const onToggleCliIntegration = vi.fn();
    renderInpage({ onToggleCliIntegration });

    const section = document.querySelector('section[aria-label="Local CLI Integration"]');
    const checkbox = section?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(section?.textContent).toContain('Enable SyncNos CLI');
    expect(section?.querySelector('a[href="https://chiimagnus.github.io/SyncNos/docs/en/cli/"]')).toBeTruthy();
    expect(checkbox).toBeTruthy();
    expect(checkbox?.disabled).toBe(false);

    act(() => {
      checkbox!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleCliIntegration).toHaveBeenCalledWith(true);
  });

  it('disables Local CLI Integration when Native Messaging is unavailable', () => {
    renderInpage({ cliIntegrationAvailable: false });
    const section = document.querySelector('section[aria-label="Local CLI Integration"]');
    const checkbox = section?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox?.disabled).toBe(true);
    expect(section?.textContent).toContain('Native Messaging is unavailable');
  });

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
    expect(input?.className || '').toContain('webclipper-field');

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
