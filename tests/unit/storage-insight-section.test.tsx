// @vitest-environment jsdom
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ snapshot: {} as any, startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock('@viewmodels/settings/useStorageInsight', () => ({
  useStorageInsight: () => storage.snapshot,
}));

import { InsightSection } from '@ui/settings/sections/InsightSection';

let root: ReactDOM.Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.getElementById('root')!);
  storage.snapshot = {
    overview: null,
    status: 'loading',
    error: '',
    scanData: null,
    scanStatus: 'idle',
    scanProgress: null,
    scanError: '',
    startScan: storage.startScan,
    cancelScan: storage.cancelScan,
  };
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('InsightSection storage overview', () => {
  it('renders storage independently of clip loading and empty states', () => {
    storage.snapshot = {
      overview: { imageCacheRecords: 3, originUsageBytes: null, originQuotaBytes: null },
      status: 'ready',
      error: '',
      scanData: null,
      scanStatus: 'idle',
      scanProgress: null,
      scanError: '',
      startScan: storage.startScan,
      cancelScan: storage.cancelScan,
    };
    act(() => {
      root.render(
        createElement(InsightSection, {
          status: 'loading',
          error: '',
          stats: null,
          range: 'all',
          onChangeRange: () => {},
        }),
      );
    });
    expect(document.body.textContent).toContain('3');
    expect(document.querySelector('section[aria-label="Local storage"]')).not.toBeNull();

    act(() => {
      root.render(
        createElement(InsightSection, {
          status: 'error',
          error: 'clip DB failed',
          stats: null,
          range: 'all',
          onChangeRange: () => {},
        }),
      );
    });
    expect(document.body.textContent).toContain('3');
    expect(document.body.textContent).toContain('clip DB failed');
  });

  it('offers an explicit scan and renders measured resource details', () => {
    storage.snapshot = {
      ...storage.snapshot,
      overview: { imageCacheRecords: 2, originUsageBytes: 100, originQuotaBytes: 1000 },
      status: 'ready',
    };
    act(() => {
      root.render(
        createElement(InsightSection, {
          status: 'idle',
          error: '',
          stats: null,
          range: 'all',
          onChangeRange: () => {},
        }),
      );
    });
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent === 'Scan resources',
    );
    expect(button).toBeTruthy();
    act(() => {
      button!.click();
    });
    expect(storage.startScan).toHaveBeenCalledOnce();

    storage.snapshot = {
      ...storage.snapshot,
      scanStatus: 'ready',
      scanData: {
        records: 2,
        readableCount: 2,
        bytes: 1024,
        animatedCount: 1,
        unknownAnimationCount: 0,
        unreadableCount: 0,
        orphanCount: 0,
        legacyCount: 0,
        metadataMismatchCount: 0,
        formatMismatchCount: 0,
        formats: [{ format: 'gif', count: 1, bytes: 1024 }],
        topImages: [{ id: 3, url: 'https://example.com/a.gif', bytes: 1024, format: 'gif' }],
      },
    };
    act(() => {
      root.render(
        createElement(InsightSection, {
          status: 'idle',
          error: '',
          stats: null,
          range: 'all',
          onChangeRange: () => {},
        }),
      );
    });
    expect(document.body.textContent).toContain('1 KiB');
    expect(document.body.textContent).toContain('GIF');
    expect(document.body.textContent).toContain('#3');
  });
});
