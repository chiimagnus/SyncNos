import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsQuery: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

import { tabsSendMessage } from '../../src/platform/webext/tabs';
import { createTestBackgroundRouter } from './background-router-testkit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background-router open inpage comments sidebar', () => {
  it('relays the open comments panel command to the current tab', async () => {
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: null, error: null } as any);

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests(
      {
        type: 'openCurrentTabInpageCommentsPanel',
        selectionText: 'double clicked quote',
      },
      { tab: { id: 17 } },
    );

    expect(res.ok).toBe(true);
    expect(tabsSendMessage).toHaveBeenCalledWith(17, {
      type: 'openInpageCommentsPanel',
      payload: {
        tabId: 17,
        selectionText: 'double clicked quote',
        source: 'doubleclick',
      },
    });
  });

  it('returns error when sender tab id is unavailable and does not relay', async () => {
    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests(
      {
        type: 'openCurrentTabInpageCommentsPanel',
        selectionText: 'quote',
      },
      { tab: undefined },
    );

    expect(res.ok).toBe(false);
    expect(tabsSendMessage).not.toHaveBeenCalled();
  });
});
