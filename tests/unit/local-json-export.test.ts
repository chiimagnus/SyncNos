import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConversationDetail: vi.fn(),
  getImageCacheAssetsByIds: vi.fn(),
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationDetail: (...args: any[]) => mocks.getConversationDetail(...args),
}));

vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetsByIds: (...args: any[]) => mocks.getImageCacheAssetsByIds(...args),
}));

vi.mock('@services/shared/file-timestamp', () => ({
  buildLocalTimestampForFilename: () => '20260906-010203',
}));

import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { buildConversationsJsonZipExport } from '@services/sync/local/json-export';

function conversation(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    source: 'chatgpt',
    conversationKey: `chat-${id}`,
    title: `Chat ${id}`,
    url: `https://example.com/chat/${id}`,
    lastCapturedAt: 1_700_000_000_000 + id,
    warningFlags: [],
    ...overrides,
  } as any;
}

function message(messageKey: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    conversationId: 1,
    messageKey,
    role: 'assistant',
    sequence: 1,
    updatedAt: 123,
    ...overrides,
  } as any;
}

function asset(id: number, conversationId: number, contentType = 'image/png', bytes = [id]) {
  return {
    id,
    conversationId,
    url: `https://cdn.example.com/${id}.png`,
    blob: new Blob([Uint8Array.from(bytes)], { type: contentType }),
    byteSize: bytes.length,
    contentType,
  } as any;
}

async function readJsonEntries(blob: Blob): Promise<Array<{ name: string; value: any }>> {
  const entries = await extractZipEntries(blob);
  return [...entries.entries()]
    .filter(([name]) => name.endsWith('.json'))
    .map(([name, bytes]) => ({ name, value: JSON.parse(new TextDecoder().decode(bytes)) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getImageCacheAssetsByIds.mockResolvedValue(new Map());
});

describe('local JSON v1 export', () => {
  it('exports a chat with the public v1 allowlist and canonical message order', async () => {
    const c = conversation(1, {
      source: ' chatgpt ',
      conversationKey: ' opaque-key ',
      title: '  Title  ',
      url: '  https://example.com/one  ',
      lastCapturedAt: 1_700_000_000_000,
      warningFlags: [' warning-a ', '', 7, 'warning-b'],
      listSourceKey: 'internal-list-source',
      listSiteKey: 'internal-site',
      notionPageId: 'notion-id',
      notionPageUrl: 'https://notion.example',
      notionWorkspaceSlug: 'workspace',
      feishuDocId: 'feishu-id',
      commentThreadCount: 4,
    });
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 1,
      messages: [
        message('m-2', {
          role: ' assistant ',
          authorName: '  Assistant  ',
          contentMarkdown: '  markdown with spaces  ',
          contentText: '\ntext\n',
          sequence: 2,
        }),
        message('m-1', { role: 42, authorName: '', contentMarkdown: '', contentText: undefined, sequence: 1 }),
      ],
    });

    const result = await buildConversationsJsonZipExport({ conversations: [c] });
    const [entry] = await readJsonEntries(result.zipBlob);

    expect(result.filename).toBe('SyncNos-json-20260906-010203.zip');
    expect(entry.name).toBe(`${buildConversationBasename(c)}.json`);
    expect(entry.value).toEqual({
      schemaVersion: 1,
      type: 'chat',
      source: 'chatgpt',
      key: 'opaque-key',
      title: 'Title',
      url: 'https://example.com/one',
      capturedAt: '2023-11-14T22:13:20.000Z',
      warnings: ['warning-a', 'warning-b'],
      attachments: [],
      messages: [
        {
          key: 'm-2',
          role: 'assistant',
          author: 'Assistant',
          content: { format: 'markdown', value: '  markdown with spaces  ' },
        },
        {
          key: 'm-1',
          role: 'assistant',
          author: null,
          content: null,
        },
      ],
    });
    expect(JSON.stringify(entry.value)).not.toMatch(
      /notion|feishu|commentThread|listSource|listSite|conversationId|sequence|updatedAt|"id"/,
    );
  });

  it('uses article_body when present and falls back to the first historical message only when that key is absent', async () => {
    const semantic = conversation(2, {
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article:semantic',
      author: '  Author  ',
      publishedAt: ' 2026-09-01 ',
    });
    const fallback = conversation(3, {
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article:fallback',
    });
    mocks.getConversationDetail.mockImplementation(async (id: number) =>
      id === 2
        ? {
            conversationId: 2,
            messages: [
              message('legacy', { contentMarkdown: 'wrong first', contentText: 'wrong text' }),
              message('article_body', { contentMarkdown: '', contentText: 'semantic text' }),
            ],
          }
        : {
            conversationId: 3,
            messages: [message('legacy', { contentMarkdown: 'fallback md', contentText: 'fallback text' })],
          },
    );

    const result = await buildConversationsJsonZipExport({ conversations: [semantic, fallback] });
    const entries = await readJsonEntries(result.zipBlob);
    const semanticJson = entries.find(({ value }) => value.key === 'article:semantic')!.value;
    const fallbackJson = entries.find(({ value }) => value.key === 'article:fallback')!.value;

    expect(semanticJson).toMatchObject({
      type: 'article',
      author: 'Author',
      publishedAt: '2026-09-01',
      content: { format: 'text', value: 'semantic text' },
    });
    expect(semanticJson.messages).toBeUndefined();
    expect(fallbackJson).toMatchObject({
      type: 'article',
      author: null,
      publishedAt: null,
      content: { format: 'markdown', value: 'fallback md' },
    });
  });

  it('exports video_transcript as video and never leaks unsupported capture diagnostics', async () => {
    const c = conversation(4, {
      source: 'video',
      sourceType: 'video',
      conversationKey: 'video:https://example.com/watch/4',
      author: 'Creator',
      platform: 'youtube',
      durationSeconds: 123,
      thumbnailUrl: 'https://example.com/thumb.jpg',
      transcriptSource: 'C',
      hasTimestamps: true,
    });
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 4,
      messages: [
        message('legacy', { contentMarkdown: 'wrong' }),
        message('video_transcript', { role: 'transcript', contentMarkdown: '00:01 hello', contentText: 'hello' }),
      ],
    });

    const result = await buildConversationsJsonZipExport({ conversations: [c] });
    const [entry] = await readJsonEntries(result.zipBlob);

    expect(entry.value).toMatchObject({
      schemaVersion: 1,
      type: 'video',
      source: 'video',
      key: 'video:https://example.com/watch/4',
      author: 'Creator',
      transcript: { format: 'markdown', value: '00:01 hello' },
      attachments: [],
    });
    expect(entry.value.messages).toBeUndefined();
    expect(entry.value.content).toBeUndefined();
    expect(entry.value).not.toHaveProperty('platform');
    expect(entry.value).not.toHaveProperty('durationSeconds');
    expect(entry.value).not.toHaveProperty('thumbnailUrl');
    expect(entry.value).not.toHaveProperty('transcriptSource');
    expect(entry.value).not.toHaveProperty('hasTimestamps');
  });

  it('falls back to the first historical video message only when video_transcript is absent', async () => {
    const c = conversation(40, {
      source: 'video',
      sourceType: 'video',
      conversationKey: 'video:legacy',
    });
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 40,
      messages: [message('legacy-transcript', { contentMarkdown: 'legacy md', contentText: 'legacy text' })],
    });

    const result = await buildConversationsJsonZipExport({ conversations: [c] });
    const [entry] = await readJsonEntries(result.zipBlob);
    expect(entry.value).toMatchObject({
      type: 'video',
      transcript: { format: 'markdown', value: 'legacy md' },
    });
  });

  it('keeps text fallback opaque and does not parse asset-like text as Markdown', async () => {
    const c = conversation(41, {
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article:text-only',
    });
    const textOnly = 'plain ![example](syncnos-asset://41) text';
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 41,
      messages: [message('article_body', { contentMarkdown: '', contentText: textOnly })],
    });

    const result = await buildConversationsJsonZipExport({ conversations: [c] });
    const [entry] = await readJsonEntries(result.zipBlob);

    expect(entry.value.content).toEqual({ format: 'text', value: textOnly });
    expect(entry.value.attachments).toEqual([]);
    expect(mocks.getImageCacheAssetsByIds).not.toHaveBeenCalled();
  });

  it('materializes cached image targets once in first-reference order and preserves non-asset content exactly', async () => {
    const c = conversation(5);
    const markdownA = [
      '![two](syncnos-asset://2)',
      '![missing](syncnos-asset://3)',
      '![malformed](syncnos-asset://nope)',
      '![remote](https://example.com/remote.png)',
      '![data](data:image/png;base64,AQID)',
      '`![literal](syncnos-asset://8)`',
    ].join('\n');
    const markdownB = '![one](syncnos-asset://1)\n![two-again](syncnos-asset://2)';
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 5,
      messages: [
        message('m-a', { contentMarkdown: markdownA, contentText: 'text A' }),
        message('m-b', { contentMarkdown: markdownB, contentText: 'text B' }),
      ],
    });
    mocks.getImageCacheAssetsByIds.mockImplementation(async ({ ids, conversationId }: any) => {
      expect(ids).toEqual([2, 3, 1]);
      expect(conversationId).toBe(5);
      return new Map([
        [2, asset(2, 5, 'IMAGE/WEBP; charset=utf-8', [2, 2])],
        [1, asset(1, 5, '', [1, 1, 1])],
      ]);
    });

    const result = await buildConversationsJsonZipExport({ conversations: [c] });
    const entries = await extractZipEntries(result.zipBlob);
    const [jsonEntry] = await readJsonEntries(result.zipBlob);
    const [first, second] = jsonEntry.value.messages;

    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(jsonEntry.value.attachments).toEqual([
      { path: expect.stringMatching(/-0001\.png$/), mediaType: 'image/webp', byteSize: 2 },
      { path: expect.stringMatching(/-0002\.png$/), mediaType: 'application/octet-stream', byteSize: 3 },
    ]);
    const [twoPath, onePath] = jsonEntry.value.attachments.map((attachment: any) => attachment.path);
    expect(entries.has(twoPath)).toBe(true);
    expect(entries.has(onePath)).toBe(true);
    expect(first.content).toMatchObject({ format: 'markdown' });
    expect(first.content.value).toContain(`![two](${twoPath})`);
    expect(first.content.value.match(/\[Image unavailable\]/g)).toHaveLength(2);
    expect(first.content.value).toContain('![remote](https://example.com/remote.png)');
    expect(first.content.value).toContain('![data](data:image/png;base64,AQID)');
    expect(first.content.value).toContain('`![literal](syncnos-asset://8)`');
    expect(second.content).toMatchObject({ format: 'markdown' });
    expect(second.content.value).toContain(`![one](${onePath})`);
    expect(second.content.value).toContain(`![two-again](${twoPath})`);
  });

  it('uses actual Blob metadata, falls back from malformed cache MIME to Blob MIME, then to octet-stream', async () => {
    const c = conversation(6);
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 6,
      messages: [message('m', { contentMarkdown: '![x](syncnos-asset://6)' })],
    });
    const blobFallback = asset(6, 6, 'not a mime', [1, 2, 3, 4]);
    blobFallback.blob = new Blob([Uint8Array.of(1, 2, 3, 4)], { type: 'image/jpeg' });
    mocks.getImageCacheAssetsByIds.mockResolvedValue(new Map([[6, blobFallback]]));

    let result = await buildConversationsJsonZipExport({ conversations: [c] });
    let [entry] = await readJsonEntries(result.zipBlob);
    expect(entry.value.attachments).toEqual([{ path: expect.any(String), mediaType: 'image/jpeg', byteSize: 4 }]);

    const unknown = asset(6, 6, 'not a mime', [1, 2, 3, 4]);
    unknown.blob = new Blob([Uint8Array.of(1, 2, 3, 4)], { type: '' });
    mocks.getImageCacheAssetsByIds.mockResolvedValue(new Map([[6, unknown]]));
    result = await buildConversationsJsonZipExport({ conversations: [c] });
    [entry] = await readJsonEntries(result.zipBlob);
    expect(entry.value.attachments).toEqual([
      { path: expect.any(String), mediaType: 'application/octet-stream', byteSize: 4 },
    ]);
  });

  it('normalizes invalid metadata timestamps to null without throwing', async () => {
    const invalidValues = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 9e99, '1700000000000'] as const;
    for (const [index, value] of invalidValues.entries()) {
      const c = conversation(100 + index, {
        lastCapturedAt: value,
        title: index === 0 ? 42 : 'Title',
        url: index === 0 ? {} : 'https://example.com',
        warningFlags: index === 0 ? [1, {}, ' ok '] : [],
      });
      mocks.getConversationDetail.mockResolvedValue({
        conversationId: c.id,
        messages: [message(`m-${index}`, { contentMarkdown: 'body' })],
      });
      const result = await buildConversationsJsonZipExport({ conversations: [c] });
      const [entry] = await readJsonEntries(result.zipBlob);
      expect(entry.value.capturedAt).toBeNull();
      if (index === 0) {
        expect(entry.value.title).toBeNull();
        expect(entry.value.url).toBeNull();
        expect(entry.value.warnings).toEqual(['ok']);
      }
    }
  });

  it('fails malformed saved content instead of silently serializing it as null', async () => {
    const cases = [
      {
        conversation: conversation(1),
        detail: { conversationId: 1, messages: [message('m', { contentText: { malformed: true } })] },
        error: 'Invalid contentText',
      },
      {
        conversation: conversation(2, {
          source: 'web',
          sourceType: 'article',
          conversationKey: 'article:malformed-content',
        }),
        detail: {
          conversationId: 2,
          messages: [message('article_body', { contentMarkdown: 42, contentText: 'valid text' })],
        },
        error: 'Invalid contentMarkdown',
      },
      {
        conversation: conversation(3, {
          source: 'video',
          sourceType: 'video',
          conversationKey: 'video:malformed-content',
        }),
        detail: {
          conversationId: 3,
          messages: [message('video_transcript', { contentMarkdown: 'valid markdown', contentText: ['bad'] })],
        },
        error: 'Invalid contentText',
      },
    ];

    for (const item of cases) {
      mocks.getConversationDetail.mockResolvedValueOnce(item.detail);
      await expect(buildConversationsJsonZipExport({ conversations: [item.conversation] })).rejects.toThrow(item.error);
    }
  });

  it('fails malformed identities, ids, message keys, and mismatched details instead of silently dropping items', async () => {
    mocks.getConversationDetail.mockResolvedValue({ conversationId: 1, messages: [message('m')] });
    await expect(buildConversationsJsonZipExport({ conversations: [conversation(1, { source: 7 })] })).rejects.toThrow(
      'Invalid source',
    );
    await expect(
      buildConversationsJsonZipExport({ conversations: [conversation(1, { conversationKey: '   ' })] }),
    ).rejects.toThrow('Invalid conversationKey');
    await expect(
      buildConversationsJsonZipExport({ conversations: [{ ...conversation(1), id: '1' } as any] }),
    ).rejects.toThrow('Invalid conversation id');

    mocks.getConversationDetail.mockResolvedValue({ conversationId: 1, messages: [message({ malformed: true })] });
    await expect(buildConversationsJsonZipExport({ conversations: [conversation(1)] })).rejects.toThrow(
      'Invalid messageKey',
    );

    mocks.getConversationDetail.mockResolvedValue({ conversationId: 99, messages: [] });
    await expect(buildConversationsJsonZipExport({ conversations: [conversation(1)] })).rejects.toThrow(
      'conversation detail returned a mismatched id',
    );
  });

  it('keeps one item per JSON file through a real three-way basename collision', async () => {
    const items = [7, 8, 9].map((id) =>
      conversation(id, {
        source: 'web',
        sourceType: 'article',
        conversationKey: 'article:same',
        title: 'Same',
        url: 'https://example.com/same',
      }),
    );
    const base = buildConversationBasename(items[0]);
    mocks.getConversationDetail.mockImplementation(async (id: number) => ({
      conversationId: id,
      messages: [message('article_body', { contentMarkdown: `body-${id}`, contentText: `text-${id}` })],
    }));

    const result = await buildConversationsJsonZipExport({ conversations: items });
    const entries = await extractZipEntries(result.zipBlob);
    const jsonNames = [...entries.keys()].filter((name) => name.endsWith('.json')).sort();

    expect(jsonNames).toEqual([`${base}.json`, `${base}-2.json`, `${base}-3.json`].sort());
    expect(await readJsonEntries(result.zipBlob)).toHaveLength(3);
  });
});
