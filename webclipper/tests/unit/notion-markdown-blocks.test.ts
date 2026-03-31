import { describe, expect, it } from 'vitest';
import { markdownToNotionBlocks } from '@services/sync/notion/notion-markdown-blocks';

describe('notion-markdown-blocks', () => {
  it('parses syncnos-asset image markdown into an external image block', () => {
    const blocks = markdownToNotionBlocks('![](syncnos-asset://42)');
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[0]?.image?.type).toBe('external');
    expect(blocks[0]?.image?.external?.url).toBe('syncnos-asset://42');
  });

  it('splits standalone image lines with trailing caption text into image + paragraph blocks', () => {
    const blocks = markdownToNotionBlocks(
      '![CleanShot](https://cdn3.linux.do/optimized/4X/5/1/2/example.png)CleanShot 828×1194 84 KB',
    );
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[0]?.image?.external?.url).toBe('https://cdn3.linux.do/optimized/4X/5/1/2/example.png');

    expect(blocks[1]?.type).toBe('paragraph');
    const paragraph = (blocks[1]?.paragraph?.rich_text || [])
      .map((item: any) => String(item?.plain_text || item?.text?.content || ''))
      .join('');
    expect(paragraph).toContain('CleanShot 828×1194 84 KB');
  });
});
