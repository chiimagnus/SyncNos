import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@services/sync/obsidian/obsidian-local-rest-client.ts';

describe('obsidian-local-rest-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('putVaultBinaryFile sends binary PUT with image content-type', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const clientRes = createClient({
      apiBaseUrl: 'http://127.0.0.1:27123',
      apiKey: 'token',
      authHeaderName: 'Authorization',
    }) as any;
    expect(clientRes.ok).toBe(true);

    const res = await clientRes.putVaultBinaryFile(
      'SyncNos-AIChats/my-note-1.webp',
      Uint8Array.from([1, 2, 3, 4]),
      { contentType: 'image/webp' },
    );

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, req] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:27123/vault/SyncNos-AIChats/my-note-1.webp');
    expect(req.method).toBe('PUT');
    const headers = req.headers as Headers;
    expect(headers.get('Content-Type')).toBe('image/webp');
  });

  it('putVaultBinaryFile returns bad_request on invalid binary body', async () => {
    const fetchMock = vi.fn();
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const clientRes = createClient({
      apiBaseUrl: 'http://127.0.0.1:27123',
      apiKey: 'token',
      authHeaderName: 'Authorization',
    }) as any;
    expect(clientRes.ok).toBe(true);

    const res = await clientRes.putVaultBinaryFile('a/b.png', { invalid: true } as any, {
      contentType: 'image/png',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('bad_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
