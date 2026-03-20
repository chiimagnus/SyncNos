import { describe, expect, it } from 'vitest';

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionSectionBlocks() {
  return loadFresh('../../src/sync/notion/notion-section-blocks.ts');
}

async function loadNotionCommentsRenderer() {
  return loadFresh('../../src/comments/sync/notion-comments-renderer.ts');
}

describe('notion article comments blocks', () => {
  it('builds toggle heading blocks for SyncNos sections', async () => {
    const notionSections = await loadNotionSectionBlocks();
    const block = notionSections.buildToggleHeadingBlock('SyncNos::Article', 2);
    expect(block?.type).toBe('heading_2');
    expect(block?.heading_2?.is_toggleable).toBe(true);
    expect(block?.heading_2?.rich_text?.[0]?.text?.content).toBe('SyncNos::Article');
  });

  it('renders comments into quote + bullet blocks', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const res = renderer.buildNotionCommentsBlocks([
      {
        id: 1,
        parentId: null,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        quoteText: 'Quoted text',
        commentText: 'Root comment',
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 2,
        parentId: 1,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        quoteText: '',
        commentText: 'Reply comment',
        createdAt: 110,
        updatedAt: 110,
      },
    ]);

    expect(res.threads).toBe(1);
    expect(res.items).toBe(2);
    expect(Array.isArray(res.blocks)).toBe(true);
    expect(res.blocks[0]?.type).toBe('quote');
    expect(res.blocks[0]?.quote?.rich_text?.[0]?.text?.content).toBe('Quoted text');
    expect(res.blocks[1]?.type).toBe('bulleted_list_item');
    expect(res.blocks[1]?.bulleted_list_item?.rich_text?.[0]?.text?.content).toBe('Root comment');
    expect(res.blocks[2]?.bulleted_list_item?.rich_text?.[0]?.text?.content).toMatch(/^↳ /);
  });

  it('splits oversized comment text into a bullet with continuation paragraphs', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const longText = 'x'.repeat(4200);
    const res = renderer.buildNotionCommentsBlocks([
      {
        id: 1,
        parentId: null,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        quoteText: 'Quoted',
        commentText: longText,
        createdAt: 100,
        updatedAt: 100,
      },
    ]);

    const bullet = res.blocks.find((b: any) => b && b.type === 'bulleted_list_item');
    expect(bullet).toBeTruthy();
    const children = bullet?.bulleted_list_item?.children || [];
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((c: any) => c && c.type === 'paragraph')).toBe(true);
  });
});

