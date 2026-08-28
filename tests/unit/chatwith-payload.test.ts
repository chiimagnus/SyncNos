import { describe, expect, it } from 'vitest';

import { buildChatWithPayload } from '../../src/services/integrations/chatwith/chatwith-settings';

describe('buildChatWithPayload', () => {
  it('renders synced Notion, Feishu, and GitHub URLs', async () => {
    const payload = await buildChatWithPayload(
      {
        id: 1,
        sourceType: 'article',
        source: 'test',
        conversationKey: 'article:https://example.com/x',
        title: 'T',
        url: 'https://example.com/x',
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
        feishuDocId: 'docxToken',
      },
      {
        conversationId: 1,
        messages: [
          {
            id: 1,
            conversationId: 1,
            messageKey: 'm1',
            role: 'system',
            contentText: 'Hello',
          },
        ],
      },
      'Notion={{notion_url}}\nFeishu={{feishu_url}}\nGitHub={{github_url}}\nURL={{article_url}}',
      {
        githubUrl: 'https://github.com/owner/repo/blob/main/Articles/test.md',
      },
    );

    expect(payload).toContain('Notion=https://www.notion.so/0123456789abcdef0123456789abcdef');
    expect(payload).toContain('Feishu=https://www.feishu.cn/docx/docxToken');
    expect(payload).toContain('GitHub=https://github.com/owner/repo/blob/main/Articles/test.md');
    expect(payload).toContain('URL=https://example.com/x');
    expect(payload.endsWith('\n')).toBe(true);
  });

  it('renders empty synced URLs when targets are missing', async () => {
    const payload = await buildChatWithPayload(
      {
        id: 1,
        sourceType: 'article',
        source: 'test',
        conversationKey: 'article:https://example.com/x',
        title: 'T',
        url: 'https://example.com/x',
      },
      {
        conversationId: 1,
        messages: [
          {
            id: 1,
            conversationId: 1,
            messageKey: 'm1',
            role: 'system',
            contentText: 'Hello',
          },
        ],
      },
      'Notion={{notion_url}}\nFeishu={{feishu_url}}\nGitHub={{github_url}}',
    );

    expect(payload).toContain('Notion=');
    expect(payload).toContain('Feishu=');
    expect(payload).toContain('GitHub=');
    expect(payload.endsWith('\n')).toBe(true);
  });
});
