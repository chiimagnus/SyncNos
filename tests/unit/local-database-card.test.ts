import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { LocalDatabaseCard } from '../../src/ui/settings/sections/LocalDatabaseCard';
import type { LocalDataMigrationStatus } from '../../src/services/local-data/migration-status';

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
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent });
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: dom.window.PointerEvent ?? dom.window.MouseEvent,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

async function flushReactScheduler() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function cleanupDom() {
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Node',
    'KeyboardEvent',
    'PointerEvent',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as any)[key];
  }
}

function status(
  profileState: LocalDataMigrationStatus['profileState'],
  overrides: Partial<LocalDataMigrationStatus> = {},
): LocalDataMigrationStatus {
  const journal =
    profileState === 'active'
      ? ({ mode: 'active', stage: 'active' } as const)
      : profileState === 'migration_in_progress'
        ? ({ mode: 'transitional', stage: 'staging', migrationId: '11111111-1111-4111-8111-111111111111' } as const)
        : profileState === 'blocked'
          ? ({ mode: 'blocked', stage: null } as const)
          : ({ mode: 'not_started', stage: 'not_started' } as const);
  return {
    actions: {
      canStart: profileState === 'setup_required' || profileState === 'join_existing_required',
      canResume: profileState === 'migration_in_progress',
    },
    capability: { browser: 'chrome', officialIdentity: true, supported: true },
    database: {
      presence: profileState === 'setup_required' ? 'missing' : 'present',
      factsHealth: profileState === 'setup_required' ? 'unknown' : 'healthy',
      factsRevision: profileState === 'setup_required' ? null : 3,
      ftsAvailable: profileState === 'setup_required' ? null : true,
    },
    diagnostics: [],
    host: { registration: 'available', compatibility: 'compatible' },
    journal,
    profileState,
    resumeReceipt: profileState === 'migration_in_progress' ? 'absent' : 'not_applicable',
    ...overrides,
  } as LocalDataMigrationStatus;
}

function clickByText(text: string) {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  expect(button).toBeTruthy();
  act(() => (button as HTMLButtonElement).click());
}

describe('LocalDatabaseCard', () => {
  let root: ReactDOM.Root | null = null;
  const callbacks = {
    onCancelMigration: vi.fn(),
    onConfirmMigration: vi.fn(),
    onRequestMigration: vi.fn(),
    onResumeMigration: vi.fn(),
    onRetryStatus: vi.fn(),
  };

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    for (const callback of Object.values(callbacks)) callback.mockReset();
  });

  afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    await flushReactScheduler();
    cleanupDom();
  });

  function render(
    input: {
      state?: LocalDataMigrationStatus['profileState'];
      statusOverride?: Partial<LocalDataMigrationStatus>;
      dialogMode?: 'start' | 'join' | null;
      actionBusy?: boolean;
    } = {},
  ) {
    const value = input.state ? status(input.state, input.statusOverride) : null;
    act(() => {
      root!.render(
        createElement(LocalDatabaseCard, {
          status: value,
          loading: false,
          error: '',
          actionBusy: input.actionBusy ?? false,
          dialogMode: input.dialogMode ?? null,
          ...callbacks,
        }),
      );
    });
  }

  it('renders initial setup, existing-db join, resumable migration, blocked, active, and Safari states from typed status', () => {
    render({ state: 'setup_required' });
    expect(document.body.textContent).toContain('Ready to enable');
    expect(document.body.textContent).toContain('Enable Local Database');

    render({ state: 'join_existing_required' });
    expect(document.body.textContent).toContain('Join existing local database');
    expect(document.body.textContent).toContain('Join Existing Database');
    expect(document.body.textContent).toContain('explicitly join');

    render({ state: 'migration_in_progress' });
    expect(document.body.textContent).toContain('Resume Migration');
    expect(document.body.textContent).toContain('Stage:');

    render({ state: 'blocked' });
    expect(document.body.textContent).toContain('migration blocked');
    expect(document.body.textContent).toContain('Check again');

    render({ state: 'active' });
    expect(document.body.textContent).toContain('Local Database enabled');
    expect(document.body.textContent).toContain('fixed SyncNos application-data location');
    expect(document.body.textContent?.toLowerCase()).not.toContain('disable');
    expect(document.body.textContent?.toLowerCase()).not.toContain('rollback');
    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual([]);

    render({
      state: 'unavailable',
      statusOverride: {
        capability: { browser: 'safari', officialIdentity: false, supported: false },
        host: { registration: 'unsupported', compatibility: 'unknown' },
      },
    });
    expect(document.body.textContent).toContain('not available in Safari');
    expect(document.body.textContent).not.toContain('Enable Local Database');
  });

  it('maps primary actions to request or resume callbacks and disables duplicate actions while busy', () => {
    render({ state: 'join_existing_required' });
    clickByText('Join Existing Database');
    expect(callbacks.onRequestMigration).toHaveBeenCalledTimes(1);

    render({ state: 'migration_in_progress' });
    clickByText('Resume Migration');
    expect(callbacks.onResumeMigration).toHaveBeenCalledTimes(1);

    render({ state: 'setup_required', actionBusy: true });
    const button = document.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('shows the exact safety confirmation and lets Cancel, X, Escape, and backdrop dismiss before confirmation', () => {
    render({ state: 'setup_required', dialogMode: 'start' });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const text = dialog.textContent || '';
    expect(text).toContain('Five captured-facts stores are migrated');
    expect(text).toContain('cleared only after the SQLite receipt and verification succeed');
    expect(text).toContain('there is no switch back to IndexedDB');
    expect(text).toContain('OAuth credentials stay in this browser profile');
    expect((document.activeElement as HTMLElement)?.textContent).toContain('Cancel');

    clickByText('Cancel');
    expect(callbacks.onCancelMigration).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirmMigration).not.toHaveBeenCalled();

    callbacks.onCancelMigration.mockClear();
    render({ state: 'setup_required', dialogMode: 'start' });
    const close = document.querySelector('[aria-label="Close Local Database confirmation"]') as HTMLButtonElement;
    act(() => close.click());
    expect(callbacks.onCancelMigration).toHaveBeenCalledTimes(1);

    callbacks.onCancelMigration.mockClear();
    render({ state: 'setup_required', dialogMode: 'start' });
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(callbacks.onCancelMigration).toHaveBeenCalledTimes(1);

    callbacks.onCancelMigration.mockClear();
    render({ state: 'setup_required', dialogMode: 'start' });
    const overlay = document.querySelector('.tw-fixed.tw-inset-0') as HTMLElement;
    act(() => overlay.dispatchEvent(new (globalThis.PointerEvent as any)('pointerdown', { bubbles: true })));
    expect(callbacks.onCancelMigration).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirmMigration).not.toHaveBeenCalled();
  });

  it('adds conservative-merge wording for explicit join and blocks dismiss/confirm controls while action is running', () => {
    render({ state: 'join_existing_required', dialogMode: 'join', actionBusy: true });
    expect(document.body.textContent).toContain('existing SQLite facts are preserved');
    expect(document.body.textContent).toContain('only this profile’s IndexedDB facts are cleared');
    for (const button of document.querySelectorAll('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(callbacks.onCancelMigration).not.toHaveBeenCalled();
  });
});
