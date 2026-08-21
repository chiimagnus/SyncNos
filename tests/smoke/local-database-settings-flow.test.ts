import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageRemove: vi.fn(),
  portListener: null as ((message: any) => void) | null,
  exportBackupZip: vi.fn(),
  importBackupFile: vi.fn(),
}));

vi.mock('@services/shared/runtime', () => ({ send: mocks.send }));
vi.mock('@services/shared/storage', () => ({
  storageGet: mocks.storageGet,
  storageSet: mocks.storageSet,
  storageRemove: mocks.storageRemove,
  storageOnChanged: () => () => {},
}));
vi.mock('@services/shared/ports', () => ({
  connectPort: () => ({
    onMessage: {
      addListener(listener: (message: any) => void) {
        mocks.portListener = listener;
      },
      removeListener(listener: (message: any) => void) {
        if (mocks.portListener === listener) mocks.portListener = null;
      },
    },
    disconnect: vi.fn(),
  }),
}));
vi.mock('@services/sync/backup/client', () => ({
  exportBackupZip: mocks.exportBackupZip,
  importBackupFile: mocks.importBackupFile,
}));
vi.mock('@services/sync/feishu/settings-store', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getFeishuPathConfig: vi.fn(async () => null),
    saveFeishuPathConfig: vi.fn(async (value: any) => value),
  };
});
vi.mock('@services/integrations/chatwith/chatwith-settings', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadChatWithSettings: vi.fn(async () => ({
      promptTemplate: actual.DEFAULT_CHAT_WITH_PROMPT_TEMPLATE,
      platforms: actual.DEFAULT_CHAT_WITH_PLATFORMS,
    })),
  };
});
vi.mock('@services/integrations/anti-hotlink/anti-hotlink-settings', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, loadAntiHotlinkRulesForSettings: vi.fn(async () => []) };
});
vi.mock('@viewmodels/settings/utils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    openHttpUrl: vi.fn(() => true),
  };
});

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationProfileReferencePatch,
  type FactsMigrationReceipt,
  type MigrationId,
} from '@services/local-data/contracts';
import { sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import {
  createMigrationCoordinator,
  type MigrationCoordinator,
  type MigrationRuntimeEnvironment,
} from '@services/local-data/migration-coordinator';
import type { ProfileReferenceRebase } from '@services/local-data/profile-reference-rebase';
import { readMigrationJournal, type MigrationJournalRuntime } from '@platform/local-data/migration-journal';
import { createLocalFactsRevisionMonitor } from '@services/conversations/client/local-data-revision';
import { useSettingsSceneController } from '@viewmodels/settings/useSettingsSceneController';
import { LocalDatabaseCard } from '@ui/settings/sections/LocalDatabaseCard';
import { createTestBackgroundRouter } from './background-router-testkit';
import { nodeDigestProvider } from '../../packages/syncnoscli/src/runtime/node-digest';

const PROFILE_A_ID = '11111111-1111-4111-8111-111111111111' as MigrationId;
const PROFILE_B_ID = '22222222-2222-4222-8222-222222222222' as MigrationId;
const ZERO_COUNTS = Object.freeze({
  conversations: 0,
  sync_mappings: 0,
  messages: 0,
  image_cache: 0,
  article_comments: 0,
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function environment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true };
}

function createJournalRuntime(migrationId: MigrationId): MigrationJournalRuntime {
  const values = new Map<string, unknown>();
  let now = 100;
  return {
    digestProvider: nodeDigestProvider,
    now: () => ++now,
    randomUUID: () => migrationId,
    storage: {
      async get(keys) {
        return Object.fromEntries(
          keys.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))]),
        );
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      },
    },
  };
}

function manifest(migrationId: MigrationId, conversationCount: number): FactsManifest {
  return createFactsManifest({
    migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: { ...ZERO_COUNTS, conversations: conversationCount },
    streamBytes: { ...ZERO_COUNTS, conversations: conversationCount * 32 },
    orderedFrameDigest: migrationId.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  });
}

async function receiptFor(value: FactsManifest, factsRevision: number): Promise<FactsMigrationReceipt> {
  return {
    alreadyCommitted: false,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: value.factCounts,
    factsRevision,
    manifestDigest: await sha256Hex(nodeDigestProvider, encodeCanonicalJson(value).bytes),
    migrationId: value.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  };
}

function createProfileReferences(): ProfileReferenceRebase {
  const patch = parseMigrationProfileReferencePatch({
    version: 1,
    diagnostics: { staleQueueEntriesDropped: { notion: 0, obsidian: 0, feishu: 0 } },
    queues: { notion: [], obsidian: [], feishu: [] },
    syncJobs: { notion: null, obsidian: null, feishu: null },
  });
  return {
    buildPatch: vi.fn(async () => patch),
    applyAndVerify: vi.fn(async () => {}),
    verifyApplied: vi.fn(async () => {}),
  };
}

function createSharedHost() {
  let databaseExists = false;
  let factsRevision = 0;
  const facts = new Set<string>();
  const receipts = new Map<string, FactsMigrationReceipt>();
  const importCalls = new Map<string, number>();
  const receiptEntered = deferred();
  const releaseReceipt = deferred();

  const nativeRequest = vi.fn(async (command: string, payload: Record<string, unknown>) => {
    if (command === 'GET_STATUS') {
      if (!databaseExists) throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
      return { databaseUuid: 'private-shared-db', factsRevision, fts: { available: true, reason: null } };
    }
    if (command === 'GET_FACTS_REVISION') {
      if (!databaseExists) throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
      return { factsRevision };
    }
    if (command === 'GET_MIGRATION_RECEIPT') return receipts.get(String(payload.migrationId || '')) ?? null;
    throw new Error(`unexpected Host command: ${command}`);
  });

  const nativeImport = vi.fn(async ({ migrationId, produce }: any) => {
    importCalls.set(migrationId, (importCalls.get(migrationId) ?? 0) + 1);
    const producedManifest = await produce({ onFrame: async () => {}, signal: new AbortController().signal });
    if (migrationId === PROFILE_A_ID) {
      receiptEntered.resolve();
      await releaseReceipt.promise;
    }
    for (const stableIdentity of migrationId === PROFILE_A_ID
      ? ['chatgpt\0a-only', 'web\0shared']
      : ['gemini\0b-only', 'web\0shared']) {
      facts.add(stableIdentity);
    }
    databaseExists = true;
    factsRevision += 1;
    const receipt = await receiptFor(producedManifest, factsRevision);
    receipts.set(migrationId, receipt);
    return receipt;
  });

  return {
    facts,
    receipts,
    nativeImport,
    nativeRequest,
    receiptEntered: receiptEntered.promise,
    releaseReceipt: () => releaseReceipt.resolve(),
    get factsRevision() {
      return factsRevision;
    },
    getImportCalls(migrationId: MigrationId) {
      return importCalls.get(migrationId) ?? 0;
    },
  };
}

type ProfileHarness = Readonly<{
  clearSourceFacts: ReturnType<typeof vi.fn>;
  coordinator: MigrationCoordinator;
  journalRuntime: MigrationJournalRuntime;
  verifyEntered: Promise<void>;
  releaseVerify: () => void;
}>;

function createProfileHarness(input: {
  host: ReturnType<typeof createSharedHost>;
  migrationId: MigrationId;
  pauseVerify?: boolean;
}): ProfileHarness {
  const journalRuntime = createJournalRuntime(input.migrationId);
  const clearSourceFacts = vi.fn(async () => {
    if (!input.host.receipts.has(input.migrationId)) {
      throw new Error('source facts cleared before the matching Host receipt existed');
    }
  });
  const verifyEntered = deferred();
  const releaseVerify = deferred();
  const profileReferences = createProfileReferences();
  const coordinator = createMigrationCoordinator({
    clearSourceFacts,
    digestProvider: nodeDigestProvider,
    gate: {
      closeAdmissions: vi.fn(),
      reopenForJournalState: vi.fn(),
      waitForDrained: vi.fn(async () => {}),
    },
    journalRuntime,
    nativeImport: input.host.nativeImport,
    nativeRequest: input.host.nativeRequest,
    profileReferences,
    readEnvironment: environment,
    transferFacts: async () => manifest(input.migrationId, 2),
    verifySourceFactsEmpty: async () => {
      verifyEntered.resolve();
      if (input.pauseVerify) await releaseVerify.promise;
      return { counts: ZERO_COUNTS, empty: true };
    },
  });
  return {
    clearSourceFacts,
    coordinator,
    journalRuntime,
    verifyEntered: verifyEntered.promise,
    releaseVerify: () => releaseVerify.resolve(),
  };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:syncnos-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

function cleanupDom() {
  for (const key of [
    'browser',
    'window',
    'document',
    'navigator',
    'location',
    'HTMLElement',
    'HTMLAnchorElement',
    'Node',
    'Event',
    'MouseEvent',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as any)[key];
  }
}

async function flush() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await flush();
    });
  }
  throw new Error(`timed out waiting for ${label}`);
}

function buttonIn(selector: string, index = 0): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
  const button = buttons[index];
  if (!button) throw new Error(`missing button ${selector}[${index}]`);
  return button;
}

describe('Local Database settings flow', () => {
  let root: ReactDOM.Root | null = null;
  let activeRouter: ReturnType<typeof createTestBackgroundRouter>;
  let latest: ReturnType<typeof useSettingsSceneController>;

  function Harness() {
    latest = useSettingsSceneController({ activeSection: 'backup' });
    return createElement(LocalDatabaseCard, {
      actionBusy: latest.localDataActionBusy,
      copiedHelpText: latest.localDataCopiedHelpText,
      dialogMode: latest.localDataMigrationDialogMode,
      error: latest.localDataStatusError,
      loading: latest.localDataStatusLoading,
      status: latest.localDataStatus,
      onCancelMigration: latest.onLocalDataCancelMigration,
      onConfirmMigration: () => {
        void latest.onLocalDataConfirmMigration();
      },
      onCopyHelpText: (text: string) => {
        void latest.onLocalDataCopyHelpText(text);
      },
      onRequestMigration: latest.onLocalDataRequestMigration,
      onRetryStatus: () => {
        void latest.onLocalDataRetryStatus();
      },
    });
  }

  async function mount(router: ReturnType<typeof createTestBackgroundRouter>) {
    activeRouter = router;
    if (root) {
      act(() => root?.unmount());
      await flush();
    }
    document.getElementById('root')!.replaceChildren();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => {
      root!.render(createElement(Harness));
      await flush();
    });
    await waitFor(() => latest.localDataStatus !== null && !latest.localDataStatusLoading, 'Local Database status');
  }

  beforeEach(() => {
    setupDom();
    mocks.send.mockReset();
    mocks.storageGet.mockReset();
    mocks.storageSet.mockReset();
    mocks.storageRemove.mockReset();
    mocks.exportBackupZip.mockReset();
    mocks.importBackupFile.mockReset();
    mocks.portListener = null;
    mocks.send.mockResolvedValue({ ok: true, data: { connected: false }, error: null });
    mocks.storageGet.mockResolvedValue({});
    mocks.storageSet.mockResolvedValue(undefined);
    mocks.storageRemove.mockResolvedValue(undefined);
    mocks.importBackupFile.mockResolvedValue({
      conversationsAdded: 0,
      conversationsUpdated: 0,
      messagesAdded: 0,
      messagesUpdated: 0,
      messagesSkipped: 0,
      commentsAdded: 0,
      commentsUpdated: 0,
      commentsSkipped: 0,
      mappingsAdded: 0,
      mappingsUpdated: 0,
      settingsApplied: 0,
    });
    mocks.exportBackupZip.mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'syncnos-backup.zip',
    });
    Object.defineProperty(globalThis, 'browser', {
      configurable: true,
      value: {
        runtime: {
          id: 'hmgjflllphdffeocddjjcfllifhejpok',
          sendMessage: async (message: unknown) => await activeRouter.__handleMessageForTests(message as any),
        },
      },
    });
  });

  afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    await flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanupDom();
  });

  it('keeps confirmation, receipt, cleanup verification, explicit second-profile join, focus refresh, backup, and active UI on one safe path', async () => {
    const host = createSharedHost();
    const profileA = createProfileHarness({ host, migrationId: PROFILE_A_ID, pauseVerify: true });
    const profileB = createProfileHarness({ host, migrationId: PROFILE_B_ID });
    const routerA = createTestBackgroundRouter({ migrationCoordinator: profileA.coordinator });
    const routerB = createTestBackgroundRouter({ migrationCoordinator: profileB.coordinator });

    await mount(routerA);
    expect(latest.localDataStatus?.profileState).toBe('setup_required');
    expect((await readMigrationJournal(profileA.journalRuntime)).mode).toBe('not_started');
    expect(host.getImportCalls(PROFILE_A_ID)).toBe(0);
    expect(profileA.clearSourceFacts).not.toHaveBeenCalled();

    act(() => buttonIn('section[data-local-database-state="setup_required"] button', 0).click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect((await readMigrationJournal(profileA.journalRuntime)).mode).toBe('not_started');
    expect(host.getImportCalls(PROFILE_A_ID)).toBe(0);
    expect(profileA.clearSourceFacts).not.toHaveBeenCalled();

    act(() => buttonIn('[role="dialog"] button', 2).click());
    await host.receiptEntered;
    expect(await readMigrationJournal(profileA.journalRuntime)).toMatchObject({
      mode: 'transitional',
      journal: { stage: 'staging' },
    });
    expect(profileA.clearSourceFacts).not.toHaveBeenCalled();

    host.releaseReceipt();
    await profileA.verifyEntered;
    expect(profileA.clearSourceFacts).toHaveBeenCalledTimes(1);
    expect(await readMigrationJournal(profileA.journalRuntime)).toMatchObject({
      mode: 'transitional',
      journal: { stage: 'cleanup_pending' },
    });
    expect(latest.localDataStatus?.profileState).not.toBe('active');

    profileA.releaseVerify();
    await waitFor(() => latest.localDataStatus?.profileState === 'active', 'profile A activation');
    expect(await readMigrationJournal(profileA.journalRuntime)).toMatchObject({
      mode: 'active',
      factsEpoch: `native:${PROFILE_A_ID}`,
    });

    const revisionRefresh = vi.fn(async () => {});
    const revisionMonitor = createLocalFactsRevisionMonitor({
      getSnapshot: async () => ({
        factsEpoch: `native:${PROFILE_A_ID}`,
        factsRevision: (await profileA.coordinator.getFactsRevision())!,
      }),
    });
    revisionMonitor.setSnapshot({ factsEpoch: `native:${PROFILE_A_ID}`, factsRevision: 1 });
    await expect(revisionMonitor.checkForExternalChange(revisionRefresh)).resolves.toEqual({
      factsEpoch: `native:${PROFILE_A_ID}`,
      factsRevision: 1,
      refreshed: false,
      revisionChanged: false,
    });
    expect(revisionRefresh).not.toHaveBeenCalled();

    await mount(routerB);
    expect(latest.localDataStatus?.profileState).toBe('join_existing_required');
    expect((await readMigrationJournal(profileB.journalRuntime)).mode).toBe('not_started');
    expect(host.getImportCalls(PROFILE_B_ID)).toBe(0);

    act(() => buttonIn('section[data-local-database-state="join_existing_required"] button', 0).click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.getImportCalls(PROFILE_B_ID)).toBe(0);
    expect(profileB.clearSourceFacts).not.toHaveBeenCalled();

    act(() => buttonIn('[role="dialog"] button', 2).click());
    await waitFor(() => latest.localDataStatus?.profileState === 'active', 'profile B activation');
    expect(host.facts).toEqual(new Set(['chatgpt\0a-only', 'web\0shared', 'gemini\0b-only']));
    expect(host.getImportCalls(PROFILE_B_ID)).toBe(1);
    expect(profileB.clearSourceFacts).toHaveBeenCalledTimes(1);
    expect(host.factsRevision).toBe(2);

    await expect(revisionMonitor.checkForExternalChange(revisionRefresh)).resolves.toEqual({
      factsEpoch: `native:${PROFILE_A_ID}`,
      factsRevision: 2,
      refreshed: true,
      revisionChanged: true,
    });
    expect(revisionRefresh).toHaveBeenCalledTimes(1);

    await mount(routerA);
    expect(latest.localDataStatus?.profileState).toBe('active');
    const activeCard = document.querySelector('section[data-local-database-state="active"]')!;
    expect(activeCard.querySelectorAll('button,input,select').length).toBe(0);
    expect(activeCard.textContent).not.toMatch(/disable|choose path|change path|migrate back|indexeddb fallback/i);

    const beforeBackup = await readMigrationJournal(profileA.journalRuntime);
    vi.useFakeTimers();
    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = latest.handleBackupExport();
      await vi.advanceTimersByTimeAsync(0);
      await exportPromise;
    });
    vi.clearAllTimers();
    vi.useRealTimers();
    expect(mocks.exportBackupZip).toHaveBeenCalledTimes(1);
    expect(await readMigrationJournal(profileA.journalRuntime)).toEqual(beforeBackup);

    await act(async () => {
      await latest.importFromFile({ name: 'backup.zip' } as File);
      await flush();
    });
    expect(mocks.importBackupFile).toHaveBeenCalledTimes(1);
    expect(await readMigrationJournal(profileA.journalRuntime)).toEqual(beforeBackup);
  });
});
