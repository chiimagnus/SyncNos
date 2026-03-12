import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let filesApi: any = null;

vi.mock('../../src/sync/notion/notion-files-api.ts', () => {
  const getApi = () => {
    if (!filesApi) throw new Error('filesApi not set');
    return filesApi;
  };
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        return (getApi() as any)[prop as any];
      },
    },
  );
  return {
    default: proxy,
    FILE_UPLOAD_VERSION: '2025-09-03',
    sanitizeFilename: (name: any) => String(name || '').trim() || 'image.jpg',
    guessFilenameFromUrl: (_url: any) => 'image.jpg',
    createExternalURLUpload: (input: any) => getApi().createExternalURLUpload(input),
    createFileUpload: (input: any) => getApi().createFileUpload(input),
    sendFileUpload: (input: any) => getApi().sendFileUpload(input),
    retrieveUpload: (input: any) => getApi().retrieveUpload(input),
    waitUntilUploaded: (input: any) => getApi().waitUntilUploaded(input),
  };
});

import notionSyncService from '../../src/sync/notion/notion-sync-service.ts';

beforeEach(() => {
  filesApi = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global
  delete globalThis.fetch;
});

describe('notion-sync-service image uploads', () => {
  it('upgrades external image blocks via external_url upload', async () => {
    const calls: any[] = [];
    filesApi = {
      createExternalURLUpload: async ({ url }: any) => {
        calls.push({ op: 'createExternalURLUpload', url });
        return { id: 'u1' };
      },
      waitUntilUploaded: async ({ id }: any) => {
        calls.push({ op: 'waitUntilUploaded', id });
        return { id, status: 'uploaded' };
      },
      createFileUpload: async () => {
        throw new Error('should not be called');
      },
      sendFileUpload: async () => {
        throw new Error('should not be called');
      },
      retrieveUpload: async () => {
        throw new Error('should not be called');
      },
    };

    const blocks = [
      {
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: 'https://example.com/a.png' } },
      },
    ];

    const out = await notionSyncService.upgradeImageBlocksToFileUploads('t', blocks);
    expect(out[0]?.image?.type).toBe('file_upload');
    expect(out[0]?.image?.file_upload?.id).toBe('u1');
    expect(calls.map((c) => c.op)).toEqual(['createExternalURLUpload', 'waitUntilUploaded']);
  });

  it('falls back to byte upload when external_url upload fails', async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string) => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    };

    filesApi = {
      createExternalURLUpload: async () => {
        calls.push({ op: 'createExternalURLUpload' });
        throw new Error('validation_error');
      },
      createFileUpload: async ({ filename, contentType, contentLength }: any) => {
        calls.push({ op: 'createFileUpload', filename, contentType, contentLength });
        return { id: 'u2' };
      },
      sendFileUpload: async ({ id, bytes, filename, contentType }: any) => {
        calls.push({ op: 'sendFileUpload', id, byteLength: bytes.byteLength, filename, contentType });
        return { id };
      },
      waitUntilUploaded: async ({ id }: any) => {
        calls.push({ op: 'waitUntilUploaded', id });
        return { id, status: 'uploaded' };
      },
      retrieveUpload: async () => ({ id: 'u2', status: 'uploaded' }),
    };

    const blocks = [
      {
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: 'https://www.notion.so/image/attachment%3Aabc.png?table=thread&id=1' } },
      },
    ];

    const out = await notionSyncService.upgradeImageBlocksToFileUploads('t', blocks);
    expect(out[0]?.image?.type).toBe('file_upload');
    expect(out[0]?.image?.file_upload?.id).toBe('u2');
    expect(calls.map((c) => c.op)).toEqual(['createExternalURLUpload', 'createFileUpload', 'sendFileUpload', 'waitUntilUploaded']);
  });

  it('keeps original external url when all upload attempts fail', async () => {
    // @ts-expect-error test global
    globalThis.fetch = async () => {
      return { ok: false, status: 404, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
    };

    const calls: any[] = [];
    filesApi = {
      createExternalURLUpload: async () => {
        calls.push({ op: 'createExternalURLUpload' });
        throw new Error('validation_error');
      },
      createFileUpload: async () => {
        calls.push({ op: 'createFileUpload' });
        throw new Error('nope');
      },
      sendFileUpload: async () => {
        calls.push({ op: 'sendFileUpload' });
        throw new Error('nope');
      },
      waitUntilUploaded: async () => {
        calls.push({ op: 'waitUntilUploaded' });
        throw new Error('nope');
      },
      retrieveUpload: async () => ({ id: 'u1', status: 'failed' }),
    };

    const blocks = [
      {
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: 'https://www.notion.so/image/attachment%3Aabc.png?table=thread&id=1' } },
      },
    ];

    const out = await notionSyncService.upgradeImageBlocksToFileUploads('t', blocks);
    expect(out[0]?.image?.type).toBe('external');
    expect(out[0]?.image?.external?.url).toContain('/image/attachment%3A');
    expect(calls.map((c) => c.op)).toEqual(['createExternalURLUpload']);
  });

  it('upgrades data:image urls via byte upload (no fetch)', async () => {
    const calls: any[] = [];
    filesApi = {
      createExternalURLUpload: async () => {
        throw new Error('should not be called');
      },
      createFileUpload: async ({ filename, contentType }: any) => {
        calls.push({ op: 'createFileUpload', filename, contentType });
        return { id: 'u_data_1' };
      },
      sendFileUpload: async ({ id, bytes, filename, contentType }: any) => {
        calls.push({ op: 'sendFileUpload', id, byteLength: bytes.byteLength, filename, contentType });
        return { id };
      },
      waitUntilUploaded: async ({ id }: any) => {
        calls.push({ op: 'waitUntilUploaded', id });
        return { id, status: 'uploaded' };
      },
      retrieveUpload: async () => ({ id: 'u_data_1', status: 'uploaded' }),
    };

    const blocks = [
      {
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      },
    ];

    const out = await notionSyncService.upgradeImageBlocksToFileUploads('t', blocks);
    expect(out[0]?.image?.type).toBe('file_upload');
    expect(out[0]?.image?.file_upload?.id).toBe('u_data_1');
    expect(calls.map((c) => c.op)).toEqual(['createFileUpload', 'sendFileUpload', 'waitUntilUploaded']);
  });

  it('replaces data:image urls with placeholder paragraph when upload fails', async () => {
    const calls: any[] = [];
    filesApi = {
      createExternalURLUpload: async () => {
        throw new Error('should not be called');
      },
      createFileUpload: async () => {
        calls.push({ op: 'createFileUpload' });
        throw new Error('nope');
      },
      sendFileUpload: async () => {
        calls.push({ op: 'sendFileUpload' });
        throw new Error('nope');
      },
      waitUntilUploaded: async () => {
        calls.push({ op: 'waitUntilUploaded' });
        throw new Error('nope');
      },
      retrieveUpload: async () => ({ id: 'u_data_2', status: 'failed' }),
    };

    const blocks = [
      {
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      },
    ];

    const out = await notionSyncService.upgradeImageBlocksToFileUploads('t', blocks);
    expect(out[0]?.type).toBe('paragraph');
    expect(String(out[0]?.paragraph?.rich_text?.[0]?.text?.content || '')).toContain('Image omitted');
    expect(calls.map((c) => c.op)).toEqual(['createFileUpload']);
  });
});
