import { beforeEach, describe, expect, it, vi } from 'vitest';

let notionFetchImpl: ((req: any) => Promise<any>) | null = null;

vi.mock('@services/sync/notion/notion-api.ts', () => {
  const notionFetch = (req: any) => {
    if (!notionFetchImpl) throw new Error('notionFetchImpl not set');
    return notionFetchImpl(req);
  };
  return {
    NOTION_VERSION: '2022-06-28',
    notionFetch,
  };
});

import * as notionSyncService from '@services/sync/notion/notion-sync-service.ts';

beforeEach(() => {
  notionFetchImpl = null;
});

describe('notion-sync-service', () => {
  it('forwards explicit create properties without injecting generic metadata', async () => {
    let lastReq: any = null;
    notionFetchImpl = async (req: any) => {
      lastReq = req;
      return { id: 'p1' };
    };
    const properties = {
      Name: { title: [{ type: 'text', text: { content: 'Hello' } }] },
      URL: { url: 'https://x' },
      Date: { date: { start: '2026-02-23T12:34:56.000Z' } },
      AI: { multi_select: [{ name: 'ChatGPT' }] },
    };

    await notionSyncService.createPageInDatabase('t', { databaseId: 'db', properties });
    expect(lastReq.method).toBe('POST');
    expect(lastReq.path).toBe('/v1/pages');
    expect(lastReq.body.properties).toEqual(properties);
  });

  it('respects explicit properties (article should not inject AI)', async () => {
    let lastReq: any = null;
    notionFetchImpl = async (req: any) => {
      lastReq = req;
      return { id: 'p1' };
    };

    await notionSyncService.createPageInDatabase('t', {
      databaseId: 'db',
      properties: {
        Name: { title: [{ type: 'text', text: { content: 'Article' } }] },
        URL: { url: 'https://x' },
        Date: { date: { start: '2026-02-26T00:00:00.000Z' } },
        Author: { rich_text: [{ type: 'text', text: { content: 'A' } }] },
      },
    });
    expect(lastReq.body.properties.AI).toBeUndefined();
    expect(lastReq.body.properties.Author).toBeTruthy();
  });

  it('forwards explicit update properties including the activity Date', async () => {
    let lastReq: any = null;
    notionFetchImpl = async (req: any) => {
      lastReq = req;
      return { ok: true };
    };
    const properties = {
      Name: { title: [{ type: 'text', text: { content: 'Hello' } }] },
      URL: { url: null },
      Date: { date: { start: '2026-02-24T12:34:56.000Z' } },
      AI: { multi_select: [{ name: 'Gemini' }] },
    };

    await notionSyncService.updatePageProperties('t', { pageId: 'p1', properties });
    expect(lastReq.method).toBe('PATCH');
    expect(lastReq.path).toBe('/v1/pages/p1');
    expect(lastReq.body.properties).toEqual(properties);
  });

  it('accepts only live pages in the expected database', () => {
    const page = {
      parent: { type: 'database_id', database_id: '01234567-89ab-cdef-0123-456789abcdef' },
      archived: false,
      in_trash: false,
    };
    expect(notionSyncService.isPageUsableForDatabase(page, '0123456789abcdef0123456789abcdef')).toBe(true);
    expect(notionSyncService.isPageUsableForDatabase(page, 'fedcba9876543210fedcba9876543210')).toBe(false);
    expect(
      notionSyncService.isPageUsableForDatabase({ ...page, archived: true }, '0123456789abcdef0123456789abcdef'),
    ).toBe(false);
    expect(
      notionSyncService.isPageUsableForDatabase({ ...page, in_trash: true }, '0123456789abcdef0123456789abcdef'),
    ).toBe(false);
  });
});
