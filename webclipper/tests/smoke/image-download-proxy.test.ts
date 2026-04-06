import { describe, expect, it, vi, beforeEach } from 'vitest';

const localStorageState = new Map<string, unknown>();
const storageGetMock = vi.fn();
const storageSetMock = vi.fn();

vi.mock('@platform/storage/local', () => ({
  storageGet: (...args: unknown[]) => storageGetMock(...args),
  storageSet: (...args: unknown[]) => storageSetMock(...args),
}));

describe('image-download-proxy', () => {
  const mockUpdateSessionRules = vi.fn().mockResolvedValue(undefined);
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorageState.clear();

    storageGetMock.mockImplementation(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys || []) {
        if (localStorageState.has(key)) out[key] = localStorageState.get(key);
      }
      return out;
    });
    storageSetMock.mockImplementation(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items || {})) {
        localStorageState.set(key, value);
      }
    });

    // 设置 chrome global
    (globalThis as any).chrome = {
      declarativeNetRequest: {
        updateSessionRules: mockUpdateSessionRules,
      },
      runtime: {
        id: 'test-extension-id',
      },
    };

    // 设置 fetch global
    (globalThis as any).fetch = mockFetch;
  });

  function mockFetchResponse(overrides: Record<string, any> = {}) {
    return {
      ok: true,
      blob: () => Promise.resolve(new Blob(['test'], { type: 'image/jpeg' })),
      headers: {
        get: (key: string) => (key === 'content-type' ? 'image/jpeg' : null),
      },
      ...overrides,
    };
  }

  describe('getAntiHotlinkReferer', () => {
    it('returns referer for sspai CDN', async () => {
      const { ANTI_HOTLINK_REFERER_MAP } = await import('@platform/webext/image-download-proxy');
      expect(ANTI_HOTLINK_REFERER_MAP['cdnfile.sspai.com']).toBe('https://sspai.com/');
    });

    it('handles URLs with query params', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({}));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/xxx.jpg?imageView2/2/w/1120',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSessionRules).toHaveBeenCalledTimes(2); // 注册 + 清理
    });

    it('uses persisted custom anti-hotlink rules', async () => {
      localStorageState.set('anti_hotlink_rules_v1', [{ domain: 'picx.zhimg.com', referer: 'https://www.zhihu.com/' }]);
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({}));

      const result = await downloadImageSmart({
        url: 'https://picx.zhimg.com/v2-123.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSessionRules).toHaveBeenCalledTimes(2);
      const addCall = mockUpdateSessionRules.mock.calls[0][0];
      expect(addCall.addRules[0].action.requestHeaders[0].value).toBe('https://www.zhihu.com/');
    });
  });

  describe('downloadImageSmart', () => {
    it('registers and cleans up DNR rule for anti-hotlink URLs', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({}));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSessionRules).toHaveBeenCalledTimes(2);

      const addCall = mockUpdateSessionRules.mock.calls[0][0];
      expect(addCall.addRules).toHaveLength(1);
      expect(addCall.addRules[0].action.requestHeaders[0]).toEqual({
        header: 'Referer',
        operation: 'set',
        value: 'https://sspai.com/',
      });
      expect(addCall.addRules[0].condition.urlFilter).toBe('|https://cdnfile.sspai.com/');
    });

    it('cleans up DNR rule even when fetch fails', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(false);
      expect(mockUpdateSessionRules).toHaveBeenCalledTimes(2);
    });

    it('uses plain fetch for non-anti-hotlink URLs', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({}));

      const result = await downloadImageSmart({
        url: 'https://example.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSessionRules).not.toHaveBeenCalled();
    });

    it('respects explicit empty anti-hotlink rules list', async () => {
      localStorageState.set('anti_hotlink_rules_v1', []);
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({}));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSessionRules).not.toHaveBeenCalled();
    });

    it('falls back to built-in default rules when storage read fails', async () => {
      storageGetMock.mockRejectedValueOnce(new Error('storage offline'));
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({}));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSessionRules).toHaveBeenCalledTimes(2);
    });

    it('returns blob on success', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      const testBlob = new Blob(['test'], { type: 'image/jpeg' });
      mockFetch.mockResolvedValue(mockFetchResponse({ blob: () => Promise.resolve(testBlob) }));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.blob).toBe(testBlob);
        expect(result.contentType).toBe('image/jpeg');
        expect(result.byteSize).toBe(testBlob.size);
      }
    });

    it('returns error when fetch returns 403', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(false);
      expect((result as any).reason).toBe('http');
    });

    it('returns error for non-image content-type', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      mockFetch.mockResolvedValue(mockFetchResponse({ headers: { get: () => 'text/html' } }));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(false);
      expect((result as any).reason).toBe('non_image');
    });

    it('returns error when URL is empty', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      const result = await downloadImageSmart({ url: '' });

      expect(result.ok).toBe(false);
      expect((result as any).reason).toBe('invalid_input');
    });

    it('returns error when file exceeds maxBytes', async () => {
      const { downloadImageSmart } = await import('@platform/webext/image-download-proxy');
      const largeBlob = new Blob([new ArrayBuffer(3_000_000)], { type: 'image/jpeg' });
      mockFetch.mockResolvedValue(mockFetchResponse({ blob: () => Promise.resolve(largeBlob) }));

      const result = await downloadImageSmart({
        url: 'https://cdnfile.sspai.com/test.jpg',
        maxBytes: 1_000_000,
      });

      expect(result.ok).toBe(false);
      expect((result as any).reason).toBe('too_large');
    });
  });
});
