import { describe, expect, it } from 'vitest';
import { markdownToNotionBlocks } from '../../src/sync/notion/notion-markdown-blocks';

describe('notion-markdown-blocks', () => {
  it('parses syncnos-asset image markdown into an external image block', () => {
    const blocks = markdownToNotionBlocks('![](syncnos-asset://42)');
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[0]?.image?.type).toBe('external');
    expect(blocks[0]?.image?.external?.url).toBe('syncnos-asset://42');
  });
});
