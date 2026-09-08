import { describe, expect, it } from 'vitest';

async function loadWriter() {
  const mod = await import('@services/sync/shared/remote-markdown-writer.ts');
  return mod.default || mod;
}

describe('remote-markdown-writer', () => {
  it('builds full markdown with frontmatter and stable heading', async () => {
    const w = await loadWriter();
    const md = w.buildFullNoteMarkdown({
      conversation: {
        title: 'T',
        source: 's',
        sourceType: 'chat',
        conversationKey: 'k',
        url: 'https://example.com/chat',
        lastActivityAt: Date.parse('2026-09-08T02:00:00.000Z'),
      },
      messages: [{ messageKey: 'm1', sequence: 1, role: 'assistant', contentMarkdown: 'hi' }],
      syncnosObject: {
        source: 's',
        conversationKey: 'k',
        schemaVersion: 1,
        lastSyncedSequence: 1,
        lastSyncedMessageKey: 'm1',
      },
    });
    expect(md).toContain('---');
    expect(md).toContain('url:');
    expect(md).toContain('last_activity_at: "2026-09-08T02:00:00.000Z"');
    expect(md).toContain('syncnos:');
    expect(md).toContain('# Conversations');
    expect(md).toContain('## 1 assistant');
    expect(md).toContain('hi');
  });

  it('builds article markdown with Article/Comments sections and quote+bullets', async () => {
    const w = await loadWriter();
    const md = w.buildFullNoteMarkdown({
      conversation: {
        title: 'T',
        source: 's',
        sourceType: 'article',
        conversationKey: 'k',
        url: 'https://example.com',
        lastActivityAt: Date.parse('2026-09-08T03:00:00.000Z'),
      },
      messages: [{ messageKey: 'article_body', sequence: 1, role: 'assistant', contentMarkdown: 'Body **md**' }],
      comments: [
        {
          id: 1,
          parentId: null,
          conversationId: 1,
          canonicalUrl: 'https://example.com',
          quoteText: 'Quoted',
          commentText: 'Root',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 2,
          parentId: 1,
          conversationId: 1,
          canonicalUrl: 'https://example.com',
          quoteText: '',
          commentText: 'Reply',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      syncnosObject: {
        source: 's',
        conversationKey: 'k',
        schemaVersion: 1,
        lastSyncedSequence: 1,
        lastSyncedMessageKey: 'article_body',
      },
    });
    expect(md).toContain('## Article');
    expect(md).toContain('## Comments');
    expect(md).not.toContain('## Conversations');
    expect(md).toContain('last_activity_at: "2026-09-08T03:00:00.000Z"');
    expect(md).toContain('comments_root_count: 1');
    expect(md).toContain('> Quoted');
    expect(md.match(/^- You \|/gm)?.length || 0).toBe(2);
    expect(md).toContain('  Root');
    expect(md).toContain('  Reply');
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 9e99])(
    'omits invalid Activity %s without inventing a timestamp',
    async (lastActivityAt) => {
      const w = await loadWriter();
      const md = w.buildFullNoteMarkdown({
        conversation: {
          sourceType: 'chat',
          source: 'chatgpt',
          conversationKey: 'invalid-activity',
          lastActivityAt,
        },
        messages: [{ messageKey: 'm1', sequence: 1, role: 'assistant', contentMarkdown: 'body' }],
        syncnosObject: { source: 'chatgpt', conversationKey: 'invalid-activity', schemaVersion: 1 },
      });

      expect(md).not.toContain('last_activity_at:');
    },
  );

  it('keeps default/local comment timestamps compatible and supports deterministic UTC rendering', async () => {
    const w = await loadWriter();
    const timestamp = Date.UTC(2026, 0, 2, 3, 4);
    const date = new Date(timestamp);
    const pad2 = (value: number) => String(value).padStart(2, '0');
    const localTime = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    const input = {
      conversation: { sourceType: 'article' },
      comments: [
        {
          id: 1,
          parentId: null,
          conversationId: 1,
          canonicalUrl: 'https://example.com',
          quoteText: '',
          commentText: 'Comment',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };

    const defaultMd = w.buildFullNoteMarkdown(input);
    const localMd = w.buildFullNoteMarkdown({ ...input, commentTimeZone: 'local' });
    const utcMd = w.buildFullNoteMarkdown({ ...input, commentTimeZone: 'utc' });

    expect(defaultMd).toBe(localMd);
    expect(defaultMd).toContain(`- You | ${localTime}`);
    expect(utcMd).toContain('- You | 2026-01-02 03:04');
  });

  it('preserves image-looking caption text inside code while normalizing real image captions', async () => {
    const w = await loadWriter();
    const source = [
      '```md',
      '![code](https://example.com/code.png)Code caption',
      '```',
      '',
      '    ![indent](https://example.com/i.png)Indented caption',
      '',
      '![real](https://example.com/real.png)Real caption',
    ].join('\n');
    const md = w.buildFullNoteMarkdown({
      conversation: { title: 'T', source: 's', sourceType: 'article', conversationKey: 'k' },
      messages: [{ messageKey: 'article_body', sequence: 1, role: 'assistant', contentMarkdown: source }],
      comments: [],
      syncnosObject: { source: 's', conversationKey: 'k', schemaVersion: 1, lastSyncedSequence: 1 },
    });

    expect(md).toContain('![code](https://example.com/code.png)Code caption');
    expect(md).toContain('    ![indent](https://example.com/i.png)Indented caption');
    expect(md).toContain('![real](https://example.com/real.png)\n\nReal caption');
  });

  it('normalizes standalone image lines that append caption text', async () => {
    const w = await loadWriter();
    const md = w.buildFullNoteMarkdown({
      conversation: {
        title: 'T',
        source: 's',
        sourceType: 'article',
        conversationKey: 'k',
        url: 'https://example.com',
      },
      messages: [
        {
          messageKey: 'article_body',
          sequence: 1,
          role: 'assistant',
          contentMarkdown: '![CleanShot](https://cdn3.linux.do/optimized/4X/5/1/2/example.png)CleanShot 828×1194 84 KB',
        },
      ],
      comments: [],
      syncnosObject: {
        source: 's',
        conversationKey: 'k',
        schemaVersion: 1,
        lastSyncedSequence: 1,
        lastSyncedMessageKey: 'article_body',
      },
    });

    expect(md).toContain('comments_root_count: 0');
    expect(md).toContain(
      '![CleanShot](https://cdn3.linux.do/optimized/4X/5/1/2/example.png)\n\nCleanShot 828×1194 84 KB',
    );
  });
});
