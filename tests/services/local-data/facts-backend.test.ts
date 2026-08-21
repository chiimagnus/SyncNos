import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';
import { FactsBackend } from '@services/local-data/facts-backend';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

const notStarted = {
  mode: 'not_started',
  journal: null,
  factsEpoch: 'idb-v1',
  error: null,
} as const satisfies MigrationJournalSnapshot;

const active = {
  mode: 'active',
  factsEpoch: 'native:550e8400-e29b-41d4-a716-446655440000',
  error: null,
  journal: { stage: 'active' },
} as unknown as MigrationJournalSnapshot;

const transitional = {
  mode: 'transitional',
  factsEpoch: null,
  error: null,
  journal: { stage: 'staging' },
} as unknown as MigrationJournalSnapshot;

const failed = {
  mode: 'failed',
  factsEpoch: null,
  error: {
    code: 'DATABASE_NOT_INITIALIZED',
    message: 'The local data database has not been initialized.',
    retryable: false,
  },
  journal: { stage: 'staging', terminalCode: 'DATABASE_NOT_INITIALIZED' },
} as unknown as MigrationJournalSnapshot;

function productionSourceFiles(root = join(process.cwd(), 'src')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...productionSourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function sourceImports(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

function repoPath(path: string): string {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

describe('facts backend', () => {
  it('chooses exactly one lease-bound repository from the durable journal', async () => {
    const createIdbRepository = vi.fn(() => ({ kind: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ kind: 'native' }));
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();
    const backend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => notStarted,
    });

    await gate.runFactsOperation('idb-read', async (lease) => {
      await expect(backend.open(lease)).resolves.toMatchObject({ factsEpoch: 'idb-v1', mode: 'idb' });
    });

    expect(createIdbRepository).toHaveBeenCalledOnce();
    expect(createNativeRepository).not.toHaveBeenCalled();
  });

  it('uses Native only for an active journal and validates a caller epoch before opening it', async () => {
    const createIdbRepository = vi.fn(() => ({ kind: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ kind: 'native' }));
    const gate = new FactsOperationGate({ readJournal: async () => active });
    await gate.initializeFromJournal();
    const backend = new FactsBackend({ createIdbRepository, createNativeRepository, readJournal: async () => active });

    await gate.runFactsOperation('native-read', async (lease) => {
      await expect(backend.open(lease, active.factsEpoch)).resolves.toMatchObject({
        factsEpoch: active.factsEpoch,
        mode: 'native',
      });
      await expect(backend.open(lease, 'idb-v1')).rejects.toMatchObject({ code: 'STALE_BACKEND_EPOCH' });
    });

    expect(createNativeRepository).toHaveBeenCalledOnce();
    expect(createIdbRepository).not.toHaveBeenCalled();
  });

  it('locks production direct-import and layer allowlists to backend implementations only', () => {
    const imports = productionSourceFiles().flatMap((path) =>
      sourceImports(path).map((specifier) => ({ path: repoPath(path), specifier })),
    );
    const restrictedFactsModules = new Set([
      '@services/conversations/data/storage-idb',
      '@services/conversations/data/image-cache-read',
      '@services/comments/data/storage-idb',
      '@services/sync/backup/idb',
      '@services/shared/idb',
    ]);

    expect(
      imports
        .filter(({ specifier }) => restrictedFactsModules.has(specifier))
        .map(({ path, specifier }) => `${path} -> ${specifier}`)
        .sort(),
    ).toEqual([
      'src/services/comments/data/storage.ts -> @services/comments/data/storage-idb',
      'src/services/conversations/data/article-url-operation-idb.ts -> @services/conversations/data/storage-idb',
      'src/services/conversations/data/storage.ts -> @services/conversations/data/storage-idb',
    ]);

    expect(
      imports
        .filter(
          ({ path, specifier }) =>
            specifier === '@platform/idb/schema' ||
            (path === 'src/platform/idb/facts-transfer.ts' && specifier === './schema'),
        )
        .map(({ path }) => path)
        .sort(),
    ).toEqual([
      'src/platform/idb/facts-transfer.ts',
      'src/services/comments/data/storage-idb.ts',
      'src/services/conversations/data/article-url-operation-idb.ts',
      'src/services/conversations/data/image-storage-idb.ts',
      'src/services/conversations/data/storage-idb.ts',
      'src/services/sync/backup/idb-facts-adapter.ts',
    ]);

    expect(
      imports.filter(
        ({ path, specifier }) =>
          (path.startsWith('src/ui/') || path.startsWith('src/viewmodels/')) && specifier.startsWith('@platform/'),
      ),
    ).toEqual([]);
    expect(
      imports.filter(
        ({ path, specifier }) =>
          path.startsWith('src/services/') && (specifier.startsWith('@ui/') || specifier.startsWith('@viewmodels/')),
      ),
    ).toEqual([]);
    expect(imports).toContainEqual({
      path: 'src/services/sync/backup/background-handlers.ts',
      specifier: '@services/sync/backup/idb-facts-adapter',
    });
  });

  it('uses the shared lifecycle errors for transitional, failed, and unreadable journals before either repository can be created', async () => {
    const createIdbRepository = vi.fn(() => ({ kind: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ kind: 'native' }));
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();

    const transitionalBackend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => transitional,
    });
    const failedBackend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => failed,
    });
    const brokenBackend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => {
        throw new Error('journal unavailable');
      },
    });

    await gate.runFactsOperation('blocked-read', async (lease) => {
      await expect(transitionalBackend.open(lease)).rejects.toMatchObject({ code: 'MIGRATION_IN_PROGRESS' });
      await expect(failedBackend.open(lease)).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
      await expect(brokenBackend.open(lease)).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
    });

    expect(createIdbRepository).not.toHaveBeenCalled();
    expect(createNativeRepository).not.toHaveBeenCalled();
  });
});
