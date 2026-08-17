import { describe, expect, it, vi } from 'vitest';

import { createLocalFactsRevisionMonitor } from '@viewmodels/conversations/local-revision-refresh';

describe('conversations local facts revision refresh', () => {
  it('does not touch Native revision while the profile is still on IndexedDB', async () => {
    const getFactsRevision = vi.fn(async () => 1);
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getFactsRevision });
    monitor.setFactsEpoch('idb-v1');

    await expect(monitor.checkForExternalChange(refresh)).resolves.toBe(false);

    expect(getFactsRevision).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on the first native focus, records a stable revision, and skips unchanged later focus', async () => {
    const getFactsRevision = vi.fn(async () => 4);
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getFactsRevision });
    monitor.setFactsEpoch('native:11111111-1111-4111-8111-111111111111');

    await expect(monitor.checkForExternalChange(refresh)).resolves.toBe(true);
    await expect(monitor.checkForExternalChange(refresh)).resolves.toBe(false);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getFactsRevision).toHaveBeenCalledTimes(3);
  });

  it('refreshes when another profile bumps the shared revision and rechecks after the refresh', async () => {
    let revision = 7;
    const getFactsRevision = vi.fn(async () => revision);
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getFactsRevision });
    monitor.setFactsEpoch('native:11111111-1111-4111-8111-111111111111');

    await monitor.checkForExternalChange(refresh);
    revision = 8;
    await expect(monitor.checkForExternalChange(refresh)).resolves.toBe(true);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('uses a bounded second refresh when another profile commits during the first refresh', async () => {
    const revisions = [10, 11, 11];
    const getFactsRevision = vi.fn(async () => revisions.shift() ?? 11);
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getFactsRevision, maxRefreshAttempts: 2 });
    monitor.setFactsEpoch('native:11111111-1111-4111-8111-111111111111');

    await expect(monitor.checkForExternalChange(refresh)).resolves.toBe(true);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(getFactsRevision).toHaveBeenCalledTimes(3);
  });

  it('does not bless a moving revision after the bounded refresh window', async () => {
    let revision = 20;
    const getFactsRevision = vi.fn(async () => revision++);
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getFactsRevision, maxRefreshAttempts: 2 });
    monitor.setFactsEpoch('native:11111111-1111-4111-8111-111111111111');

    await monitor.checkForExternalChange(refresh);
    await monitor.checkForExternalChange(refresh);

    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('deduplicates concurrent focus and visibility checks into one bounded revision workflow', async () => {
    let resolveRevision!: (value: number) => void;
    const getFactsRevision = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveRevision = resolve;
        }),
    );
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getFactsRevision });
    monitor.setFactsEpoch('native:11111111-1111-4111-8111-111111111111');

    const first = monitor.checkForExternalChange(refresh);
    const second = monitor.checkForExternalChange(refresh);
    expect(getFactsRevision).toHaveBeenCalledTimes(1);
    resolveRevision(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(getFactsRevision).toHaveBeenCalledTimes(2);
    resolveRevision(3);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
