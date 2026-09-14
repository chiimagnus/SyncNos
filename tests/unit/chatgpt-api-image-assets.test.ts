import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadMocks = vi.hoisted(() => ({ plain: vi.fn() }));
vi.mock('@platform/webext/image-download-proxy', () => ({
  downloadImagePlain: downloadMocks.plain,
}));

import { downloadChatgptImages, resolveChatgptImageUrls } from '@services/integrations/chatgpt/api-image-assets';

beforeEach(() => {
  vi.clearAllMocks();
  downloadMocks.plain.mockResolvedValue({
    ok: true,
    blob: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }),
    byteSize: 4,
    contentType: 'image/png',
  });
});

describe('ChatGPT image assets', () => {
  it('reads one session and resolves many files with bounded parallelism', async () => {
    const fileIds = Array.from({ length: 10 }, (_, index) => `file_image_${index + 1}`);
    let activeResolvers = 0;
    let maxActiveResolvers = 0;
    let sessionCalls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) {
        sessionCalls += 1;
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      }
      activeResolvers += 1;
      maxActiveResolvers = Math.max(maxActiveResolvers, activeResolvers);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeResolvers -= 1;
      const fileId = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      return new Response(
        JSON.stringify({ download_url: `https://chatgpt.com/backend-api/estuary/content?id=${fileId}&sig=test` }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await resolveChatgptImageUrls({
      conversationKey: 'conversation-1',
      fileIds,
      fetchFn,
      concurrency: 3,
    });

    expect(sessionCalls).toBe(1);
    expect(maxActiveResolvers).toBeGreaterThan(1);
    expect(maxActiveResolvers).toBeLessThanOrEqual(3);
    expect(result).toHaveLength(10);
    expect(result.every((item) => item.ok)).toBe(true);
    expect(result.map((item) => item.fileId)).toEqual(fileIds);
  });

  it('validates resolver identity and turns session/resolver failures into per-file results', async () => {
    const sessionFailure = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch;
    await expect(
      resolveChatgptImageUrls({
        conversationKey: 'conversation-1',
        fileIds: ['file_image_1'],
        fetchFn: sessionFailure,
      }),
    ).resolves.toEqual([{ fileId: 'file_image_1', ok: false, reason: 'session' }]);

    const resolverFailure = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) {
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_other' }),
        { status: 200 },
      );
    }) as typeof fetch;
    await expect(
      resolveChatgptImageUrls({
        conversationKey: 'conversation-1',
        fileIds: ['file_image_1'],
        fetchFn: resolverFailure,
      }),
    ).resolves.toEqual([{ fileId: 'file_image_1', ok: false, reason: 'resolver' }]);
  });

  it('downloads resolved images without exposing transient signed URLs in the result', async () => {
    const signed = 'https://chatgpt.com/backend-api/estuary/content?id=file_image_1&sig=SIGNED_SENTINEL';
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) {
        return new Response(JSON.stringify({ accessToken: 'PROTECTED_TOKEN_SENTINEL' }), { status: 200 });
      }
      return new Response(JSON.stringify({ download_url: signed }), { status: 200 });
    }) as typeof fetch;

    const result = await downloadChatgptImages({
      conversationKey: 'conversation-1',
      fileIds: ['file_image_1'],
      fetchFn,
      timeoutMs: 1234,
    });

    expect(downloadMocks.plain).toHaveBeenCalledWith({
      url: signed,
      maxBytes: Number.POSITIVE_INFINITY,
      fetchFn,
      timeoutMs: 1234,
    });
    expect(result).toEqual([
      expect.objectContaining({
        cacheKey: 'chatgpt-file://file_image_1',
        ok: true,
        byteSize: 4,
        contentType: 'image/png',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('SIGNED_SENTINEL');
    expect(JSON.stringify(result)).not.toContain('PROTECTED_TOKEN_SENTINEL');
  });
});
