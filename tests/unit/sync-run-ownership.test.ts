import { describe, expect, it } from 'vitest';

import { createSyncAlreadyRunningError, createSyncRunOwnership } from '@services/sync/sync-run-ownership';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('sync run ownership', () => {
  it('uses one stable structured conflict contract', () => {
    expect(createSyncAlreadyRunningError()).toMatchObject({
      message: 'sync already in progress',
      code: 'sync_already_running',
    });
  });

  it.each([
    ['run', 'run'],
    ['run', 'maintenance'],
    ['maintenance', 'run'],
    ['maintenance', 'maintenance'],
  ] as const)('rejects %s vs %s synchronously', (firstKind, secondKind) => {
    const ownership = createSyncRunOwnership();
    const hold = deferred<void>();
    const start = (kind: 'run' | 'maintenance') =>
      kind === 'run' ? ownership.startRun(() => hold.promise) : ownership.runExclusiveMutation(() => hold.promise);

    const first = start(firstKind);
    let thrown: unknown = null;
    try {
      start(secondKind);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'sync_already_running' });

    hold.resolve();
    return first;
  });

  it('reports active only for a live run slot', async () => {
    const ownership = createSyncRunOwnership();
    const runHold = deferred<void>();
    const run = ownership.startRun(() => runHold.promise);
    expect(ownership.isRunActive()).toBe(true);
    runHold.resolve();
    await run;
    expect(ownership.isRunActive()).toBe(false);

    const maintenanceHold = deferred<void>();
    const maintenance = ownership.runExclusiveMutation(() => maintenanceHold.promise);
    expect(ownership.isRunActive()).toBe(false);
    maintenanceHold.resolve();
    await maintenance;
    expect(ownership.isRunActive()).toBe(false);
  });

  it('releases the slot after synchronous throw, async rejection, and resolution', async () => {
    const ownership = createSyncRunOwnership();

    expect(() =>
      ownership.startRun(() => {
        throw new Error('sync throw');
      }),
    ).toThrow('sync throw');
    await expect(ownership.runExclusiveMutation(async () => 'after-sync-throw')).resolves.toBe('after-sync-throw');

    await expect(
      ownership.startRun(async () => {
        throw new Error('async reject');
      }),
    ).rejects.toThrow('async reject');
    await expect(ownership.startRun(async () => 'after-reject')).resolves.toBe('after-reject');
  });

  it('never lets an older operation release a newer owner token', async () => {
    const ownership = createSyncRunOwnership();
    const firstHold = deferred<void>();
    const first = ownership.startRun(() => firstHold.promise);
    firstHold.resolve();
    await first;

    const secondHold = deferred<void>();
    const second = ownership.startRun(() => secondHold.promise);
    expect(ownership.isRunActive()).toBe(true);
    secondHold.resolve();
    await second;
    expect(ownership.isRunActive()).toBe(false);
  });
});
