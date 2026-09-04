import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConversationDetail: vi.fn(),
  getImageCacheAssetsByIds: vi.fn(),
  createZipBlob: vi.fn(),
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationDetail: (...args: any[]) => mocks.getConversationDetail(...args),
}));

vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetsByIds: (...args: any[]) => mocks.getImageCacheAssetsByIds(...args),
}));

vi.mock('@services/sync/backup/zip-utils', () => ({
  createZipBlob: (...args: any[]) => mocks.createZipBlob(...args),
}));

vi.mock('@services/shared/file-timestamp', () => ({
  buildLocalTimestampForFilename: () => '20260905-010203',
}));

import { buildConversationsMarkdownZipExport } from '@services/sync/local/markdown-export';

function conversation(id: number, title: string) {
  return {
    id,
    source: 'web',
    sourceType: 'article',
    conversationKey: `article:https://example.com/${id}`,
    title,
    url: `https://example.com/${id}`,
  } as any;
}

function asset(id: number, conversationId: number, contentType = 'image/png') {
  return {
    id,
    conversationId,
    url: `https://cdn.example.com/${id}.png`,
    blob: new Blob([Uint8Array.of(id)], { type: contentType }),
    byteSize: 1,
    contentType,
  } as any;
}

function capturedFiles(): Array<{ name: string; data: string | Blob }> {
  return mocks.createZipBlob.mock.calls.at(-1)?.[0] || [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createZipBlob.mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }));
});

describe('local markdown export', () => {
  it('uses one scoped batch read and safely degrades unavailable internal images', async () => {
    const c = conversation(1, 'One');
    const source = [
      '![own](<syncnos-asset://11> "title")',
      '![missing](syncnos-asset://12)',
      '![malformed](syncnos-asset://nope)',
      '![remote](https://example.com/remote.png)',
      '`![inline](syncnos-asset://13)`',
      '```md',
      '![fenced](syncnos-asset://14)',
      '```',
      '    ![indented](syncnos-asset://15)',
    ].join('\n\n');
    mocks.getConversationDetail.mockResolvedValue({
      conversationId: 1,
      messages: [{ messageKey: 'article_body', role: 'assistant', contentMarkdown: source }],
    });
    mocks.getImageCacheAssetsByIds.mockResolvedValue(new Map([[11, asset(11, 1, 'image/webp')]]));

    const result = await buildConversationsMarkdownZipExport({ conversations: [c], mergeSingle: false });
    const files = capturedFiles();
    const markdownFile = files.find((file) => file.name.endsWith('.md'))!;
    const attachment = files.find((file) => file.name.startsWith('attachments/'))!;
    const markdown = String(markdownFile.data);

    expect(result.filename).toBe('SyncNos-md-20260905-010203.zip');
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [11, 12], conversationId: 1 });
    expect(attachment.name).toMatch(/^attachments\/.+-0001\.webp$/);
    expect(markdown).toContain(`![own](<${attachment.name}> "title")`);
    expect(markdown.match(/\[Image unavailable\]/g)?.length).toBe(2);
    expect(markdown).toContain('![remote](https://example.com/remote.png)');
    expect(markdown).toContain('`![inline](syncnos-asset://13)`');
    expect(markdown).toContain('![fenced](syncnos-asset://14)');
    expect(markdown).toContain('    ![indented](syncnos-asset://15)');
    expect(markdown).not.toContain('![missing](syncnos-asset://12)');
    expect(markdown).not.toContain('![malformed](syncnos-asset://nope)');
  });

  it('keeps ownership per conversation and uses deterministic unique attachment names', async () => {
    const conversations = [conversation(1, 'One'), conversation(2, 'Two')];
    const setup = () => {
      mocks.getConversationDetail.mockImplementation(async (id: number) => ({
        conversationId: id,
        messages: [
          {
            messageKey: 'article_body',
            role: 'assistant',
            contentMarkdown:
              id === 1
                ? '![own](syncnos-asset://11)\n\n![cross](syncnos-asset://22)'
                : '![own](syncnos-asset://22)',
          },
        ],
      }));
      mocks.getImageCacheAssetsByIds.mockImplementation(async ({ conversationId }: any) => {
        if (conversationId === 1) return new Map([[11, asset(11, 1)]]);
        if (conversationId === 2) return new Map([[22, asset(22, 2, 'image/jpeg')]]);
        return new Map();
      });
    };
    setup();

    await buildConversationsMarkdownZipExport({ conversations, mergeSingle: false });
    const firstFiles = capturedFiles();
    const firstAttachmentNames = firstFiles.filter((file) => file.name.startsWith('attachments/')).map((file) => file.name);
    expect(mocks.getImageCacheAssetsByIds.mock.calls).toEqual([
      [{ ids: [11, 22], conversationId: 1 }],
      [{ ids: [22], conversationId: 2 }],
    ]);
    expect(firstAttachmentNames).toHaveLength(2);
    expect(new Set(firstAttachmentNames).size).toBe(2);
    expect(firstAttachmentNames[0]).toMatch(/-0001\.png$/);
    expect(firstAttachmentNames[1]).toMatch(/-0002\.jpg$/);
    const firstDoc = firstFiles.find((file) => file.name.endsWith('.md') && String(file.data).includes('# One'))!;
    const secondDoc = firstFiles.find((file) => file.name.endsWith('.md') && String(file.data).includes('# Two'))!;
    expect(String(firstDoc.data)).toContain(firstAttachmentNames[0]!);
    expect(String(firstDoc.data)).toContain('[Image unavailable]');
    expect(String(firstDoc.data)).not.toContain(firstAttachmentNames[1]!);
    expect(String(secondDoc.data)).toContain(firstAttachmentNames[1]!);

    vi.clearAllMocks();
    mocks.createZipBlob.mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }));
    setup();
    await buildConversationsMarkdownZipExport({ conversations, mergeSingle: false });
    expect(capturedFiles().filter((file) => file.name.startsWith('attachments/')).map((file) => file.name)).toEqual(
      firstAttachmentNames,
    );
  });

  it('materializes each conversation before merged export instead of dropping conversation scope', async () => {
    const conversations = [conversation(1, 'One'), conversation(2, 'Two')];
    mocks.getConversationDetail.mockImplementation(async (id: number) => ({
      conversationId: id,
      messages: [
        {
          messageKey: 'article_body',
          role: 'assistant',
          contentMarkdown: `![own](syncnos-asset://${id === 1 ? 11 : 22})`,
        },
      ],
    }));
    mocks.getImageCacheAssetsByIds.mockImplementation(async ({ conversationId }: any) =>
      conversationId === 1 ? new Map([[11, asset(11, 1)]]) : new Map([[22, asset(22, 2)]]),
    );

    await buildConversationsMarkdownZipExport({ conversations, mergeSingle: true });
    const files = capturedFiles();
    const markdownFiles = files.filter((file) => file.name.endsWith('.md'));
    const attachments = files.filter((file) => file.name.startsWith('attachments/'));

    expect(markdownFiles).toHaveLength(1);
    expect(attachments).toHaveLength(2);
    expect(mocks.getImageCacheAssetsByIds.mock.calls).toEqual([
      [{ ids: [11], conversationId: 1 }],
      [{ ids: [22], conversationId: 2 }],
    ]);
    const merged = String(markdownFiles[0]!.data);
    expect(merged).toContain('# One');
    expect(merged).toContain('# Two');
    expect(merged).toContain(attachments[0]!.name);
    expect(merged).toContain(attachments[1]!.name);
  });
});
