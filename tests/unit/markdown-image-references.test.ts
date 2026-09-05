import { describe, expect, it } from 'vitest';

import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
} from '@services/shared/markdown-image-references';

describe('markdown image references', () => {
  it('keeps only real Markdown image tokens across prose, code, escapes and nesting', () => {
    const markdown = [
      'plain syncnos-asset://1',
      '\\![escaped](syncnos-asset://2)',
      '`![inline](syncnos-asset://3)`',
      '```md',
      '![fenced](syncnos-asset://4)',
      '```',
      '    ![indented](syncnos-asset://5)',
      '![paragraph](syncnos-asset://6)',
      '> ![quote](syncnos-asset://7)',
      '- ![list](syncnos-asset://8)',
      '[![nested](syncnos-asset://9)](https://example.com)',
    ].join('\n');

    expect(collectMarkdownImageReferences(markdown).map((reference) => reference.target)).toEqual([
      'syncnos-asset://6',
      'syncnos-asset://7',
      'syncnos-asset://8',
      'syncnos-asset://9',
    ]);
  });

  it('preserves source formatting while replacing only the target or whole image', () => {
    const markdown = 'before ![alt](  <syncnos-asset://7>   "caption"  ) after ![drop](syncnos-asset://8)';
    const references = collectMarkdownImageReferences(markdown);
    expect(references).toHaveLength(2);
    expect(references[0]).toMatchObject({
      alt: 'alt',
      rawTarget: '<syncnos-asset://7>',
      target: 'syncnos-asset://7',
      title: '   "caption"',
      angleWrapped: true,
    });

    expect(
      replaceMarkdownImageReferences(markdown, references, (reference) => {
        if (reference.target.endsWith('//7')) return { target: 'asset.png' };
        return { replacement: '[Image unavailable]' };
      }),
    ).toBe('before ![alt](  <asset.png>   "caption"  ) after [Image unavailable]');
  });
});
