import { describe, expect, it, vi } from 'vitest';

const storage = new Map<string, unknown>();

vi.mock('@platform/storage/local', () => {
  return {
    storageGet: async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) out[key] = storage.get(key);
      return out;
    },
    storageSet: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items || {})) storage.set(key, value);
    },
  };
});

describe('tracking-param-cleaner', () => {
  it('strips wechat tracking params (fallback rules, no remote lists)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network disabled in unit test');
    }) as any;

    try {
      const { cleanTrackingParamsUrl } = await import('../../src/services/url-cleaning/tracking-param-cleaner');

      const url1 =
        'https://mp.weixin.qq.com/s/3Us_iZRhIyL-zpDHfWtyTw?from=singlemessage&isappinstalled=0&scene=1&clicktime=1774268672&enterid=1774268672';
      const out1 = await cleanTrackingParamsUrl(url1);
      expect(out1).toBe('https://mp.weixin.qq.com/s/3Us_iZRhIyL-zpDHfWtyTw');

      const url2 =
        'https://mp.weixin.qq.com/s?__biz=MzI1MTUxNzgxMA%3D%3D&mid=2247501580&idx=1&sn=48b842351b21e85b5201a2a7f21ea5b6&scene=21&poc_token=HDdJvWmjmHF9OI_VZSIXf56Qgox3RYF_C4c9q8uQ';
      const out2 = await cleanTrackingParamsUrl(url2);
      expect(out2).toBe(
        'https://mp.weixin.qq.com/s?__biz=MzI1MTUxNzgxMA%3D%3D&mid=2247501580&idx=1&sn=48b842351b21e85b5201a2a7f21ea5b6',
      );
    } finally {
      globalThis.fetch = originalFetch as any;
    }
  });
});
