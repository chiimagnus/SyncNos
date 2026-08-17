import { describe, expect, it, vi } from 'vitest';

import { LOCAL_DATA_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { createLocalDataMigrationClient } from '@services/local-data/client';

function status() {
  return {
    actions: { canStart: true, canResume: false },
    capability: { browser: 'chrome', officialIdentity: true, supported: true },
    database: { presence: 'missing', factsHealth: 'missing' },
    diagnostics: [],
    host: { registration: 'available', compatibility: 'compatible' },
    journal: { mode: 'not_started', stage: 'not_started' },
    profileState: 'setup_required',
    resumeReceipt: 'not_applicable',
  };
}

describe('local data migration client', () => {
  it('maps typed status/revision/start/resume calls through the shared runtime helper surface', async () => {
    const send = vi.fn(async (type: string) =>
      type === LOCAL_DATA_MESSAGE_TYPES.GET_FACTS_REVISION
        ? { ok: true, data: { factsRevision: 17 }, error: null }
        : { ok: true, data: status(), error: null },
    );
    const client = createLocalDataMigrationClient({ send });

    await expect(client.getStatus()).resolves.toEqual(status());
    await expect(client.getFactsRevision()).resolves.toBe(17);
    await expect(client.start()).resolves.toEqual(status());
    await expect(client.resume()).resolves.toEqual(status());

    expect(send.mock.calls).toEqual([
      [LOCAL_DATA_MESSAGE_TYPES.GET_STATUS],
      [LOCAL_DATA_MESSAGE_TYPES.GET_FACTS_REVISION],
      [LOCAL_DATA_MESSAGE_TYPES.START_MIGRATION],
      [LOCAL_DATA_MESSAGE_TYPES.RESUME_MIGRATION],
    ]);
  });

  it('preserves typed coordinator error codes without importing Native or IDB concerns', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      data: null,
      error: {
        message: 'A local data migration is in progress.',
        extra: { code: 'MIGRATION_IN_PROGRESS', diagnostics: { stage: 'staging' } },
      },
    }));
    const client = createLocalDataMigrationClient({ send });

    await expect(client.start()).rejects.toMatchObject({
      message: 'A local data migration is in progress.',
      code: 'MIGRATION_IN_PROGRESS',
      diagnostics: { stage: 'staging' },
    });
  });

  it('rejects malformed background status instead of letting viewmodels consume an untyped payload', async () => {
    const send = vi.fn(async () => ({
      ok: true,
      data: { ...status(), database: { presence: 'present', factsHealth: 'healthy', absolutePath: '/private/db' } },
      error: null,
    }));
    const client = createLocalDataMigrationClient({ send });

    await expect(client.getStatus()).rejects.toThrow('invalid local data migration status');
  });
});
