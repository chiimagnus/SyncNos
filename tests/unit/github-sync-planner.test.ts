import { describe, expect, it } from 'vitest';

import { buildConversationBasename, stableConversationId10 } from '@services/conversations/domain/file-naming';
import type { GithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';
import { planGithubConversationSync } from '@services/sync/github/github-sync-planner';

const remoteKey = 'github.com/owner/repo@main';
const convo = { id: 7, source: 'chatgpt', sourceType: 'chat', conversationKey: 'key', title: 'Title' };
const markdownHash = '1'.repeat(64);
const assetHash = '2'.repeat(64);
const markdownSha = 'a'.repeat(40);
const assetSha = 'b'.repeat(40);

function projection(overrides: Partial<GithubMarkdownProjection> = {}): GithubMarkdownProjection {
  const basename = buildConversationBasename(convo);
  return {
    markdownPath: `Chats/${basename}.md`,
    markdownText: '# body\n',
    markdownContentHash: markdownHash,
    attachments: [
      {
        path: `Chats/${basename}.assets/${assetHash}.png`,
        relativeTarget: `${basename}.assets/${assetHash}.png`,
        contentHash: assetHash,
        sha: assetSha,
      },
    ],
    projectionFingerprint: 'f'.repeat(64),
    warnings: [],
    ...overrides,
  };
}

function managed(p = projection()) {
  return {
    [p.markdownPath]: { kind: 'markdown' as const, contentHash: p.markdownContentHash, sha: markdownSha },
    [p.attachments[0]!.path]: { kind: 'asset' as const, contentHash: assetHash, sha: assetSha },
  };
}

describe('github sync planner', () => {
  it('returns an incremental local no-op only when fingerprint and managed paths/hashes match', () => {
    const p = projection();
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey,
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubProjectionFingerprint: p.projectionFingerprint,
        githubManagedFiles: managed(p),
      },
      mode: 'incremental',
    });

    expect(plan.status).toBe('no_changes');
    expect(plan.operations).toEqual([]);
    expect(plan.nextContinuity.githubManagedFiles[p.markdownPath]?.sha).toBe(markdownSha);
  });

  it('reconcile redeclares unchanged authoritative paths with known SHAs', () => {
    const p = projection();
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey,
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubProjectionFingerprint: p.projectionFingerprint,
        githubManagedFiles: managed(p),
      },
      mode: 'reconcile',
    });

    expect(plan.operations).toEqual([
      { type: 'reuse', path: p.markdownPath, sha: markdownSha },
      { type: 'reuse', path: p.attachments[0]!.path, sha: assetSha },
    ]);
  });

  it('writes all current paths to a new target and never deletes old-target paths', () => {
    const p = projection();
    const oldPath = `Old/chatgpt-Old-${stableConversationId10(convo)}.md`;
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey: 'github.com/owner/other@main',
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubProjectionFingerprint: p.projectionFingerprint,
        githubManagedFiles: { [oldPath]: { kind: 'markdown', contentHash: markdownHash, sha: markdownSha } },
      },
      mode: 'incremental',
    });

    expect(plan.operations).toContainEqual({ type: 'write', path: p.markdownPath, content: p.markdownText });
    expect(plan.operations).toContainEqual({ type: 'reuse', path: p.attachments[0]!.path, sha: assetSha });
    expect(plan.operations.some((operation) => operation.type === 'delete')).toBe(false);
  });

  it('reuses the old markdown blob when a same-target title/path rename keeps content unchanged', () => {
    const p = projection();
    const oldPath = `Old/chatgpt-Old-${stableConversationId10(convo)}.md`;
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey,
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubManagedFiles: {
          [oldPath]: { kind: 'markdown', contentHash: markdownHash, sha: markdownSha },
        },
      },
      mode: 'incremental',
    });

    expect(plan.operations).toContainEqual({ type: 'reuse', path: p.markdownPath, sha: markdownSha });
    expect(plan.operations).toContainEqual({ type: 'delete', path: oldPath });
  });

  it('deletes stale same-identity attachments only on the same target', () => {
    const p = projection({ attachments: [] });
    const basename = buildConversationBasename(convo);
    const oldAsset = `Chats/${basename}.assets/${assetHash}.png`;
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey,
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubManagedFiles: {
          [p.markdownPath]: { kind: 'markdown', contentHash: markdownHash, sha: markdownSha },
          [oldAsset]: { kind: 'asset', contentHash: assetHash, sha: assetSha },
        },
      },
      mode: 'incremental',
    });

    expect(plan.operations).toContainEqual({ type: 'delete', path: oldAsset });
  });

  it.each([
    ['README.md', 'markdown'],
    [`Chats/chatgpt-Other-${'9'.repeat(10)}.md`, 'markdown'],
    [`Chats/not-owned.assets/${assetHash}.png`, 'asset'],
    [`Chats/${buildConversationBasename(convo)}.assets/not-a-hash.png`, 'asset'],
    ['.github/workflows/sync.yml', 'markdown'],
  ] as const)('does not derive delete authority from corrupt managed metadata: %s', (path, kind) => {
    const p = projection({ attachments: [] });
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey,
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubManagedFiles: {
          [p.markdownPath]: { kind: 'markdown', contentHash: markdownHash, sha: markdownSha },
          [path]: { kind, contentHash: assetHash, sha: assetSha },
        },
      },
      mode: 'incremental',
    });

    expect(plan.operations).not.toContainEqual({ type: 'delete', path });
  });

  it('does not trust matching fingerprint when managed file hashes drift', () => {
    const p = projection();
    const previous = managed(p);
    previous[p.markdownPath] = { ...previous[p.markdownPath]!, contentHash: '3'.repeat(64) };
    const plan = planGithubConversationSync({
      conversation: convo,
      remoteKey,
      projection: p,
      mapping: {
        githubRemoteKey: remoteKey,
        githubProjectionFingerprint: p.projectionFingerprint,
        githubManagedFiles: previous,
      },
      mode: 'incremental',
    });

    expect(plan.status).toBe('changed');
    expect(plan.operations).toContainEqual({ type: 'write', path: p.markdownPath, content: p.markdownText });
  });
});
