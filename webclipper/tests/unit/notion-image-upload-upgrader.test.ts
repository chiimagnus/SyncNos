import { beforeEach, describe, expect, it, vi } from 'vitest';
import notionFilesApi from '@services/sync/notion/notion-files-api.ts';
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

describe('notion-image-upload-upgrader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads syncnos-asset images from local bytes as file_upload blocks', async () => {
    const createExternalUrlUpload = vi.spyOn(notionFilesApi, 'createExternalURLUpload').mockResolvedValue({ id: 'unused' } as any);
    const createFileUpload = vi.spyOn(notionFilesApi, 'createFileUpload').mockResolvedValue({ id: 'up-syncnos-1' } as any);
    const sendFileUpload = vi.spyOn(notionFilesApi, 'sendFileUpload').mockResolvedValue({} as any);
    const waitUntilUploaded = vi.spyOn(notionFilesApi, 'waitUntilUploaded').mockResolvedValue({ id: 'up-syncnos-1' } as any);

    vi.spyOn(imageCacheRead, 'getImageCacheAssetById').mockResolvedValue({
      id: 42,
      conversationId: 1,
      url: 'https://example.com/image.webp',
      blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/webp' }),
      byteSize: 3,
      contentType: 'image/webp',
    } as any);

    const out = await upgradeImageBlocksToFileUploads('token', [externalImageBlock('syncnos-asset://42')] as any);

    expect(createExternalUrlUpload).not.toHaveBeenCalled();
    expect(createFileUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'token',
        filename: 'image-42.webp',
        contentType: 'image/webp',
      }),
    );
    expect(sendFileUpload).toHaveBeenCalledTimes(1);
    const sendArgs = sendFileUpload.mock.calls[0]?.[0] || {};
    expect(sendArgs.bytes).toBeInstanceOf(Uint8Array);
    expect(waitUntilUploaded).toHaveBeenCalledWith({ accessToken: 'token', id: 'up-syncnos-1' });
    expect(out[0]?.image?.type).toBe('file_upload');
    expect(out[0]?.image?.file_upload?.id).toBe('up-syncnos-1');
  });

  it('falls back to placeholder paragraph when syncnos asset is missing', async () => {
    const createFileUpload = vi.spyOn(notionFilesApi, 'createFileUpload').mockResolvedValue({ id: 'up-syncnos-2' } as any);
    vi.spyOn(imageCacheRead, 'getImageCacheAssetById').mockResolvedValue(null as any);

    const out = await upgradeImageBlocksToFileUploads('token', [externalImageBlock('syncnos-asset://999')] as any);

    expect(createFileUpload).not.toHaveBeenCalled();
    expect(out[0]?.type).toBe('paragraph');
    const text = String(out[0]?.paragraph?.rich_text?.[0]?.text?.content || '');
    expect(text).toContain('local image upload failed');
  });
});
