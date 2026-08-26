import { afterEach, describe, expect, it } from 'vitest';

import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { sha256Hex } from '@services/sync/github/github-content-hash';
import { buildGithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe('github markdown projection', () => {
  it('hashes text and bytes with stable lowercase SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each([
    ['chat', 'Chats'],
    ['article', 'Articles'],
    ['video', 'Videos'],
  ])('uses the %s folder and stable conversation basename', async (sourceType, expectedFolder) => {
    const conversation = {
      id: 7,
      sourceType,
      source: sourceType === 'video' ? 'youtube' : 'chatgpt',
      conversationKey: `${sourceType}-key`,
      title: `${sourceType} title`,
      url: `https://example.com/${sourceType}`,
    };
    const projection = await buildGithubMarkdownProjection({
      conversation,
      messages: [
        {
          messageKey: sourceType === 'article' ? 'article_body' : 'm1',
          sequence: 1,
          role: 'assistant',
          contentMarkdown: 'body',
        },
      ],
      folders: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
    });
    expect(projection.markdownPath).toBe(`${expectedFolder}/${buildConversationBasename(conversation)}.md`);
    expect(projection.markdownText).toContain(`url: "https://example.com/${sourceType}"`);
    expect(projection.markdownText).toContain('syncnos:');
    expect(projection.markdownText).toContain('body');
    expect(projection.markdownText).not.toContain('lastSyncedAt');
    expect(projection.markdownContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renders article comments in UTC and remains byte-stable across local timezone changes', async () => {
    const conversation = {
      id: 9,
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-key',
      title: 'Article',
      url: 'https://example.com/article',
    };
    const input = {
      conversation,
      messages: [{ messageKey: 'article_body', sequence: 1, contentMarkdown: 'Article body' }],
      comments: [
        {
          id: 1,
          parentId: null,
          conversationId: 9,
          canonicalUrl: conversation.url,
          quoteText: 'Quote',
          commentText: 'Comment',
          createdAt: Date.UTC(2026, 0, 2, 3, 4),
          updatedAt: Date.UTC(2026, 0, 2, 3, 4),
        },
      ],
      folders: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
    };

    process.env.TZ = 'America/Los_Angeles';
    const pacific = await buildGithubMarkdownProjection(input);
    process.env.TZ = 'Asia/Shanghai';
    const shanghai = await buildGithubMarkdownProjection(input);

    expect(pacific).toEqual(shanghai);
    expect(pacific.markdownText).toContain('- You | 2026-01-02 03:04');
    expect(pacific.markdownText).toContain('## Article');
    expect(pacific.markdownText).toContain('## Comments');
    expect(pacific.markdownText).toContain('> Quote');
  });

  it('changes only the path when title or folder changes while content bytes stay deterministic', async () => {
    const baseConversation = {
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'stable-key',
      title: 'Old title',
    };
    const messages = [{ messageKey: 'm1', sequence: 1, role: 'assistant', contentMarkdown: 'same body' }];
    const first = await buildGithubMarkdownProjection({
      conversation: baseConversation,
      messages,
      folders: { chatFolder: 'One', articleFolder: 'Articles', videoFolder: 'Videos' },
    });
    const renamed = await buildGithubMarkdownProjection({
      conversation: { ...baseConversation, title: 'New title' },
      messages,
      folders: { chatFolder: 'Two', articleFolder: 'Articles', videoFolder: 'Videos' },
    });

    expect(first.markdownPath).not.toBe(renamed.markdownPath);
    expect(first.markdownText).toBe(renamed.markdownText);
    expect(first.markdownContentHash).toBe(renamed.markdownContentHash);
  });
});
