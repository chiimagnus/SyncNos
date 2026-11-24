import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';

const { responsiveTierState } = vi.hoisted(() => ({
  responsiveTierState: { value: 'narrow' as 'narrow' | 'medium' | 'wide' },
}));

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      backToChatsAria: 'Back to chats',
      openSettingsAria: 'Open Settings',
      settingsDialogAria: 'Settings dialog',
      closeSettings: 'Close settings',
      resizeSidebar: 'Resize sidebar',
      expandSidebar: 'Expand sidebar',
    };
    return labels[key] || key;
  },
}));

vi.mock('../../src/ui/shared/hooks/useResponsiveTier', () => ({
  useResponsiveTier: () => responsiveTierState.value,
}));

vi.mock('../../src/ui/shared/AppTooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/shared/AppTooltip')>();
  return {
    ...actual,
    AppTooltipHost: () => null,
  };
});

vi.mock('@ui/app/Settings', () => ({
  default: () => createElement('div', null, 'settings'),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  ConversationsProvider: ({ children }: { children: React.ReactNode }) => children,
  useConversationsApp: () => ({
    items: [],
    activeId: null,
    selectedIds: [],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    selectedConversation: null,
    setActiveId: vi.fn(),
    clearSelected: vi.fn(),
    openConversationExternalByLoc: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
    openConversationExternalById: vi.fn(),
    exporting: false,
    syncFeedback: {
      provider: null,
      phase: 'idle',
      total: 0,
      done: 0,
      failures: [],
      message: '',
      updatedAt: 0,
      summary: null,
    },
    deleting: false,
    listSourceFilterKey: 'all',
    listSiteFilterKey: 'all',
    setListSourceFilterKeyPersistent: vi.fn(),
    setListSiteFilterKeyPersistent: vi.fn(),
    pendingListLocateId: null,
    consumeListLocate: vi.fn(),
    exportSelectedMarkdown: vi.fn(),
    syncSelected: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected: vi.fn(),
  }),
}));

vi.mock('../../src/ui/conversations/ConversationsScene', () => ({
  ConversationsScene: (props: { listShell?: { rightSlot: ReactNode } }) => {
    const [mode, setMode] = useState<'list' | 'detail'>('list');
    const toList = () => {
      setMode('list');
    };
    return createElement(
      'div',
      null,
      mode === 'list' ? createElement('div', { 'data-list-header': '1' }, props.listShell?.rightSlot ?? null) : null,
      createElement(
        'button',
        {
          type: 'button',
          onClick: toList,
        },
        'show-list',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            setMode('detail');
          },
        },
        'show-detail',
      ),
      mode === 'detail' ? createElement('div', { 'data-mock-narrow-detail': 'true' }, 'detail') : null,
    );
  },
}));

import AppShell from '../../src/ui/app/AppShell';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
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
  delete (globalThis as any).Element;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).Event;
  delete (globalThis as any).CustomEvent;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('AppShell narrow list header actions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    responsiveTierState.value = 'narrow';
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('keeps list-only settings chrome out of narrow detail mode', () => {
    act(() => {
      root!.render(createElement(AppShell));
    });

    expect(document.querySelector('[aria-label="Open Settings"]')?.getAttribute('data-tooltip-place')).toBe(
      'bottom-end',
    );
    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Open Settings"]')).toBeFalsy();
    expect(document.querySelector('[data-mock-narrow-detail="true"]')).toBeTruthy();
  });

  it.each(['medium', 'wide'] as const)(
    'closes the %s settings sheet without an in-panel close button',
    async (tier) => {
      responsiveTierState.value = tier;
      act(() => root!.render(createElement(AppShell)));

      const opener = document.querySelector<HTMLButtonElement>('button[aria-label="Open Settings"]')!;
      expect(opener).toBeTruthy();
      const open = async () => {
        opener.focus();
        act(() => opener.click());
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        const dialog = document.querySelector<HTMLDivElement>('[role="dialog"][aria-modal="true"]')!;
        expect(dialog).toBeTruthy();
        expect(document.activeElement).toBe(dialog);
        expect(opener.closest('[inert]')).toBeTruthy();
        const dismiss = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close settings"]')!;
        expect(dismiss.parentElement).toBe(dialog);
        expect(dismiss.querySelector('svg')).toBeNull();
        expect(dialog.querySelectorAll('button[aria-label="Close settings"]')).toHaveLength(1);
        return dismiss;
      };

      await open();
      act(() =>
        document.activeElement!.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
      );
      expect(document.querySelector('[aria-modal="true"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(opener.closest('[inert]')).toBeNull();

      const dismiss = await open();
      act(() => dismiss.click());
      expect(document.querySelector('[aria-modal="true"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(opener.closest('[inert]')).toBeNull();
    },
  );
});
