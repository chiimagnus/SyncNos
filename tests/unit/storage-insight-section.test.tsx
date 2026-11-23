// @vitest-environment jsdom
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ snapshot: { overview: null as any, status: 'loading', error: '' } }));
vi.mock('@viewmodels/settings/useStorageInsight', () => ({
  useStorageInsight: () => storage.snapshot,
}));

import { InsightSection } from '@ui/settings/sections/InsightSection';

let root: ReactDOM.Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.getElementById('root')!);
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
});
