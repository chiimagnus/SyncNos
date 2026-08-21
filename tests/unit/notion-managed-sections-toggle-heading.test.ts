import { describe, expect, it, vi } from 'vitest';

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

function notionHttpResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (_name: string) => null },
    text: async () => JSON.stringify(body ?? {}),
  } as any;
}

describe('notion managed sections', () => {
  it('re-discovers toggle heading when list omits is_toggleable', async () => {
    const sections = await loadFresh('@services/sync/notion/notion-managed-sections.ts');

    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const href = String(url);
      if (method === 'GET' && href.includes('/v1/blocks/p1/children')) {
        return notionHttpResponse({
          results: [
            {
              object: 'block',
              id: 'b1',
              type: 'heading_2',
              has_children: false,
              heading_2: {
                rich_text: [{ type: 'text', text: { content: 'Conversations' }, plain_text: 'Conversations' }],
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      if (method === 'GET' && href.includes('/v1/blocks/b1')) {
        return notionHttpResponse({
          object: 'block',
          id: 'b1',
          type: 'heading_2',
          has_children: false,
          heading_2: {
            is_toggleable: true,
            rich_text: [{ type: 'text', text: { content: 'Conversations' }, plain_text: 'Conversations' }],
          },
        });
      }
      throw new Error(`unexpected fetch: ${method} ${href}`);
    });
    (globalThis as any).fetch = fetchMock;

    const appendChildren = vi.fn(async () => ({ results: [{ id: 'new_heading' }] }));
    const patchSyncMapping = vi.fn(async () => true);

    const res = await sections.ensureSectionHeadingBlockId({
      accessToken: 't',
      pageId: 'p1',
      section: { id: 'conversations', title: 'Conversations', level: 2 },
      mapping: null,
      notionSyncService: { appendChildren },
      storage: { patchSyncMapping },
      conversationId: 1,
    });

    expect(res.headingBlockId).toBe('b1');
    expect(res.discoveredBy).toBe('scan');
    expect(appendChildren).toHaveBeenCalledTimes(0);
    expect(patchSyncMapping).toHaveBeenCalledTimes(1);
    expect(patchSyncMapping).toHaveBeenCalledWith(1, {
      notionSections: { conversations: { headingBlockId: 'b1' } },
    });
  });
});
