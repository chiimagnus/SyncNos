import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageCacheMocks = vi.hoisted(() => ({
  getImageCacheAssetsByIds: vi.fn(),
}));

vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetsByIds: (...args: any[]) => imageCacheMocks.getImageCacheAssetsByIds(...args),
}));

import { preprocessFeishuDocxMarkdownImages } from '@services/sync/feishu/docx/feishu-docx-image-preprocess';

function makeAsset(id: number) {
  return {
    id,
    conversationId: 1,
    url: `https://cdn.example.com/${id}.png`,
    blob: new Blob([Uint8Array.of(id)], { type: 'image/png' }),
    byteSize: 1,
    contentType: 'image/png',
  };
}

describe('feishu docx image preprocess', () => {
  beforeEach(() => {
    imageCacheMocks.getImageCacheAssetsByIds.mockReset();
  });

  it('bulk-loads unique SyncNos assets once while preserving repeated source order', async () => {
    imageCacheMocks.getImageCacheAssetsByIds.mockResolvedValue(new Map([[7, makeAsset(7)]]));
    const dataUrl = `data:image/png;base64,${Buffer.from(Uint8Array.of(1, 2, 3)).toString('base64')}`;
    const markdown = [
      '![remote](https://example.com/remote.png)',
      '![local](syncnos-asset://7)',
      '![local-again](<syncnos-asset://7>)',
      '![missing](syncnos-asset://8)',
      `![data](${dataUrl})`,
    ].join('\n\n');

    const result = await preprocessFeishuDocxMarkdownImages(markdown);

    expect(imageCacheMocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(imageCacheMocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [7, 8] });
    expect(result.imageSourcesInOrder.map((source) => source.kind)).toEqual([
      'http',
      'syncnos_asset',
      'syncnos_asset',
      'syncnos_asset',
      'data',
    ]);
    expect(result.imageSourcesInOrder.map((source) => source.sourceUrl)).toEqual([
      'https://example.com/remote.png',
      'syncnos-asset://7',
      'syncnos-asset://7',
      'syncnos-asset://8',
      dataUrl,
    ]);
    expect(result.imageSourcesInOrder[1]).toMatchObject({
      urlForConvert: 'https://cdn.example.com/7.png',
      contentType: 'image/png',
    });
    expect(result.imageSourcesInOrder[1]?.blob).toBeInstanceOf(Blob);
    expect(result.imageSourcesInOrder[2]?.blob).toBe(result.imageSourcesInOrder[1]?.blob);
    expect(result.imageSourcesInOrder[3]?.urlForConvert).toMatch(/^https:\/\/syncnos\.invalid\/asset\/[a-f0-9]+\.png$/);
    expect(result.imageSourcesInOrder[3]?.blob).toBeUndefined();
    expect(result.imageSourcesInOrder[4]?.urlForConvert).toMatch(/^https:\/\/syncnos\.invalid\/data\/[a-f0-9]+\.png$/);
    expect(result.imageSourcesInOrder[4]?.blob).toBeInstanceOf(Blob);
    expect(result.markdownForConvert).not.toContain('syncnos-asset://');
  });

  it('degrades a bulk local-asset read rejection to the existing placeholder semantics', async () => {
    imageCacheMocks.getImageCacheAssetsByIds.mockRejectedValue(new Error('idb unavailable'));
    const result = await preprocessFeishuDocxMarkdownImages('![one](syncnos-asset://7)\n\n![two](syncnos-asset://8)');

    expect(imageCacheMocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(imageCacheMocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [7, 8] });
    expect(result.imageSourcesInOrder).toHaveLength(2);
    for (const source of result.imageSourcesInOrder) {
      expect(source.kind).toBe('syncnos_asset');
      expect(source.urlForConvert).toMatch(/^https:\/\/syncnos\.invalid\/asset\/[a-f0-9]+\.png$/);
      expect(source.blob).toBeUndefined();
    }
    expect(result.markdownForConvert).not.toContain('syncnos-asset://');
  });

  it('classifies malformed internal targets as unavailable local images instead of external URLs', async () => {
    const result = await preprocessFeishuDocxMarkdownImages(
      '![bad](syncnos-asset://nope)\n\n![zero](syncnos-asset://0)\n\n![unsafe](syncnos-asset://9007199254740992)',
    );

    expect(imageCacheMocks.getImageCacheAssetsByIds).not.toHaveBeenCalled();
    expect(result.imageSourcesInOrder).toHaveLength(3);
    expect(result.imageSourcesInOrder.every((source) => source.kind === 'syncnos_asset')).toBe(true);
    expect(result.imageSourcesInOrder.every((source) => source.blob == null)).toBe(true);
    expect(result.markdownForConvert).not.toContain('syncnos-asset://');
    expect(result.markdownForConvert.match(/https:\/\/syncnos\.invalid\/asset\//g)?.length).toBe(3);
  });

  it('keeps HTTP/data-image preprocessing unchanged and skips the local bulk reader when no local ids exist', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(Uint8Array.of(4, 5, 6)).toString('base64')}`;
    const result = await preprocessFeishuDocxMarkdownImages(
      `![remote](https://example.com/a.png)\n\n![data](${dataUrl})`,
    );

    expect(imageCacheMocks.getImageCacheAssetsByIds).not.toHaveBeenCalled();
    expect(result.imageSourcesInOrder[0]).toEqual({
      kind: 'http',
      sourceUrl: 'https://example.com/a.png',
      urlForConvert: 'https://example.com/a.png',
    });
    expect(result.imageSourcesInOrder[1]).toMatchObject({
      kind: 'data',
      sourceUrl: dataUrl,
      contentType: 'image/png',
    });
    expect(result.imageSourcesInOrder[1]?.blob).toBeInstanceOf(Blob);
    expect(result.markdownForConvert).toContain('https://example.com/a.png');
    expect(result.markdownForConvert).not.toContain(dataUrl);
  });
});
