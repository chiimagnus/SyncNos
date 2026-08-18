import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LocalDatabaseInstallHelp,
  SYNCNOS_CLI_AI_PROMPT,
  SYNCNOS_CLI_DOCTOR_COMMAND,
  SYNCNOS_CLI_INSTALL_COMMAND,
} from '../../src/ui/settings/sections/LocalDatabaseInstallHelp';
import { createLocalDataError, type LocalDataErrorCode } from '../../src/services/local-data/contracts';
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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete (globalThis as any)[key];
  }
}

function unavailableStatus(
  input: {
    browser?: LocalDataMigrationStatus['capability']['browser'];
    officialIdentity?: boolean;
    platform?: LocalDataMigrationStatus['capability']['platform'];
    compatibility?: LocalDataMigrationStatus['host']['compatibility'];
    registration?: LocalDataMigrationStatus['host']['registration'];
    diagnosticCode?: LocalDataErrorCode;
  } = {},
): LocalDataMigrationStatus {
  return {
    actions: { canStart: false, canResume: false },
    capability: {
      browser: input.browser ?? 'chrome',
      officialIdentity: input.officialIdentity ?? true,
      platform: input.platform ?? 'mac',
      supported: input.browser === 'safari' || input.browser === 'development' ? false : true,
    },
    database: { presence: 'unknown', factsHealth: 'unknown' },
    diagnostics: input.diagnosticCode ? [createLocalDataError(input.diagnosticCode)] : [],
    host: {
      registration: input.registration ?? 'unavailable',
      compatibility: input.compatibility ?? 'unknown',
    },
    journal: { mode: 'not_started', stage: 'not_started' },
    profileState: 'unavailable',
    resumeReceipt: 'not_applicable',
  };
}

function buttons() {
  return [...document.querySelectorAll('button')].map((button) => button as HTMLButtonElement);
}

describe('LocalDatabaseInstallHelp', () => {
  let root: ReactDOM.Root | null = null;
  const onCopyText = vi.fn();

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    onCopyText.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    cleanupDom();
  });

  function render(status: LocalDataMigrationStatus, copiedText = '') {
    act(() => {
      root!.render(createElement(LocalDatabaseInstallHelp, { status, copiedText, onCopyText }));
    });
  }

  it('shows the exact one-line install command, exact AI prompt, and doctor repair command for a missing official Host', () => {
    render(unavailableStatus({ platform: 'windows' }));

    expect(SYNCNOS_CLI_INSTALL_COMMAND).toBe('npm install -g @chiimagnus/syncnoscli');
    expect(SYNCNOS_CLI_AI_PROMPT).toBe('请你安装SyncNos CLI：npm install -g @chiimagnus/syncnoscli');
    expect(SYNCNOS_CLI_DOCTOR_COMMAND).toBe('syncnoscli doctor --fix');
    expect(document.body.textContent).toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).toContain(SYNCNOS_CLI_AI_PROMPT);
    expect(document.body.textContent).toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
    expect(document.body.textContent).toContain('does not bypass browser allowlists');
  });

  it('copy buttons only return fixed text to the controller and never execute a command', () => {
    render(unavailableStatus({ platform: 'mac' }));
    const copyButtons = buttons().filter((button) => button.textContent === 'Copy');
    expect(copyButtons).toHaveLength(3);

    act(() => copyButtons[0]!.click());
    act(() => copyButtons[1]!.click());
    act(() => copyButtons[2]!.click());

    expect(onCopyText.mock.calls.map((call) => call[0])).toEqual([
      SYNCNOS_CLI_INSTALL_COMMAND,
      SYNCNOS_CLI_AI_PROMPT,
      SYNCNOS_CLI_DOCTOR_COMMAND,
    ]);

    const source = readFileSync(
      resolve(process.cwd(), 'src/ui/settings/sections/LocalDatabaseInstallHelp.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/node:child_process|child_process|\bexec\s*\(|\bspawn\s*\(|\bexecFile\s*\(/);
    expect(source).not.toMatch(/\bsqlite3\b|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\brm\s+-|\bunlink\s*\(/i);
  });

  it('explains Linux strict sandbox limits instead of presenting doctor --fix as a sandbox bypass', () => {
    render(unavailableStatus({ platform: 'linux' }));

    expect(document.body.textContent).toContain('strict Snap or Flatpak');
    expect(document.body.textContent).toContain('doctor --fix cannot break that sandbox');
    expect(document.body.textContent).toContain('supported non-sandboxed browser package');
  });

  it('offers CLI update plus owned registration repair when Host protocol/schema compatibility is broken', () => {
    render(
      unavailableStatus({
        registration: 'available',
        compatibility: 'schema_mismatch',
        platform: 'mac',
      }),
    );

    expect(document.body.textContent).toContain('does not match this extension protocol/schema');
    expect(document.body.textContent).toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).toContain('Node.js 22 or newer');
    expect(document.body.textContent).toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
  });

  it('guides an official ORIGIN_DENIED permission failure to bounded doctor repair without install or allowlist workarounds', () => {
    render(
      unavailableStatus({
        registration: 'available',
        compatibility: 'unknown',
        diagnosticCode: 'ORIGIN_DENIED',
      }),
    );

    expect(document.body.textContent).toContain('official extension identity');
    expect(document.body.textContent).toContain('Native Host denied access');
    expect(document.body.textContent).toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
    expect(document.body.textContent).toContain('do not edit allowlists or Host paths by hand');
    expect(document.body.textContent).toContain('does not bypass browser allowlists');
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_AI_PROMPT);
  });

  it('keeps BUSY non-destructive and does not pretend doctor can clear a database lock', () => {
    render(
      unavailableStatus({
        registration: 'available',
        compatibility: 'unknown',
        diagnosticCode: 'BUSY',
      }),
    );

    expect(document.body.textContent).toContain('other SyncNos operation finish');
    expect(document.body.textContent).toContain('do not delete or rewrite the database');
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
  });

  it('uses doctor only as a bounded ownership/permission repair for integrity failures', () => {
    render(
      unavailableStatus({
        registration: 'available',
        compatibility: 'unknown',
        diagnosticCode: 'JOURNAL_CORRUPT',
      }),
    );

    expect(document.body.textContent).toContain('ownership, permissions, or integrity');
    expect(document.body.textContent).toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
    expect(document.body.textContent).toContain('refuses unproven ownership');
    expect(document.body.textContent).toContain('does not delete the database');
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_INSTALL_COMMAND);
  });

  it('treats unsupported runtime as an update/runtime issue without promising platform repair', () => {
    render(
      unavailableStatus({
        registration: 'available',
        compatibility: 'unsupported',
        diagnosticCode: 'UNSUPPORTED_PLATFORM',
      }),
    );

    expect(document.body.textContent).toContain('not supported by this Local Database contract');
    expect(document.body.textContent).toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).toContain('Node.js 22 or newer');
    expect(document.body.textContent).toContain('doctor cannot add support for an unsupported platform');
  });

  it('offers no install, doctor, or registration action for Safari', () => {
    render(
      unavailableStatus({
        browser: 'safari',
        officialIdentity: false,
        platform: 'mac',
        registration: 'not_applicable',
        compatibility: 'unsupported',
      }),
    );

    expect(document.body.textContent).toContain('Safari has no Local Database action');
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
    expect(buttons()).toHaveLength(0);
  });

  it('offers no registration bypass for development or sideloaded extension identities', () => {
    render(
      unavailableStatus({
        browser: 'development',
        officialIdentity: false,
        platform: 'linux',
        registration: 'not_applicable',
        compatibility: 'unsupported',
        diagnosticCode: 'ORIGIN_DENIED',
      }),
    );

    expect(document.body.textContent).toContain('not on the official Native Host allowlist');
    expect(document.body.textContent).toContain('cannot create a registration bypass');
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_INSTALL_COMMAND);
    expect(document.body.textContent).not.toContain(SYNCNOS_CLI_DOCTOR_COMMAND);
    expect(buttons()).toHaveLength(0);
  });
});
