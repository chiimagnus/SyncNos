import { beforeEach, describe, expect, it, vi } from 'vitest';

const tabsCreate = vi.hoisted(() => vi.fn());

vi.mock('@platform/webext/tabs', () => ({ tabsCreate }));

import { openExternalUrl } from '@services/integrations/open-external-url';

describe('openExternalUrl', () => {
  beforeEach(() => {
    tabsCreate.mockReset();
  });

  it('opens a validated HTTP URL through the extension tabs API', async () => {
    tabsCreate.mockResolvedValue({ id: 1 });
    await expect(openExternalUrl(' https://example.com/path?x=1#hash ')).resolves.toBe(true);
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://example.com/path?x=1#hash', active: true });
  });

  it('reports failure when tabs.create fails instead of pretending a window fallback succeeded', async () => {
    tabsCreate.mockRejectedValue(new Error('tabs.create unavailable'));
    await expect(openExternalUrl('https://example.com/path')).resolves.toBe(false);
  });

  it('rejects malformed URLs before calling tabs.create', async () => {
    await expect(openExternalUrl('https://exa mple.com')).resolves.toBe(false);
    expect(tabsCreate).not.toHaveBeenCalled();
  });
});
