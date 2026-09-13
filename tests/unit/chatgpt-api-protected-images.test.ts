import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadMocks = vi.hoisted(() => ({ plain: vi.fn() }));
vi.mock('@platform/webext/image-download-proxy', () => ({
  downloadImagePlain: downloadMocks.plain,
}));

import { downloadChatgptProtectedImages } from '@services/integrations/chatgpt/api-protected-images';

function bundle() {
  return {
    conversationKey: 'conversation-1',
    assets: [
      {
        ref: 'file_image_1',
        fileId: 'file_image_1',
        cacheKey: 'chatgpt-file://file_image_1',
        targetMessageKey: 'm1',
        alt: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 4,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadMocks.plain.mockResolvedValue({
    ok: true,
    blob: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }),
    byteSize: 4,
    contentType: 'image/png',
  });
});

describe('ChatGPT protected image downloader', () => {
  it('reads one session, resolves each file with Bearer, validates Estuary, and returns only blob metadata', async () => {
    const token = 'PROTECTED_TOKEN_SENTINEL';
    const signed = 'https://chatgpt.com/backend-api/estuary/content?id=SIGNED_SENTINEL';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/auth/session'))
        return new Response(JSON.stringify({ accessToken: token }), { status: 200 });
      return new Response(JSON.stringify({ download_url: signed, file_size_bytes: 4 }), { status: 200 });
    }) as typeof fetch;

    const result = await downloadChatgptProtectedImages(bundle(), { fetchFn });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://chatgpt.com/api/auth/session');
    const resolver = new URL(calls[1].url);
    expect(resolver.pathname).toBe('/backend-api/files/download/file_image_1');
    expect(resolver.searchParams.get('conversation_id')).toBe('conversation-1');
    expect(resolver.searchParams.get('download_intent')).toBe('false');
    expect(resolver.searchParams.get('include_library_file_state')).toBe('true');
    expect(resolver.searchParams.get('inline')).toBe('false');
    const headers = new Headers(calls[1].init.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers.has('ChatGPT-Account-Id')).toBe(false);
    expect(downloadMocks.plain).toHaveBeenCalledWith({ url: signed, maxBytes: Number.POSITIVE_INFINITY });
    expect(result).toEqual([
      expect.objectContaining({
        cacheKey: 'chatgpt-file://file_image_1',
        ok: true,
        byteSize: 4,
        contentType: 'image/png',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('SIGNED_SENTINEL');
    expect(JSON.stringify(result)).not.toContain('sediment://');
  });

  it('turns session, resolver, download and declared-size failures into per-image failures without throwing', async () => {
    const sessionFailure = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch;
    await expect(downloadChatgptProtectedImages(bundle(), { fetchFn: sessionFailure })).resolves.toEqual([
      { cacheKey: 'chatgpt-file://file_image_1', ok: false, reason: 'session' },
    ]);

    const resolverFailure = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session'))
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      return new Response(JSON.stringify({ download_url: 'https://attacker.example/image.png' }), { status: 200 });
    }) as typeof fetch;
    await expect(downloadChatgptProtectedImages(bundle(), { fetchFn: resolverFailure })).resolves.toEqual([
      { cacheKey: 'chatgpt-file://file_image_1', ok: false, reason: 'resolver' },
    ]);

    const goodResolver = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session'))
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      return new Response(
        JSON.stringify({ download_url: 'https://chatgpt.com/backend-api/estuary/content?id=x', file_size_bytes: 5 }),
        { status: 200 },
      );
    }) as typeof fetch;
    await expect(downloadChatgptProtectedImages(bundle(), { fetchFn: goodResolver })).resolves.toEqual([
      { cacheKey: 'chatgpt-file://file_image_1', ok: false, reason: 'size_mismatch' },
    ]);

    downloadMocks.plain.mockResolvedValueOnce({ ok: false, reason: 'http' });
    const matchingResolver = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session'))
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      return new Response(
        JSON.stringify({ download_url: 'https://chatgpt.com/backend-api/estuary/content?id=x', file_size_bytes: 4 }),
        { status: 200 },
      );
    }) as typeof fetch;
    await expect(downloadChatgptProtectedImages(bundle(), { fetchFn: matchingResolver })).resolves.toEqual([
      { cacheKey: 'chatgpt-file://file_image_1', ok: false, reason: 'download' },
    ]);
  });

  it('never resolves legacy or missing file references', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session'))
        return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
      throw new Error('resolver should not run');
    }) as typeof fetch;
    const input = bundle();
    input.assets[0].fileId = '';
    input.assets[0].cacheKey = '';
    (input.assets[0] as any).failureReason = 'unsupported_pointer';

    await expect(downloadChatgptProtectedImages(input, { fetchFn })).resolves.toEqual([
      { cacheKey: '', ok: false, reason: 'resolver' },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(downloadMocks.plain).not.toHaveBeenCalled();
  });
});
