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

  it('accepts angle-wrapped SyncNos asset targets through the shared parser', () => {
    const blocks = markdownToNotionBlocks('![angle](<syncnos-asset://43>)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[0]?.image?.external?.url).toBe('syncnos-asset://43');
  });

  it('keeps malformed internal targets classified as image blocks for safe downstream degradation', () => {
    for (const target of ['syncnos-asset://0', 'syncnos-asset://nope', 'syncnos-asset://9007199254740992']) {
      const blocks = markdownToNotionBlocks(`![](${target})`);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('image');
      expect(blocks[0]?.image?.external?.url).toBe(target);
    }
  });

  it('does not turn indented code that looks like an image into a Notion image block', () => {
    for (const markdown of ['    ![code](syncnos-asset://42)', '\t![code](syncnos-asset://42)']) {
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks.some((block: any) => block?.type === 'image')).toBe(false);
    }
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
