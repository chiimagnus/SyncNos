// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  encode: vi.fn(),
  revision: vi.fn(),
}));
vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetById: (args: unknown) => mocks.read(args),
}));
vi.mock('@services/conversations/data/image-optimization', () => ({
  createImageOptimizationPreview: (args: unknown) => mocks.encode(args),
}));
vi.mock('@services/data-revisions/storage-idb', () => ({
  readDataRevisionSnapshot: () => mocks.revision(),
}));

import { useStorageImageOptimization } from '@viewmodels/settings/useStorageImageOptimization';

let root: ReactDOM.Root;
let current: ReturnType<typeof useStorageImageOptimization>;
const contentBlob = new Blob(['original'], { type: 'image/png' });
const smallerBlob = new Blob(['new'], { type: 'image/png' });
const response = {
  ok: true,
  mode: 'pixel-exact',
  originalBlob: contentBlob,
  optimizedBlob: smallerBlob,
  originalBytes: 8,
  optimizedBytes: 3,
  savedBytes: 5,
  contentType: 'image/png',
  width: 1,
  height: 1,
  pixelsEqual: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((callback) => {
    resolve = callback;
  });
  return { promise, resolve };
}

function Harness({ valid = true }: { valid?: boolean }) {
  const state = useStorageImageOptimization(valid);
  useEffect(() => {
    current = state;
  }, [state]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.querySelector('#root')!);
  mocks.read.mockResolvedValue({
    id: 1,
    conversationId: 12,
    url: 'https://example.com/img.png',
    blob: contentBlob,
    byteSize: 8,
    contentType: 'image/png',
  });
  mocks.encode.mockResolvedValue(response);
  mocks.revision.mockResolvedValue({ image_cache: 7, conversations: 4 });
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('image optimization preview lifecycle', () => {
  it('only reads the selected asset and prepares a read-only preview with revision evidence', async () => {
    await act(async () => {
      root.render(createElement(Harness));
    });
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => {
      await current.preparePreview({ id: 1, conversationId: 12 }, 'pixel-exact');
    });
    expect(current.previewStatus).toBe('ready');
    expect(current.preview).toMatchObject({ selection: { id: 1, conversationId: 12 }, expectedImageRevision: 7 });
    expect(mocks.read).toHaveBeenCalledWith({ id: 1, conversationId: 12 });
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({ blob: contentBlob, mode: 'pixel-exact' }));
  });

  it('rejects a source revision change during encoding', async () => {
    mocks.revision
      .mockResolvedValueOnce({ image_cache: 2, conversations: 4 })
      .mockResolvedValueOnce({ image_cache: 3, conversations: 4 });
    await act(async () => {
      root.render(createElement(Harness));
    });
    await act(async () => {
      await current.preparePreview({ id: 1, conversationId: 12 }, 'pixel-exact');
    });
    expect(current.preview).toBeNull();
    expect(current.previewStatus).toBe('error');
    expect(current.previewError).toBe('storage_insight_stale');
  });

  it('cancels an in-flight preview when the resource audit turns stale', async () => {
    const pending = deferred<any>();
    mocks.encode.mockReturnValue(pending.promise);
    await act(async () => {
      root.render(createElement(Harness));
    });
    let promise!: Promise<void>;
    await act(async () => {
      promise = current.preparePreview({ id: 1, conversationId: 12 }, 'pixel-exact');
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    const signal = mocks.encode.mock.calls[0][0].signal as AbortSignal;
    await act(async () => {
      root.render(createElement(Harness, { valid: false }));
    });
    expect(signal.aborted).toBe(true);
    expect(current.preview).toBeNull();
    await act(async () => {
      pending.resolve(response);
      await promise;
    });
    expect(current.previewStatus).toBe('idle');
    expect(current.preview).toBeNull();
  });
});
