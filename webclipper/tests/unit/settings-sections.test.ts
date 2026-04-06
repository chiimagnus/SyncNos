import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from '../../src/viewmodels/settings/types';
import { InpageSection } from '../../src/ui/settings/sections/InpageSection';

describe('settings section definitions', () => {
  it('keeps the flattened settings navigation order stable', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'general',
      'chat_with',
      'backup',
      'notion',
      'obsidian',
      'aboutyou',
      'aboutme',
    ]);
  });

  it('groups sections into integrations, behavior, and about areas', () => {
    expect(
      SETTINGS_SECTION_GROUPS.map((group) => ({
        titleKey: group.titleKey,
        keys: group.sections.map((section) => section.key),
      })),
    ).toEqual([
      { titleKey: 'settingsGroupFeatures', keys: ['general', 'chat_with'] },
      { titleKey: 'settingsGroupData', keys: ['backup', 'notion', 'obsidian'] },
      { titleKey: 'settingsGroupAbout', keys: ['aboutyou', 'aboutme'] },
    ]);
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

describe('inpage anti-hotlink advanced editor', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  function renderInpage(props: Partial<Parameters<typeof InpageSection>[0]> = {}) {
    const baseProps: Parameters<typeof InpageSection>[0] = {
      busy: false,
      displayMode: 'supported',
      onChangeDisplayMode: () => {},
      markdownReadingProfile: 'medium',
      onChangeMarkdownReadingProfile: () => {},
      aiChatAutoSaveEnabled: true,
      onToggleAiChatAutoSaveEnabled: () => {},
      aiChatCacheImagesEnabled: true,
      onToggleAiChatCacheImagesEnabled: () => {},
      webArticleCacheImagesEnabled: true,
      onToggleWebArticleCacheImagesEnabled: () => {},
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

    const button = document.querySelector('button[aria-controls="anti-hotlink-domains-editor"]') as
      | HTMLButtonElement
      | null;
    expect(button).toBeTruthy();
    expect(document.querySelector('#anti-hotlink-domains-editor')).toBeFalsy();

    act(() => {
      button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it('renders editor rows and validation errors when expanded', () => {
    renderInpage({
      antiHotlinkAdvancedOpen: true,
      antiHotlinkRules: [{ domain: 'https://bad-domain', referer: 'notaurl' }],
      antiHotlinkRuleErrors: [{ domain: 'Domain must be a valid hostname.', referer: 'Referer must be a valid http(s) URL.' }],
    });

    expect(document.querySelector('#anti-hotlink-domains-editor')).toBeTruthy();
    expect(document.querySelector('input[aria-label="Domain 1"]')).toBeTruthy();
    expect(document.querySelector('input[aria-label="Referer 1"]')).toBeTruthy();
    expect(document.body.textContent || '').toContain('Domain must be a valid hostname.');
    expect(document.body.textContent || '').toContain('Referer must be a valid http(s) URL.');
  });

  it('wires editor add/remove/reset and blur-save callbacks', () => {
    const onAddRule = vi.fn();
    const onRemoveRule = vi.fn();
    const onApplyRules = vi.fn();
    const onResetRules = vi.fn();

    renderInpage({
      antiHotlinkAdvancedOpen: true,
      antiHotlinkRules: [{ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }],
      onAddAntiHotlinkRule: onAddRule,
      onRemoveAntiHotlinkRule: onRemoveRule,
      onApplyAntiHotlinkRules: onApplyRules,
      onResetAntiHotlinkRules: onResetRules,
    });

    expect(document.querySelector('input[aria-label="Domain 1"]')).toBeTruthy();
    expect(document.querySelector('input[aria-label="Referer 1"]')).toBeTruthy();

    const buttons = Array.from(document.querySelectorAll('button'));
    const addButton = buttons.find((button) => button.textContent?.trim() === 'Add domain') as HTMLButtonElement | undefined;
    const deleteButton = buttons.find((button) => button.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
    const resetButton = buttons.find((button) => button.textContent?.trim() === 'Reset') as HTMLButtonElement | undefined;

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

    const domainInput = document.querySelector('input[aria-label="Domain 1"]') as HTMLInputElement | null;
    expect(domainInput).toBeTruthy();
    act(() => {
      domainInput!.dispatchEvent(new window.FocusEvent('blur', { bubbles: true, relatedTarget: document.body }));
    });
    expect(onApplyRules).toHaveBeenCalledTimes(1);
  });
});
