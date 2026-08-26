import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { sha256Hex } from '@services/sync/github/github-content-hash';
import { buildGithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';

const originalTz = process.env.TZ;
const folders = { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' };

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    sourceType: 'chat',
    source: 'chatgpt',
    conversationKey: 'chat-key',
    title: 'Chat title',
    url: 'https://example.com/chat',
    ...overrides,
  };
}

function imageAsset(id: number, bytes: number[], url = 'https://cdn.example.com/image.png', contentType = 'image/png') {
  return {
    id,
    conversationId: 7,
    url,
    blob: new Blob([new Uint8Array(bytes)], { type: contentType }),
    byteSize: bytes.length,
    contentType,
  };
}

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
    const current = conversation({
      sourceType,
      source: sourceType === 'video' ? 'youtube' : 'chatgpt',
      conversationKey: `${sourceType}-key`,
      title: `${sourceType} title`,
      url: `https://example.com/${sourceType}`,
    });
    const projection = await buildGithubMarkdownProjection({
      conversation: current,
      messages: [
        {
          messageKey: sourceType === 'article' ? 'article_body' : 'm1',
          sequence: 1,
          role: 'assistant',
          contentMarkdown: 'body',
        },
      ],
      folders,
    });
    expect(projection.markdownPath).toBe(`${expectedFolder}/${buildConversationBasename(current)}.md`);
    expect(projection.markdownText).toContain(`url: "https://example.com/${sourceType}"`);
    expect(projection.markdownText).toContain('syncnos:');
    expect(projection.markdownText).toContain('body');
    expect(projection.markdownText).not.toContain('lastSyncedAt');
    expect(projection.markdownContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(projection.projectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renders article comments in UTC and remains byte-stable across local timezone changes', async () => {
    const current = conversation({
      id: 9,
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-key',
      title: 'Article',
      url: 'https://example.com/article',
    });
    const input = {
      conversation: current,
      messages: [{ messageKey: 'article_body', sequence: 1, contentMarkdown: 'Article body' }],
      comments: [
        {
          id: 1,
          parentId: null,
          conversationId: 9,
          canonicalUrl: current.url,
          quoteText: 'Quote',
          commentText: 'Comment',
          createdAt: Date.UTC(2026, 0, 2, 3, 4),
          updatedAt: Date.UTC(2026, 0, 2, 3, 4),
        },
      ],
      folders,
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

  it('materializes content-addressed attachments and reuses same bytes within one projection', async () => {
    const loader = vi.fn(async ({ id }: { id: number; conversationId: number }) =>
      id === 1 ? imageAsset(1, [1, 2, 3]) : imageAsset(2, [1, 2, 3]),
    );
    const uploader = vi.fn(async () => ({ sha: 'a'.repeat(40) }));
    const current = conversation();
    const projection = await buildGithubMarkdownProjection({
      conversation: current,
      messages: [
        {
          messageKey: 'm1',
          sequence: 1,
          contentMarkdown: '![one](syncnos-asset://1)\n\n![two](<syncnos-asset://2> "caption")',
        },
      ],
      folders,
      remoteKey: 'github.com/owner/repo@main',
      imageLoader: loader,
      blobUploader: uploader,
    });

    const hash = await sha256Hex(new Uint8Array([1, 2, 3]));
    const relative = `${buildConversationBasename(current)}.assets/${hash}.png`;
    expect(projection.attachments).toEqual([
      {
        path: `Chats/${relative}`,
        relativeTarget: relative,
        contentHash: hash,
        sha: 'a'.repeat(40),
      },
    ]);
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(projection.markdownText).toContain(`![one](${relative})`);
    expect(projection.markdownText).toContain(`![two](<${relative}> "caption")`);
    expect(projection.markdownText).not.toContain('syncnos-asset://');
  });

  it('reuses a known blob SHA for unchanged content and for a renamed conversation scope', async () => {
    const bytes = [9, 8, 7];
    const contentHash = await sha256Hex(new Uint8Array(bytes));
    const oldConversation = conversation({ title: 'Old title' });
    const oldRelative = `${buildConversationBasename(oldConversation)}.assets/${contentHash}.png`;
    const oldPath = `Chats/${oldRelative}`;
    const continuity = {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        [oldPath]: { kind: 'asset' as const, contentHash, sha: 'b'.repeat(40) },
      },
    };
    const uploader = vi.fn(async () => ({ sha: 'c'.repeat(40) }));
    const loader = vi.fn(async () => imageAsset(1, bytes));

    const unchanged = await buildGithubMarkdownProjection({
      conversation: oldConversation,
      messages: [{ messageKey: 'm1', sequence: 1, contentMarkdown: '![x](syncnos-asset://1)' }],
      folders,
      remoteKey: 'github.com/owner/repo@main',
      continuity,
      imageLoader: loader,
      blobUploader: uploader,
    });
    const renamed = await buildGithubMarkdownProjection({
      conversation: { ...oldConversation, title: 'New title' },
      messages: [{ messageKey: 'm1', sequence: 1, contentMarkdown: '![x](syncnos-asset://1)' }],
      folders: { ...folders, chatFolder: 'Renamed' },
      remoteKey: 'github.com/owner/repo@main',
      continuity,
      imageLoader: loader,
      blobUploader: uploader,
    });

    expect(uploader).not.toHaveBeenCalled();
    expect(unchanged.attachments[0]?.sha).toBe('b'.repeat(40));
    expect(renamed.attachments[0]?.sha).toBe('b'.repeat(40));
    expect(renamed.attachments[0]?.path).not.toBe(oldPath);
    expect(renamed.projectionFingerprint).not.toBe(unchanged.projectionFingerprint);
  });

  it('does not reuse continuity from a different remote target', async () => {
    const bytes = [9, 8, 7];
    const contentHash = await sha256Hex(new Uint8Array(bytes));
    const current = conversation({ title: 'Old title' });
    const relative = `${buildConversationBasename(current)}.assets/${contentHash}.png`;
    const path = `Chats/${relative}`;
    const uploader = vi.fn(async () => ({ sha: 'c'.repeat(40) }));

    const projection = await buildGithubMarkdownProjection({
      conversation: current,
      messages: [{ messageKey: 'm1', sequence: 1, contentMarkdown: '![x](syncnos-asset://1)' }],
      folders,
      remoteKey: 'github.com/owner/other@main',
      continuity: {
        githubRemoteKey: 'github.com/owner/repo@main',
        githubManagedFiles: {
          [path]: { kind: 'asset', contentHash, sha: 'b'.repeat(40) },
        },
      },
      imageLoader: async () => imageAsset(1, bytes),
      blobUploader: uploader,
    });

    expect(uploader).toHaveBeenCalledTimes(1);
    expect(projection.attachments[0]?.sha).toBe('c'.repeat(40));
  });

  it('keeps unchanged attachment paths stable when other images are inserted or reordered', async () => {
    const assets = new Map([
      [1, imageAsset(1, [1])],
      [2, imageAsset(2, [2])],
      [3, imageAsset(3, [3])],
    ]);
    const loader = async ({ id }: { id: number; conversationId: number }) => assets.get(id) || null;
    const uploader = async ({ content }: { content: Uint8Array }) => ({
      sha: content[0]!.toString(16).repeat(40).slice(0, 40),
    });
    const current = conversation();
    const first = await buildGithubMarkdownProjection({
      conversation: current,
      messages: [
        { messageKey: 'm1', sequence: 1, contentMarkdown: '![a](syncnos-asset://1)\n![b](syncnos-asset://2)' },
      ],
      folders,
      imageLoader: loader,
      blobUploader: uploader,
    });
    const reordered = await buildGithubMarkdownProjection({
      conversation: current,
      messages: [
        {
          messageKey: 'm1',
          sequence: 1,
          contentMarkdown: '![new](syncnos-asset://3)\n![b](syncnos-asset://2)\n![a](syncnos-asset://1)',
        },
      ],
      folders,
      imageLoader: loader,
      blobUploader: uploader,
    });

    const pathsByHash = (projection: typeof first) =>
      new Map(projection.attachments.map((item) => [item.contentHash, item.path]));
    const firstPaths = pathsByHash(first);
    const reorderedPaths = pathsByHash(reordered);
    for (const item of first.attachments)
      expect(reorderedPaths.get(item.contentHash)).toBe(firstPaths.get(item.contentHash));
  });

  it('treats missing and cross-conversation assets as placeholders without uploading', async () => {
    const loader = vi.fn(async ({ conversationId }: { id: number; conversationId: number }) =>
      conversationId === 999 ? imageAsset(4, [4]) : null,
    );
    const uploader = vi.fn(async () => ({ sha: 'a'.repeat(40) }));
    const projection = await buildGithubMarkdownProjection({
      conversation: conversation({ id: 7 }),
      messages: [{ messageKey: 'm1', sequence: 1, contentMarkdown: 'before ![secret](syncnos-asset://4) after' }],
      folders,
      imageLoader: loader,
      blobUploader: uploader,
    });

    expect(loader).toHaveBeenCalledWith({ id: 4, conversationId: 7 });
    expect(uploader).not.toHaveBeenCalled();
    expect(projection.markdownText).toContain('before [Image unavailable] after');
    expect(projection.markdownText).not.toContain('syncnos-asset://');
    expect(projection.warnings).toEqual([{ code: 'image_missing', assetId: 4 }]);
  });

  it('falls back only to public URL shapes when blob upload fails and never leaks signed/credential URLs', async () => {
    const assets = new Map([
      [1, imageAsset(1, [1], 'https://cdn.example.com/safe.png')],
      [2, imageAsset(2, [2], 'https://cdn.example.com/signed.png?token=SECRET#frag')],
      [3, imageAsset(3, [3], 'https://user:pass@cdn.example.com/credential.png')],
    ]);
    const loader = async ({ id }: { id: number; conversationId: number }) => assets.get(id) || null;
    const uploader = vi.fn(async () => {
      throw new Error('upload failed with remote details');
    });
    const projection = await buildGithubMarkdownProjection({
      conversation: conversation(),
      messages: [
        {
          messageKey: 'm1',
          sequence: 1,
          contentMarkdown: '![safe](syncnos-asset://1)\n![signed](syncnos-asset://2)\n![credential](syncnos-asset://3)',
        },
      ],
      folders,
      imageLoader: loader,
      blobUploader: uploader,
    });

    expect(projection.markdownText).toContain('![safe](https://cdn.example.com/safe.png)');
    expect(projection.markdownText.match(/\[Image unavailable\]/g)).toHaveLength(2);
    expect(projection.markdownText).not.toMatch(/SECRET|user:pass|syncnos-asset:\/\//i);
    expect(projection.attachments).toEqual([]);
    expect(projection.warnings).toHaveLength(3);
  });

  it('treats outcome-unknown blob uploads as degraded images without guessing success', async () => {
    const projection = await buildGithubMarkdownProjection({
      conversation: conversation(),
      messages: [{ messageKey: 'm1', sequence: 1, contentMarkdown: '![x](syncnos-asset://1)' }],
      folders,
      imageLoader: async () => imageAsset(1, [1], 'https://cdn.example.com/safe.png'),
      blobUploader: async () => {
        throw Object.assign(new Error('ambiguous mutation outcome'), { code: 'github_outcome_unknown' });
      },
    });

    expect(projection.attachments).toEqual([]);
    expect(projection.markdownText).toContain('![x](https://cdn.example.com/safe.png)');
    expect(projection.warnings).toEqual([{ code: 'image_upload_failed', assetId: 1 }]);
  });

  it('fails closed when an internal asset URI remains outside supported Markdown image syntax', async () => {
    await expect(
      buildGithubMarkdownProjection({
        conversation: conversation(),
        messages: [{ messageKey: 'm1', sequence: 1, contentMarkdown: 'raw syncnos-asset://99' }],
        folders,
      }),
    ).rejects.toThrow('github_internal_asset_ref_unresolved');
  });
});
