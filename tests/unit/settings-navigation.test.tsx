// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from '@ui/app/Settings';
import { SETTINGS_ACTIVE_SECTION_STORAGE_KEY } from '@viewmodels/settings/types';

const controller = vi.hoisted(() => vi.fn());
vi.mock('@viewmodels/settings/useSettingsSceneController', () => ({
  useSettingsSceneController: controller,
}));
vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({ openConversationInListScopeByLoc: vi.fn() }),
}));

function NavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-route="true">{location.pathname + location.search}</output>
      <button data-open="true" onClick={() => navigate('/settings', { state: { from: '/?loc=original' } })}>
        Open
      </button>
      <button data-deep-link="true" onClick={() => navigate('/settings?section=aboutme')}>
        About
      </button>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/" element={null} />
      </Routes>
    </>
  );
}

describe('settings navigation', () => {
  let root: Root;
  let host: HTMLDivElement;
  const resize = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    act(() => window.dispatchEvent(new Event('resize')));
  };
  const route = () => host.querySelector('[data-route]')?.textContent;
  const click = (selector: string) => {
    const button = host.querySelector<HTMLButtonElement>(selector);
    expect(button).toBeTruthy();
    act(() => button!.click());
  };
  const list = () => host.querySelector('.settings-sidebar');
  const detail = () => host.querySelector('.settings-detail');
  const render = (initial = '/') => {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={[initial]}>
          <NavigationHarness />
        </MemoryRouter>,
      ),
    );
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    resize(420);
    controller.mockReset();
    controller.mockReturnValue({
      busy: false,
      localePreference: 'system',
      inpageDisplayMode: 'supported',
      aboutYouUserName: '',
      aiChatAutoSaveEnabled: true,
      aiChatIncludeThinkingEnabled: true,
      aiChatDollarMentionEnabled: true,
      chatgptApiCaptureEnabled: false,
      aiChatCacheImagesEnabled: true,
      webArticleCacheImagesEnabled: true,
      cliIntegrationAvailable: true,
      cliIntegrationEnabled: false,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resize(1024);
    vi.unstubAllGlobals();
  });

  it.each([320, 420, 767])('opens the category list at %ipx and returns to it on reopening', (width) => {
    resize(width);
    window.localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, 'aboutme');
    render();
    click('[data-open]');
    expect(route()).toBe('/settings');
    expect(list()?.querySelectorAll('[data-settings-section]')).toHaveLength(10);
    expect(detail()).toBeNull();
    click('[data-settings-section="aboutme"]');
    expect(route()).toBe('/settings?section=aboutme');
    expect(list()).toBeNull();
    expect(detail()?.querySelector('h1')).toBe(document.activeElement);
    click('.settings-detail-header button:first-child');
    expect(route()).toBe('/settings');
    expect(detail()).toBeNull();
    expect(document.activeElement).toBe(list()?.querySelector('[data-settings-section="aboutme"]'));
    click('[data-settings-section="cli"]');
    expect(route()).toBe('/settings?section=cli');
    expect(detail()).toBeTruthy();
    click('.settings-detail-header button:last-child');
    expect(route()).toBe('/?loc=original');
    expect(window.localStorage.getItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY)).toBe('cli');
    click('[data-open]');
    expect(list()).toBeTruthy();
    expect(detail()).toBeNull();
    expect(list()?.querySelector('img[src*="icon-128"]')).toBeNull();
    click('.settings-sidebar__close');
    expect(route()).toBe('/?loc=original');
  });

  it('keeps explicit deep links and clears section and focus when returning to the list', () => {
    window.localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, 'cli');
    render('/settings?section=backup&focus=import&other=kept');
    expect(list()).toBeNull();
    expect(detail()?.querySelector('#settings-backup-import')).toBeTruthy();
    expect(controller).toHaveBeenLastCalledWith({ activeSection: 'backup', focusKey: 'import' });
    click('.settings-detail-header button:first-child');
    expect(route()).toBe('/settings?other=kept');
    expect(detail()).toBeNull();
    expect(document.activeElement).toBe(list()?.querySelector('[data-settings-section="backup"]'));
    click('[data-deep-link]');
    expect(list()).toBeNull();
    expect(detail()?.querySelector('#linkAboutSource')).toBeTruthy();
  });

  it('uses the library close icon for settings errors and preserves dismissal', () => {
    const clearError = vi.fn();
    controller.mockReturnValue({ ...controller(), error: 'Test settings error', clearError });
    render('/settings?section=aboutme');
    const dismiss = detail()?.querySelector<HTMLButtonElement>('button[aria-label="dismiss error"]');
    expect(dismiss?.querySelector('svg.lucide-x[aria-hidden="true"]')).toBeTruthy();
    act(() => dismiss!.click());
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it('shows the category list for an invalid section instead of opening the stored section', () => {
    window.localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, 'aboutme');
    render('/settings?section=unknown');
    expect(list()).toBeTruthy();
    expect(detail()).toBeNull();
  });

  it.each([768, 850, 1440])('preserves the split settings view at %ipx', (width) => {
    resize(width);
    window.localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, 'aboutme');
    render('/settings');
    expect(list()).toBeTruthy();
    expect(detail()?.querySelector('#linkAboutSource')).toBeTruthy();
    expect(detail()?.querySelector('.settings-detail-header')).toBeNull();
    resize(420);
    expect(list()).toBeTruthy();
    expect(detail()).toBeNull();
    click('[data-settings-section="aboutme"]');
    expect(list()).toBeNull();
    expect(detail()).toBeTruthy();
    resize(width);
    expect(list()).toBeTruthy();
    expect(detail()).toBeTruthy();
    resize(420);
    expect(list()).toBeNull();
    expect(detail()).toBeTruthy();
  });
});
