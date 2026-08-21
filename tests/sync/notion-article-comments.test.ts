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

  it('locates toggle headings even when is_toggleable is missing', async () => {
    const notionSections = await loadNotionSectionBlocks();
    const legacyToggleHeading = {
      object: 'block',
      id: 'b_legacy',
      type: 'heading_2',
      has_children: true,
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Conversations' }, plain_text: 'Conversations' }],
      },
    };
    const picked = notionSections.findToggleHeadingBlock([legacyToggleHeading], 'Conversations');
    expect(picked?.id).toBe('b_legacy');
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
    expect(String(res.blocks[1]?.bulleted_list_item?.rich_text?.[0]?.text?.content || '')).toContain('You |');
    const children = res.blocks[1]?.bulleted_list_item?.children || [];
    const rootText = children.find(
      (c: any) =>
        c &&
        c.type === 'paragraph' &&
        String(c?.paragraph?.rich_text?.[0]?.text?.content || '').includes('Root comment'),
    );
    expect(rootText).toBeTruthy();

    const replyBullet = res.blocks.find(
      (b: any) =>
        b &&
        b.type === 'bulleted_list_item' &&
        String(b?.bulleted_list_item?.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content || '').includes(
          'Reply comment',
        ),
    );
    expect(replyBullet).toBeTruthy();
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

  it('keeps digest stable when local database ids are remapped but thread content is unchanged', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const source = [
      {
        id: 41,
        parentId: null,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        authorName: 'A',
        quoteText: 'Quoted',
        commentText: 'Root',
        locator: null,
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 57,
        parentId: 41,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        authorName: 'B',
        quoteText: '',
        commentText: 'Reply',
        locator: null,
        createdAt: 110,
        updatedAt: 110,
      },
    ];
    const restored = [
      { ...source[0], id: 1 },
      { ...source[1], id: 2, parentId: 1 },
    ];

    expect(renderer.computeNotionCommentsDigest(restored)).toBe(renderer.computeNotionCommentsDigest(source));
  });

  it('keeps digest stable when equal-time roots differ only by reply creation time across id remaps', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const comment = (id: number, parentId: number | null, createdAt: number, updatedAt: number) => ({
      id,
      parentId,
      conversationId: 10,
      canonicalUrl: 'https://example.com',
      authorName: 'A',
      quoteText: '',
      commentText: parentId == null ? 'same-root' : 'same-reply',
      locator: null,
      createdAt,
      updatedAt,
    });
    const source = [
      comment(41, null, 100, 200),
      comment(57, null, 100, 200),
      comment(80, 41, 110, 300),
      comment(70, 57, 120, 300),
    ];
    const restored = [
      comment(3, null, 100, 200),
      comment(1, null, 100, 200),
      comment(4, 3, 110, 300),
      comment(2, 1, 120, 300),
    ];

    expect(renderer.computeNotionCommentsDigest(restored)).toBe(renderer.computeNotionCommentsDigest(source));
  });

  it('counts root threads even when a root has no quote', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const result = renderer.buildNotionCommentsBlocks([
      {
        id: 1,
        parentId: null,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        authorName: 'A',
        quoteText: '',
        commentText: 'Root',
        locator: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 2,
        parentId: 1,
        conversationId: 10,
        canonicalUrl: 'https://example.com',
        authorName: 'B',
        quoteText: '',
        commentText: 'Reply',
        locator: null,
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
    expect(result.threads).toBe(1);
    expect(result.items).toBe(2);
  });

  it('changes digest when author or locator schema changes', async () => {
    const renderer = await loadNotionCommentsRenderer();
    const base = {
      id: 1,
      parentId: null,
      conversationId: 10,
      canonicalUrl: 'https://example.com',
      authorName: 'A',
      quoteText: 'q',
      commentText: 'c',
      locator: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const authorDigest = renderer.computeNotionCommentsDigest([base]);
    expect(renderer.computeNotionCommentsDigest([{ ...base, authorName: 'B' }])).not.toBe(authorDigest);
    expect(
      renderer.computeNotionCommentsDigest([
        {
          ...base,
          locator: {
            v: 1,
            env: 'app',
            quote: { type: 'TextQuoteSelector', exact: 'q' },
            position: { type: 'TextPositionSelector', start: 0, end: 1 },
          },
        },
      ]),
    ).not.toBe(authorDigest);
  });
});
