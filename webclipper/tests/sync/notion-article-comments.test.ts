import { describe, expect, it } from 'vitest';

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionSectionBlocks() {
  return loadFresh('@services/sync/notion/notion-section-blocks.ts');
}

async function loadNotionCommentsRenderer() {
  return loadFresh('@services/comments/sync/notion-comments-renderer.ts');
}

describe('notion article comments blocks', () => {
  it('builds toggle heading blocks for SyncNos sections', async () => {
    const notionSections = await loadNotionSectionBlocks();
    const block = notionSections.buildToggleHeadingBlock('Article', 2);
    expect(block?.type).toBe('heading_2');
    expect(block?.heading_2?.is_toggleable).toBe(true);
    expect(block?.heading_2?.rich_text?.[0]?.text?.content).toBe('Article');
  });

  it('ignores archived toggle heading blocks when locating section headings', async () => {
    const notionSections = await loadNotionSectionBlocks();
    const archived = {
      object: 'block',
      id: 'b1',
      archived: true,
      type: 'heading_2',
      heading_2: {
        is_toggleable: true,
        rich_text: [{ type: 'text', text: { content: 'Comments' }, plain_text: 'Comments' }],
      },
    };
    const active = {
      object: 'block',
      id: 'b2',
      type: 'heading_2',
      heading_2: {
        is_toggleable: true,
        rich_text: [{ type: 'text', text: { content: 'Comments' }, plain_text: 'Comments' }],
      },
    };
    const picked = notionSections.findToggleHeadingBlock([archived, active], 'Comments');
    expect(picked?.id).toBe('b2');
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
    const children = res.blocks[1]?.bulleted_list_item?.children || [];
    expect(children.some((c: any) => c && c.type === 'bulleted_list_item')).toBe(true);
    const reply = children.find((c: any) => c && c.type === 'bulleted_list_item');
    expect(reply?.bulleted_list_item?.rich_text?.[0]?.text?.content).toBe('Reply comment');
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

  it('computes stable digest for comments and changes on deletion', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const comments = [
      {
        id: 1,
        parentId: null,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        quoteText: 'Quoted',
        commentText: 'A',
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 2,
        parentId: 1,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        quoteText: '',
        commentText: 'B',
        createdAt: 110,
        updatedAt: 110,
      },
    ];

    const d1 = renderer.computeNotionCommentsDigest(comments);
    const d2 = renderer.computeNotionCommentsDigest(comments.slice(0, 1));
    expect(String(d1)).not.toBe(String(d2));
    expect(renderer.computeNotionCommentsDigest(comments)).toBe(d1);
  });
});
