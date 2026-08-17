import { describe, expect, it, vi } from 'vitest';

import {
  createLocalFactsRevisionMonitor,
  parseConversationLocalDataRevisionSnapshot,
} from '@services/conversations/client/local-data-revision';

const EPOCH_A = 'native:11111111-1111-4111-8111-111111111111' as const;
const EPOCH_B = 'native:22222222-2222-4222-8222-222222222222' as const;

function snapshot(factsRevision: number, factsEpoch = EPOCH_A) {
  return { factsEpoch, factsRevision } as const;
}

describe('conversation local facts revision refresh', () => {
  it('strictly parses Native and IDB snapshots', () => {
    expect(parseConversationLocalDataRevisionSnapshot(snapshot(4))).toEqual(snapshot(4));
    expect(parseConversationLocalDataRevisionSnapshot({ factsEpoch: 'idb-v1', factsRevision: null })).toEqual({
      factsEpoch: 'idb-v1',
      factsRevision: null,
    });
    expect(() => parseConversationLocalDataRevisionSnapshot({ factsEpoch: EPOCH_A, factsRevision: null })).toThrow();
    expect(() =>
      parseConversationLocalDataRevisionSnapshot({ factsEpoch: EPOCH_A, factsRevision: 4, extra: true }),
    ).toThrow();
  });

  it('does not probe while the rendered list is IndexedDB', async () => {
    const getSnapshot = vi.fn(async () => snapshot(1));
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getSnapshot });
    monitor.setSnapshot({ factsEpoch: 'idb-v1', factsRevision: null });

    await expect(monitor.checkForExternalChange(refresh)).resolves.toEqual({
      factsEpoch: 'idb-v1',
      factsRevision: null,
      refreshed: false,
      revisionChanged: false,
    });
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses the bootstrap snapshot as baseline and skips an unchanged focus', async () => {
    const getSnapshot = vi.fn(async () => snapshot(4));
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getSnapshot });
    monitor.setSnapshot(snapshot(4));

    await expect(monitor.checkForExternalChange(refresh)).resolves.toEqual({
      factsEpoch: EPOCH_A,
      factsRevision: 4,
      refreshed: false,
      revisionChanged: false,
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once when another profile bumps the shared revision', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(snapshot(8));
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getSnapshot });
    monitor.setSnapshot(snapshot(7));

    await expect(monitor.checkForExternalChange(refresh)).resolves.toEqual({
      factsEpoch: EPOCH_A,
      factsRevision: 8,
      refreshed: true,
      revisionChanged: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('refreshes when the facts epoch changes even if the integer revision is unchanged', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(snapshot(7, EPOCH_B));
    const refresh = vi.fn(async () => {});
    const monitor = createLocalFactsRevisionMonitor({ getSnapshot });
    monitor.setSnapshot(snapshot(7, EPOCH_A));

    await expect(monitor.checkForExternalChange(refresh)).resolves.toEqual({
      factsEpoch: EPOCH_B,
      factsRevision: 7,
      refreshed: true,
      revisionChanged: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the last rendered baseline after a moving bounded window so the next focus probes again', async () => {
    const values = [snapshot(21), snapshot(22), snapshot(23), snapshot(23), snapshot(23)];
    const getSnapshot = vi.fn(async () => values.shift() ?? snapshot(23));
    const monitor = createLocalFactsRevisionMonitor({ getSnapshot, maxRefreshAttempts: 2 });
    let refreshCount = 0;
    const refresh = vi.fn(async () => {
      refreshCount += 1;
      monitor.setSnapshot(snapshot(refreshCount === 1 ? 21 : refreshCount === 2 ? 22 : 23));
    });
    monitor.setSnapshot(snapshot(20));

    await expect(monitor.checkForExternalChange(refresh)).resolves.toEqual({
      factsEpoch: EPOCH_A,
      factsRevision: 22,
      refreshed: true,
      revisionChanged: true,
    });
    await expect(monitor.checkForExternalChange(refresh)).resolves.toEqual({
      factsEpoch: EPOCH_A,
      factsRevision: 23,
      refreshed: true,
      revisionChanged: true,
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('deduplicates concurrent focus and visibility probes', async () => {
    let resolveFirst!: (value: ReturnType<typeof snapshot>) => void;
    let resolveSecond!: (value: ReturnType<typeof snapshot>) => void;
    const getSnapshot = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof snapshot>>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof snapshot>>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const monitor = createLocalFactsRevisionMonitor({ getSnapshot });
    const refresh = vi.fn(async () => monitor.setSnapshot(snapshot(4)));
    monitor.setSnapshot(snapshot(3));

    const first = monitor.checkForExternalChange(refresh);
    const second = monitor.checkForExternalChange(refresh);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    resolveFirst(snapshot(4));
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    resolveSecond(snapshot(4));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { factsEpoch: EPOCH_A, factsRevision: 4, refreshed: true, revisionChanged: true },
      { factsEpoch: EPOCH_A, factsRevision: 4, refreshed: true, revisionChanged: true },
    ]);
  });
});
