// @vitest-environment jsdom
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { encodeConversationLoc } from '@services/shared/conversation-loc';

const storage = vi.hoisted(() => ({ snapshot: {} as any, startScan: vi.fn(), cancelScan: vi.fn() }));
const duplicate = vi.hoisted(() => ({
  current: {} as any,
  find: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@viewmodels/settings/useStorageDuplicates', () => ({
  useStorageDuplicates: () => duplicate.current,
}));
const conversation = vi.hoisted(() => ({
  openScope: vi.fn(),
  openId: vi.fn(),
  open: vi.fn((id: number, input: any) => {
    input.setActiveId(id);
    return id;
  }),
}));
vi.mock('@viewmodels/settings/useStorageInsight', () => ({
  useStorageInsight: () => storage.snapshot,
}));

vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    openConversationInListScopeByLoc: conversation.openScope,
    openConversationInListScopeById: conversation.openId,
  }),
}));
vi.mock('@ui/conversations/open-conversation', () => ({
  openConversation: (...args: any[]) => conversation.open(...args),
}));
vi.mock('@ui/shared/hooks/useIsNarrowScreen', () => ({ useIsNarrowScreen: () => false }));

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
  duplicate.current = {
    status: 'idle',
    report: null,
    progress: null,
    error: '',
    start: duplicate.find,
    cancel: duplicate.cancel,
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

  it('makes duplicate detection explicitly opt-in and renders read-only potential savings', () => {
    duplicate.current = {
      ...duplicate.current,
      status: 'ready',
      report: {
        candidates: 2,
        hashed: 2,
        hashErrors: 0,
        duplicateGroups: 1,
        potentialRedundantBytes: 1024,
        groups: [
          {
            sha256: 'a'.repeat(64),
            bytes: 1024,
            assets: [
              { id: 1, conversationId: 4, url: 'one.png', title: 'One', loc: '' },
              { id: 2, conversationId: 5, url: 'two.png', title: 'Two', loc: '' },
            ],
          },
        ],
      },
    };
    storage.snapshot = {
      ...storage.snapshot,
      overview: { imageCacheRecords: 2, originUsageBytes: null, originQuotaBytes: null },
      status: 'ready',
      scanStatus: 'ready',
      scanData: {
        readableCount: 2,
        bytes: 2048,
        animatedCount: 0,
        unknownAnimationCount: 0,
        unreadableCount: 0,
        orphanCount: 0,
        legacyCount: 0,
        metadataMismatchCount: 0,
        formatMismatchCount: 0,
        formats: [],
        topImages: [],
        assetsById: new Map(),
      },
    };
    act(() =>
      root.render(
        createElement(InsightSection, {
          status: 'idle',
          error: '',
          stats: null,
          range: 'all',
          onChangeRange: () => {},
        }),
      ),
    );
    expect(document.body.textContent).toContain('Potential duplicate bytes');
    expect(document.body.textContent).toContain('1 KB');
    expect(document.body.textContent).toContain('#1');
    const find = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Find duplicate images',
    )!;
    expect(find).toBeTruthy();
    act(() => find.click());
    expect(duplicate.find).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('Delete duplicate');
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
        assetsById: new Map(),
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
    expect(document.body.textContent).toContain('1 KB');
    expect(document.body.textContent).toContain('GIF');
    expect(document.body.textContent).toContain('#3');
    const sections = Array.from(document.querySelectorAll('details'));
    expect(sections).toHaveLength(3);
    expect(sections.every((section) => !section.open)).toBe(true);
    expect(sections.map((section) => section.querySelector('summary')?.textContent?.trim())).toEqual([
      'Image resource details',
      'Duplicate image report',
      'Image compression preview',
    ]);
  });

  it('shows content diagnostics and opens the owning saved conversation from its ranking', () => {
    const loc = encodeConversationLoc({ source: 'chatgpt', conversationKey: 'c4' });
    storage.snapshot = {
      ...storage.snapshot,
      overview: { imageCacheRecords: 1, originUsageBytes: null, originQuotaBytes: null },
      status: 'ready',
      scanStatus: 'ready',
      scanData: {
        records: 1,
        readableCount: 1,
        bytes: 25,
        animatedCount: 0,
        unknownAnimationCount: 0,
        unreadableCount: 0,
        orphanCount: 0,
        legacyCount: 0,
        metadataMismatchCount: 0,
        formatMismatchCount: 0,
        formats: [{ format: 'png', count: 1, bytes: 25 }],
        topImages: [{ id: 1, conversationId: 4, title: 'My chat', source: 'chatgpt', loc, bytes: 25, format: 'png' }],
        assetsById: new Map(),
        content: {
          logicalTextBytes: 12,
          commentBytes: 6,
          orphanCommentBytes: 0,
          byKind: [{ kind: 'chat', bytes: 6 }],
          imageOccurrences: 3,
          uniqueImageTargets: 2,
          uniqueLocalAssetIds: 1,
          availableLocalOccurrences: 2,
          brokenLocalOccurrences: 0,
          otherImageOccurrences: 1,
          unreferencedCacheRecords: 0,
          topSources: [{ source: 'chatgpt', bytes: 25 }],
          topConversations: [{ conversationId: 4, title: 'My chat', source: 'chatgpt', loc, bytes: 25 }],
        },
      },
    };
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(InsightSection, {
            status: 'idle',
            error: '',
            stats: null,
            range: 'all',
            onChangeRange: () => {},
          }),
        ),
      );
    });
    expect(document.body.textContent).toContain('Image occurrences');
    expect(document.body.textContent).toContain('Broken local references');
    const conversationLink = Array.from(document.querySelectorAll('a')).find((link) => link.textContent === 'My chat');
    expect(conversationLink?.getAttribute('href')).toContain('loc=');
    act(() => {
      conversationLink!.click();
    });
    expect(conversation.open).toHaveBeenCalledWith(4, expect.objectContaining({ isNarrow: false }));
    expect(conversation.openScope).toHaveBeenCalledWith({ source: 'chatgpt', conversationKey: 'c4' });
  });
});
