import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revision: vi.fn(),
  read: vi.fn(),
  preview: vi.fn(),
  commit: vi.fn(),
}));
vi.mock('@services/data-revisions/storage-idb', () => ({
  readDataRevision: (...args: unknown[]) => mocks.revision(...args),
}));
vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetById: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock('@services/conversations/data/image-optimization', () => ({
  createImageOptimizationPreview: (...args: unknown[]) => mocks.preview(...args),
}));
vi.mock('@services/conversations/data/image-optimization-commit', () => ({
  commitImageOptimization: (...args: unknown[]) => mocks.commit(...args),
}));

import { optimizeImageBatch } from '@services/conversations/data/image-optimization-batch';

const rows = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, conversationId: 1 }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.revision.mockResolvedValue(5);
  mocks.read.mockImplementation(async ({ id }: { id: number }) => ({
    id,
    conversationId: 1,
    url: `asset-${id}`,
    blob: new Blob([String(id)], { type: 'image/png' }),
    byteSize: String(id).length,
    contentType: 'image/png',
  }));
  mocks.preview.mockImplementation(async ({ blob }: { blob: Blob }) => ({
    ok: true,
    mode: 'pixel-exact',
    pixelsEqual: true,
    originalBlob: blob,
    optimizedBlob: new Blob(['x'], { type: 'image/png' }),
    originalBytes: 500,
    optimizedBytes: 100,
    savedBytes: 400,
    contentType: 'image/png',
    width: 1,
    height: 1,
  }));
  mocks.commit.mockImplementation(async ({ selection }: { selection: { id: number } }) => ({
    id: selection.id,
    bytesSaved: 400,
    byteSize: 100,
    contentType: 'image/png',
  }));
});

describe('bounded sequential image batch optimization', () => {
  it('processes one candidate at a time, with actual committed savings and no automatic lossy consent', async () => {
    let simultaneous = 0;
    let peak = 0;
    mocks.preview.mockImplementation(async ({ blob }: { blob: Blob }) => {
      simultaneous++;
      peak = Math.max(peak, simultaneous);
      await Promise.resolve();
      simultaneous--;
      return {
        ok: true,
        mode: 'pixel-exact',
        pixelsEqual: true,
        originalBlob: blob,
        optimizedBlob: new Blob(['x'], { type: 'image/png' }),
        originalBytes: 500,
        optimizedBytes: 100,
        savedBytes: 400,
        contentType: 'image/png',
        width: 1,
        height: 1,
      };
    });
    const progress: Array<{ processed: number; total: number; bytesSaved: number }> = [];
    const result = await optimizeImageBatch(rows.slice(0, 10), {
      onProgress: ({ processed, total, bytesSaved }) => progress.push({ processed, total, bytesSaved }),
    });
    expect(result).toMatchObject({ processed: 10, total: 10, savedCount: 10, bytesSaved: 4000, cancelled: false });
    expect(result.entries).toHaveLength(10);
    expect(peak).toBe(1);
    expect(mocks.commit).toHaveBeenCalledTimes(10);
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ mode: 'pixel-exact' }));
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({ approveLossy: false }));
    expect(progress.at(-1)).toEqual({ processed: 10, total: 10, bytesSaved: 4000 });
  });

  it('returns truthful partial progress for ten saves, one failure and cancellation before next item', async () => {
    const controller = new AbortController();
    mocks.commit.mockImplementation(async ({ selection }: { selection: { id: number } }) => {
      if (selection.id === 11) throw new Error('QuotaExceededError');
      return { id: selection.id, bytesSaved: 400, byteSize: 100, contentType: 'image/png' };
    });
    const result = await optimizeImageBatch(rows, {
      signal: controller.signal,
      onProgress: ({ processed }) => {
        if (processed === 11) controller.abort();
      },
    });
    expect(result).toMatchObject({
      processed: 11,
      total: 13,
      savedCount: 10,
      failedCount: 1,
      bytesSaved: 4000,
      cancelled: true,
    });
    expect(result.entries).toHaveLength(11);
    expect(result.entries[10]).toMatchObject({ id: 11, status: 'failed', reason: 'QuotaExceededError' });
    expect(mocks.read).toHaveBeenCalledTimes(11);
    expect(mocks.commit).toHaveBeenCalledTimes(11);
  });

  it('does not write when candidate has no savings, is unsupported or source revision changed', async () => {
    mocks.preview
      .mockResolvedValueOnce({ ok: false, reason: 'no-savings' })
      .mockResolvedValueOnce({ ok: false, reason: 'unsupported-format' });
    mocks.revision.mockResolvedValueOnce(5).mockResolvedValueOnce(8).mockResolvedValue(8);
    const result = await optimizeImageBatch(rows.slice(0, 3));
    expect(result.entries[0]).toMatchObject({ status: 'no-savings' });
    expect(result.entries[1]).toMatchObject({ status: 'skipped', reason: 'unsupported-format' });
    expect(result.entries[2]).toMatchObject({ status: 'saved' });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it('reports image conflicts without overwriting data or retrying an uncertain outcome', async () => {
    mocks.commit
      .mockRejectedValueOnce(new Error('image_optimization_conflict'))
      .mockRejectedValueOnce(new Error('image_optimization_readback_failed'));
    const result = await optimizeImageBatch(rows.slice(0, 2));
    expect(result).toMatchObject({ processed: 2, savedCount: 0, failedCount: 1, conflictCount: 1 });
    expect(result.entries.map((entry) => entry.status)).toEqual(['conflict', 'failed']);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
  });

  it('stops before any new write when cancelled during an asynchronous image encode', async () => {
    const controller = new AbortController();
    let resolve!: (value: unknown) => void;
    mocks.preview.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const promise = optimizeImageBatch(rows.slice(0, 3), { signal: controller.signal });
    for (let attempt = 0; attempt < 8; attempt++) await Promise.resolve();
    controller.abort();
    resolve({ ok: false, reason: 'cancelled' });
    const result = await promise;
    expect(result).toMatchObject({ processed: 0, cancelled: true, bytesSaved: 0 });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
