import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as notionFilesApi from '@services/sync/notion/notion-files-api.ts';
import * as imageCacheRead from '@services/conversations/data/image-cache-read';
import { upgradeImageBlocksToFileUploads } from '@services/sync/notion/notion-image-upload-upgrader';

function externalImageBlock(url: string) {
  return {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url },
    },
  };
}

function makeAsset(id: number, contentType = 'image/png') {
  return {
    id,
    conversationId: 1,
    url: `https://example.com/${id}.png`,
    blob: new Blob([Uint8Array.from([id, id + 1])], { type: contentType }),
    byteSize: 2,
    contentType,
  };
}

function paragraphText(block: any): string {
  return String(block?.paragraph?.rich_text?.[0]?.text?.content || '');
}

describe('notion-image-upload-upgrader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bulk-loads unique local assets once, reuses repeated URL uploads, and keeps serial upload order', async () => {
    const events: string[] = [];
    const bulkRead = vi.spyOn(imageCacheRead, 'getImageCacheAssetsByIds').mockResolvedValue(
      new Map([
        [42, makeAsset(42, 'image/webp')],
        [43, makeAsset(43, 'image/png')],
      ]) as any,
    );
    const createExternalUrlUpload = vi
      .spyOn(notionFilesApi, 'createExternalURLUpload')
      .mockResolvedValue({ id: 'unused' } as any);
    const createFileUpload = vi.spyOn(notionFilesApi, 'createFileUpload').mockImplementation(async (input: any) => {
      events.push(`create:${input.filename}`);
      return { id: input.filename.includes('42') ? 'up-42' : 'up-43' } as any;
    });
    vi.spyOn(notionFilesApi, 'sendFileUpload').mockImplementation(async (input: any) => {
      events.push(`send:${input.filename}`);
      return {} as any;
    });
    vi.spyOn(notionFilesApi, 'waitUntilUploaded').mockImplementation(async (input: any) => {
      events.push(`wait:${input.id}`);
      return { id: input.id } as any;
    });

    const out = await upgradeImageBlocksToFileUploads('token', [
      externalImageBlock('syncnos-asset://42'),
      externalImageBlock('syncnos-asset://43'),
      externalImageBlock('syncnos-asset://42'),
    ] as any);

    expect(bulkRead).toHaveBeenCalledTimes(1);
    expect(bulkRead).toHaveBeenCalledWith({ ids: [42, 43] });
    expect(createExternalUrlUpload).not.toHaveBeenCalled();
    expect(createFileUpload).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      'create:image-42.webp',
      'send:image-42.webp',
      'wait:up-42',
      'create:image-43.png',
      'send:image-43.png',
      'wait:up-43',
    ]);
    expect(out.map((block: any) => block?.image?.file_upload?.id)).toEqual(['up-42', 'up-43', 'up-42']);
  });

  it('falls back to an omission paragraph when a local asset is missing', async () => {
    const createFileUpload = vi.spyOn(notionFilesApi, 'createFileUpload').mockResolvedValue({ id: 'unused' } as any);
    vi.spyOn(imageCacheRead, 'getImageCacheAssetsByIds').mockResolvedValue(new Map() as any);

    const out = await upgradeImageBlocksToFileUploads('token', [externalImageBlock('syncnos-asset://999')] as any);

    expect(createFileUpload).not.toHaveBeenCalled();
    expect(out[0]?.type).toBe('paragraph');
    expect(paragraphText(out[0])).toContain('local image upload failed');
  });

  it('degrades a bulk-reader rejection to omission paragraphs without leaking internal URLs', async () => {
    vi.spyOn(imageCacheRead, 'getImageCacheAssetsByIds').mockRejectedValue(new Error('idb unavailable'));
    const createFileUpload = vi.spyOn(notionFilesApi, 'createFileUpload').mockResolvedValue({ id: 'unused' } as any);

    const out = await upgradeImageBlocksToFileUploads('token', [
      externalImageBlock('syncnos-asset://42'),
      externalImageBlock('syncnos-asset://43'),
    ] as any);

    expect(createFileUpload).not.toHaveBeenCalled();
    expect(out).toHaveLength(2);
    expect(out.every((block: any) => block?.type === 'paragraph')).toBe(true);
    expect(out.every((block: any) => paragraphText(block).includes('local image upload failed'))).toBe(true);
    expect(JSON.stringify(out)).not.toContain('syncnos-asset://');
  });

  it('keeps data and HTTP image upload behavior outside the local bulk reader', async () => {
    const bulkRead = vi.spyOn(imageCacheRead, 'getImageCacheAssetsByIds');
    const dataUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([1, 2, 3])).toString('base64')}`;
    const createExternalUrlUpload = vi
      .spyOn(notionFilesApi, 'createExternalURLUpload')
      .mockResolvedValue({ id: 'up-http' } as any);
    const createFileUpload = vi.spyOn(notionFilesApi, 'createFileUpload').mockResolvedValue({ id: 'up-data' } as any);
    const sendFileUpload = vi.spyOn(notionFilesApi, 'sendFileUpload').mockResolvedValue({} as any);
    vi.spyOn(notionFilesApi, 'waitUntilUploaded').mockImplementation(async (input: any) => ({ id: input.id }) as any);

    const out = await upgradeImageBlocksToFileUploads('token', [
      externalImageBlock('https://example.com/remote.png'),
      externalImageBlock(dataUrl),
    ] as any);

    expect(bulkRead).not.toHaveBeenCalled();
    expect(createExternalUrlUpload).toHaveBeenCalledTimes(1);
    expect(createFileUpload).toHaveBeenCalledTimes(1);
    expect(sendFileUpload).toHaveBeenCalledTimes(1);
    expect(out.map((block: any) => block?.image?.file_upload?.id)).toEqual(['up-http', 'up-data']);
  });
});
