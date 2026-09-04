import { describe, expect, it } from 'vitest';

import {
  collectOrderedSyncnosAssetIds,
  replaceSyncnosAssetImageReferences,
  replaceSyncnosAssetImageTargets,
} from '@services/shared/markdown-asset-refs';

describe('markdown asset refs', () => {
  it('collects ordered unique ids from Markdown image syntax and ignores other links', () => {
    const markdown = [
      '![one](syncnos-asset://2)',
      '[not image](syncnos-asset://9)',
      '![two](<syncnos-asset://1> "title")',
      '![duplicate](syncnos-asset://2 "again")',
      '![http](https://example.com/a.png)',
      '![invalid](syncnos-asset://0)',
      '`![inline-code](syncnos-asset://10)`',
      '```md',
      '![fenced](syncnos-asset://11)',
      '```',
      '    ![indented](syncnos-asset://12)',
    ].join('\n');

    expect(collectOrderedSyncnosAssetIds(markdown)).toEqual([2, 1]);
  });

  it('can replace a whole internal image reference for provider-specific readable degradation', () => {
    expect(
      replaceSyncnosAssetImageReferences('before ![x](syncnos-asset://7 "caption") after', ({ assetId }) =>
        assetId === 7 ? { replacement: '[Image unavailable]' } : null,
      ),
    ).toBe('before [Image unavailable] after');
  });

  it('replaces only mapped SyncNos image targets while preserving angle brackets, alt text and title suffix', () => {
    const markdown = [
      '![plain](syncnos-asset://2)',
      '![angled](<syncnos-asset://1> "caption")',
      '![unmapped](syncnos-asset://3)',
      '![external](https://example.com/a.png "external")',
    ].join('\n');

    expect(
      replaceSyncnosAssetImageTargets(
        markdown,
        new Map([
          [1, 'one.png'],
          [2, 'two.png'],
        ]),
      ),
    ).toBe(
      [
        '![plain](two.png)',
        '![angled](<one.png> "caption")',
        '![unmapped](syncnos-asset://3)',
        '![external](https://example.com/a.png "external")',
      ].join('\n'),
    );
  });
});
