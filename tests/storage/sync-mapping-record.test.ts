import { describe, expect, it } from 'vitest';

import {
  areSyncMappingsBusinessEquivalent,
  mergeSyncMappingForIdentityMove,
  mergeSyncMappingForImport,
  mergeSyncMappingPatch,
  readGithubContinuity,
  stripSyncMappingLocalId,
} from '@platform/idb/sync-mapping-record';

function notionState(input: {
  pageId: string;
  syncedAt?: number;
  key: string;
  sequence: number;
  heading: string;
  digest: string;
}) {
  return {
    notionPageId: input.pageId,
    notionPageUrl: `https://notion.so/${input.pageId}`,
    notionWorkspaceSlug: `ws-${input.pageId}`,
    lastSyncedMessageKey: input.key,
    lastSyncedSequence: input.sequence,
    ...(input.syncedAt == null ? {} : { lastSyncedAt: input.syncedAt }),
    lastSyncedMessageUpdatedAt: input.sequence * 10,
    notionSections: { conversations: { headingBlockId: input.heading } },
    notionSectionCursors: {
      conversations: {
        lastSyncedMessageKey: input.key,
        lastSyncedSequence: input.sequence,
        lastSyncedMessageUpdatedAt: input.sequence * 10,
      },
    },
    notionSectionDigests: { article: { digest: input.digest, lastSyncedAt: input.syncedAt ?? 0 } },
  };
}

function githubState(input: {
  remoteKey?: string;
  path?: string;
  syncedAt?: number;
  marker?: 'a' | 'b' | 'c' | 'd';
  kind?: 'markdown' | 'asset';
}) {
  const marker = input.marker || 'a';
  const path = input.path || 'SyncNos-AIChats/chat.md';
  return {
    githubRemoteKey: input.remoteKey || 'github.com/example/syncnos@main',
    githubManagedFiles: {
      [path]: {
        sha: marker.repeat(40),
        contentHash: marker.repeat(64),
        kind: input.kind || 'markdown',
      },
    },
    githubProjectionFingerprint: marker.repeat(64),
    ...(input.syncedAt == null ? {} : { githubLastSyncedAt: input.syncedAt }),
  };
}

describe('sync mapping persistence record', () => {
  it('compares business state independently of local id, audit updatedAt, and object key order', () => {
    const left = {
      id: 1,
      updatedAt: 10,
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      lastSyncedAt: 20,
      unknownMetadata: {
        z: true,
        nested: { b: 2, a: 1 },
        ordered: ['first', { value: 2 }],
      },
      ...githubState({ syncedAt: 30, marker: 'a' }),
      githubManagedFiles: {
        'SyncNos-AIChats/chat.md': {
          sha: 'A'.repeat(40),
          contentHash: 'a'.repeat(64),
          kind: 'markdown',
        },
      },
    };
    const right = {
      id: 999,
      updatedAt: 999,
      conversationKey: 'article:https://example.com/post',
      source: 'web',
      unknownMetadata: {
        ordered: ['first', { value: 2 }],
        nested: { a: 1, b: 2 },
        z: true,
      },
      lastSyncedAt: 20,
      ...githubState({ syncedAt: 30, marker: 'a' }),
    };

    expect(areSyncMappingsBusinessEquivalent(left, right)).toBe(true);
    expect(
      areSyncMappingsBusinessEquivalent(left, {
        ...right,
        unknownMetadata: { ...right.unknownMetadata, ordered: [{ value: 2 }, 'first'] },
      }),
    ).toBe(false);
    expect(areSyncMappingsBusinessEquivalent(left, { ...right, lastSyncedAt: 21 })).toBe(false);
    expect(areSyncMappingsBusinessEquivalent(left, { ...right, githubLastSyncedAt: 31 })).toBe(false);
  });

  it('keeps unknown future provider fields in business equivalence', () => {
    const base = {
      source: 'chatgpt',
      conversationKey: 'c1',
      obsidianGeneration: { note: 4, assets: ['a', 'b'] },
      feishuLastSyncedAt: 50,
    };

    expect(areSyncMappingsBusinessEquivalent(base, structuredClone(base))).toBe(true);
    expect(
      areSyncMappingsBusinessEquivalent(base, {
        ...base,
        obsidianGeneration: { note: 5, assets: ['a', 'b'] },
      }),
    ).toBe(false);
    expect(areSyncMappingsBusinessEquivalent(base, { ...base, feishuLastSyncedAt: 51 })).toBe(false);
  });

  it('normalizes Obsidian remote-write generation and keeps the valid max across identity/import merges', () => {
    const base = {
      source: 'chatgpt',
      conversationKey: 'c-generation',
      obsidianRemoteWriteGeneration: 4,
      customMetadata: 'keep',
    };

    expect(mergeSyncMappingPatch(base, {}).obsidianRemoteWriteGeneration).toBe(4);
    expect(mergeSyncMappingPatch(base, { obsidianRemoteWriteGeneration: 5 }).obsidianRemoteWriteGeneration).toBe(5);
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '6']) {
      const merged = mergeSyncMappingPatch(base, { obsidianRemoteWriteGeneration: invalid });
      expect(merged.obsidianRemoteWriteGeneration).toBeUndefined();
      expect(areSyncMappingsBusinessEquivalent(merged, { source: 'chatgpt', conversationKey: 'c-generation', customMetadata: 'keep' })).toBe(true);
    }

    const moved = mergeSyncMappingForIdentityMove(
      { id: 2, source: 'chatgpt', conversationKey: 'target', obsidianRemoteWriteGeneration: 3 },
      { id: 1, source: 'chatgpt', conversationKey: 'legacy', obsidianRemoteWriteGeneration: 7 },
      { source: 'chatgpt', conversationKey: 'target' },
    );
    expect(moved.obsidianRemoteWriteGeneration).toBe(7);

    const imported = mergeSyncMappingForImport(
      { source: 'chatgpt', conversationKey: 'target', obsidianRemoteWriteGeneration: 9 },
      { source: 'chatgpt', conversationKey: 'target', obsidianRemoteWriteGeneration: 11 },
    );
    expect(imported.obsidianRemoteWriteGeneration).toBe(11);
  });

  it('merges only explicitly provided valid Notion nested sections', () => {
    const existing = {
      id: 7,
      notionSections: {
        conversations: { headingBlockId: 'h-old', stable: true },
        comments: { headingBlockId: 'h-comments' },
      },
      notionSectionCursors: {
        conversations: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 },
      },
      notionSectionDigests: {
        article: { digest: 'old', lastSyncedAt: 1 },
      },
    };
    const patch = {
      id: 999,
      notionSections: {
        conversations: { headingBlockId: 'h-new' },
      },
      notionSectionCursors: {
        conversations: { lastSyncedSequence: 2 },
        invalid: null,
      },
    };

    const merged = mergeSyncMappingPatch(existing, patch);

    expect(merged.id).toBe(7);
    expect(merged.notionSections).toEqual({
      conversations: { headingBlockId: 'h-new', stable: true },
      comments: { headingBlockId: 'h-comments' },
    });
    expect(merged.notionSectionCursors).toEqual({
      conversations: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 2 },
    });
    expect(merged.notionSectionDigests).toEqual(existing.notionSectionDigests);
  });

  it('keeps Notion continuity when notionPageId stays the same', () => {
    const existing = {
      id: 7,
      ...notionState({ pageId: 'page-1', syncedAt: 50, key: 'm5', sequence: 5, heading: 'h-old', digest: 'd-old' }),
    };

    const merged = mergeSyncMappingPatch(existing, {
      notionPageId: 'page-1',
      notionPageUrl: 'https://notion.so/page-1-updated',
      notionSections: { conversations: { headingBlockId: 'h-new' } },
    });

    expect(merged).toMatchObject({
      id: 7,
      notionPageId: 'page-1',
      notionPageUrl: 'https://notion.so/page-1-updated',
      lastSyncedMessageKey: 'm5',
      lastSyncedSequence: 5,
      notionSections: { conversations: { headingBlockId: 'h-new' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm5', lastSyncedSequence: 5 } },
      notionSectionDigests: { article: { digest: 'd-old', lastSyncedAt: 50 } },
    });
  });

  it('resets the whole Notion continuity group when notionPageId changes', () => {
    const existing = {
      id: 7,
      source: 'chatgpt',
      conversationKey: 'c1',
      ...notionState({ pageId: 'page-old', syncedAt: 50, key: 'm5', sequence: 5, heading: 'h-old', digest: 'd-old' }),
      feishuDocId: 'doc-1',
      unknownMetadata: 'keep-me',
    };

    const merged = mergeSyncMappingPatch(existing, {
      notionPageId: 'page-new',
      notionPageUrl: 'https://notion.so/page-new',
    });

    expect(merged).toMatchObject({
      id: 7,
      source: 'chatgpt',
      conversationKey: 'c1',
      notionPageId: 'page-new',
      notionPageUrl: 'https://notion.so/page-new',
      feishuDocId: 'doc-1',
      unknownMetadata: 'keep-me',
    });
    expect(merged.notionWorkspaceSlug).toBeUndefined();
    expect(merged.lastSyncedMessageKey).toBeUndefined();
    expect(merged.lastSyncedSequence).toBeUndefined();
    expect(merged.lastSyncedAt).toBeUndefined();
    expect(merged.lastSyncedMessageUpdatedAt).toBeUndefined();
    expect(merged.notionSections).toBeUndefined();
    expect(merged.notionSectionCursors).toBeUndefined();
    expect(merged.notionSectionDigests).toBeUndefined();
  });

  it('resets the whole Feishu continuity group when feishuDocId changes', () => {
    const existing = {
      id: 7,
      source: 'chatgpt',
      conversationKey: 'c1',
      feishuDocId: 'doc-old',
      feishuLastContentHash: 'hash-old',
      feishuLastSyncedAt: 40,
      notionPageId: 'page-1',
      unknownMetadata: 'keep-me',
    };

    const merged = mergeSyncMappingPatch(existing, { feishuDocId: 'doc-new' });

    expect(merged).toMatchObject({
      id: 7,
      source: 'chatgpt',
      conversationKey: 'c1',
      feishuDocId: 'doc-new',
      notionPageId: 'page-1',
      unknownMetadata: 'keep-me',
    });
    expect(merged.feishuLastContentHash).toBeUndefined();
    expect(merged.feishuLastSyncedAt).toBeUndefined();
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['50']])(
    'drops invalid Feishu provider freshness %p',
    (invalidFreshness) => {
      const merged = mergeSyncMappingPatch(
        { feishuDocId: 'doc-1', feishuLastContentHash: 'hash-1', feishuLastSyncedAt: 40 },
        { feishuLastSyncedAt: invalidFreshness },
      );
      expect(merged.feishuDocId).toBe('doc-1');
      expect(merged.feishuLastContentHash).toBe('hash-1');
      expect(merged.feishuLastSyncedAt).toBeUndefined();
    },
  );

  it('keeps GitHub continuity on the same remote and clears stale state when the remote changes', () => {
    const existing = {
      id: 7,
      source: 'chatgpt',
      conversationKey: 'c1',
      ...githubState({ syncedAt: 10, marker: 'a' }),
    };

    const sameRemote = mergeSyncMappingPatch(existing, {
      githubRemoteKey: 'github.com/example/syncnos@main',
      githubLastSyncedAt: 20,
    });
    expect(sameRemote.githubManagedFiles).toEqual(existing.githubManagedFiles);
    expect(sameRemote.githubProjectionFingerprint).toBe('a'.repeat(64));
    expect(sameRemote.githubLastSyncedAt).toBe(20);

    const changedRemote = mergeSyncMappingPatch(existing, {
      githubRemoteKey: 'github.com/example/other@main',
    });
    expect(changedRemote.githubRemoteKey).toBe('github.com/example/other@main');
    expect(changedRemote.githubManagedFiles).toBeUndefined();
    expect(changedRemote.githubProjectionFingerprint).toBeUndefined();
    expect(changedRemote.githubLastSyncedAt).toBeUndefined();
  });

  it('normalizes GitHub managed files fail-closed before granting reuse or delete authority', () => {
    const valid = githubState({ marker: 'a' });
    const unsafeFiles = {
      ...valid.githubManagedFiles,
      '/absolute.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      'back\\slash.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      'empty//segment.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      'dot/./segment.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      'parent/../segment.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      '.github/workflows/publish.yml': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'asset' },
      'control\u0001.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      'bad-sha.md': { sha: 'not-a-sha', contentHash: 'b'.repeat(64), kind: 'markdown' },
      'padded-sha.md': { sha: ` ${'a'.repeat(40)} `, contentHash: 'b'.repeat(64), kind: 'markdown' },
      'bad-hash.md': { sha: 'a'.repeat(40), contentHash: 'B'.repeat(64), kind: 'markdown' },
      'padded-hash.md': { sha: 'a'.repeat(40), contentHash: ` ${'b'.repeat(64)} `, kind: 'markdown' },
      'bad-kind.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'other' },
      'padded-kind.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: ' markdown ' },
    };

    const merged = mergeSyncMappingPatch(
      {},
      {
        ...valid,
        githubManagedFiles: unsafeFiles,
      },
    );

    expect(merged.githubManagedFiles).toEqual(valid.githubManagedFiles);

    const invalidRemote = mergeSyncMappingPatch(
      {},
      {
        ...valid,
        githubRemoteKey: 'github.com/example/syncnos?access_token=secret@main',
        githubProjectionFingerprint: ` ${'a'.repeat(64)} `,
        githubLastSyncedAt: '100',
      },
    );
    expect(invalidRemote.githubRemoteKey).toBeUndefined();
    expect(invalidRemote.githubManagedFiles).toBeUndefined();
    expect(invalidRemote.githubProjectionFingerprint).toBeUndefined();
    expect(invalidRemote.githubLastSyncedAt).toBeUndefined();

    const branchWithAt = mergeSyncMappingPatch(
      {},
      {
        ...valid,
        githubRemoteKey: 'github.com/example/syncnos@feature/user@topic',
      },
    );
    expect(branchWithAt.githubRemoteKey).toBe('github.com/example/syncnos@feature/user@topic');
  });

  it('exposes the normalized GitHub continuity reader without granting authority to malformed fields', () => {
    const normalized = readGithubContinuity({
      ...githubState({ marker: 'A' as any }),
      githubManagedFiles: {
        'safe/note.md': { sha: 'A'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
        '../escape.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      },
      githubProjectionFingerprint: 'c'.repeat(64),
      githubLastSyncedAt: 20,
    });
    expect(normalized).toEqual({
      githubRemoteKey: 'github.com/example/syncnos@main',
      githubManagedFiles: {
        'safe/note.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
      },
      githubProjectionFingerprint: 'c'.repeat(64),
      githubLastSyncedAt: 20,
    });
    expect(readGithubContinuity({ githubRemoteKey: 'not-a-remote', githubManagedFiles: {} })).toEqual({});
  });

  it('ignores invalid Notion nested field patches and does not mutate inputs', () => {
    const existing = {
      notionSections: { conversations: { headingBlockId: 'h1' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm1' } },
      notionSectionDigests: { article: { digest: 'd1' } },
    };
    const patch = {
      notionSections: null,
      notionSectionCursors: ['bad'],
      notionSectionDigests: 'bad',
    };
    const existingBefore = structuredClone(existing);
    const patchBefore = structuredClone(patch);

    const merged = mergeSyncMappingPatch(existing, patch);

    expect(merged).toMatchObject(existing);
    expect(existing).toEqual(existingBefore);
    expect(patch).toEqual(patchBefore);
  });

  it('moves a legacy mapping wholesale when the canonical target does not exist', () => {
    const legacy = {
      id: 11,
      source: 'article',
      conversationKey: 'legacy-key',
      ...notionState({ pageId: 'page-legacy', syncedAt: 50, key: 'm5', sequence: 5, heading: 'h5', digest: 'd5' }),
      feishuDocId: 'doc-legacy',
      feishuLastContentHash: 'hash-legacy',
      unknownLegacy: { keep: true },
    };

    const moved = mergeSyncMappingForIdentityMove(null, legacy, {
      source: 'web',
      conversationKey: 'article:https://example.com/a',
    });

    expect(moved).toMatchObject({
      id: 11,
      source: 'web',
      conversationKey: 'article:https://example.com/a',
      notionPageId: 'page-legacy',
      notionSections: { conversations: { headingBlockId: 'h5' } },
      feishuDocId: 'doc-legacy',
      feishuLastContentHash: 'hash-legacy',
      unknownLegacy: { keep: true },
    });
  });

  it('keeps target provider groups while filling unknown metadata from legacy', () => {
    const target = {
      id: 20,
      source: 'web',
      conversationKey: 'canonical',
      ...notionState({
        pageId: 'page-target',
        syncedAt: 10,
        key: 'target',
        sequence: 1,
        heading: 'h-target',
        digest: 'd-target',
      }),
      feishuDocId: 'doc-target',
      feishuLastContentHash: 'hash-target',
      shared: 'target',
    };
    const legacy = {
      id: 21,
      ...notionState({
        pageId: 'page-legacy',
        syncedAt: 999,
        key: 'legacy',
        sequence: 9,
        heading: 'h-legacy',
        digest: 'd-legacy',
      }),
      feishuDocId: 'doc-legacy',
      feishuLastContentHash: 'hash-legacy',
      shared: 'legacy',
      legacyOnly: true,
    };

    const merged = mergeSyncMappingForIdentityMove(target, legacy, {
      source: 'web',
      conversationKey: 'canonical',
      fallbackNotionPageId: 'page-fallback',
    });

    expect(merged).toMatchObject({
      id: 20,
      notionPageId: 'page-target',
      lastSyncedMessageKey: 'target',
      notionSections: { conversations: { headingBlockId: 'h-target' } },
      feishuDocId: 'doc-target',
      feishuLastContentHash: 'hash-target',
      shared: 'target',
      legacyOnly: true,
    });
  });

  it('adopts legacy provider groups only when the target lacks that provider target', () => {
    const target = { id: 30, source: 'web', conversationKey: 'canonical', targetOnly: true };
    const legacy = {
      id: 31,
      ...notionState({
        pageId: 'page-legacy',
        syncedAt: 50,
        key: 'legacy',
        sequence: 5,
        heading: 'h-legacy',
        digest: 'd-legacy',
      }),
      feishuDocId: 'doc-legacy',
      feishuLastContentHash: 'hash-legacy',
    };

    const merged = mergeSyncMappingForIdentityMove(target, legacy, {
      source: 'web',
      conversationKey: 'canonical',
    });

    expect(merged).toMatchObject({
      id: 30,
      notionPageId: 'page-legacy',
      lastSyncedMessageKey: 'legacy',
      notionSections: { conversations: { headingBlockId: 'h-legacy' } },
      feishuDocId: 'doc-legacy',
      feishuLastContentHash: 'hash-legacy',
      targetOnly: true,
    });
  });

  it('preserves legacy GitHub continuity only when the identity itself is unchanged', () => {
    const legacy = {
      id: 31,
      source: 'chatgpt',
      conversationKey: 'same',
      ...githubState({ syncedAt: 50, marker: 'a' }),
    };

    const unchanged = mergeSyncMappingForIdentityMove(null, legacy, {
      source: 'chatgpt',
      conversationKey: 'same',
    });
    expect(unchanged.githubRemoteKey).toBe('github.com/example/syncnos@main');
    expect(unchanged.githubManagedFiles).toEqual(legacy.githubManagedFiles);

    const changed = mergeSyncMappingForIdentityMove(null, legacy, {
      source: 'web',
      conversationKey: 'article:https://example.com',
    });
    expect(changed.githubRemoteKey).toBeUndefined();
    expect(changed.githubManagedFiles).toBeUndefined();
    expect(changed.githubProjectionFingerprint).toBeUndefined();
    expect(changed.githubLastSyncedAt).toBeUndefined();
  });

  it('uses target GitHub continuity during an identity move instead of legacy state', () => {
    const target = {
      id: 40,
      source: 'web',
      conversationKey: 'canonical',
      ...githubState({ remoteKey: 'github.com/example/target@main', syncedAt: 10, marker: 'b' }),
    };
    const legacy = {
      id: 41,
      source: 'article',
      conversationKey: 'legacy',
      ...githubState({ remoteKey: 'github.com/example/legacy@main', syncedAt: 999, marker: 'a' }),
    };

    const moved = mergeSyncMappingForIdentityMove(target, legacy, {
      source: 'web',
      conversationKey: 'canonical',
    });

    expect(moved.githubRemoteKey).toBe('github.com/example/target@main');
    expect(moved.githubProjectionFingerprint).toBe('b'.repeat(64));
    expect(moved.githubManagedFiles).toEqual(target.githubManagedFiles);
  });

  it('uses fallback Notion page only after provider-state selection leaves the page empty', () => {
    const merged = mergeSyncMappingForIdentityMove({ id: 40, lastSyncedMessageKey: 'target-orphan' }, null, {
      source: 'web',
      conversationKey: 'canonical',
      fallbackNotionPageId: 'page-fallback',
    });

    expect(merged).toMatchObject({
      id: 40,
      notionPageId: 'page-fallback',
      lastSyncedMessageKey: 'target-orphan',
    });
  });

  it('strips only the browser-local id without mutating the source', () => {
    const source = { id: 7, source: 'chatgpt', conversationKey: 'c1', nested: { value: 1 } };
    const stripped = stripSyncMappingLocalId(source);

    expect(stripped).toEqual({ source: 'chatgpt', conversationKey: 'c1', nested: { value: 1 } });
    expect(source.id).toBe(7);
  });

  it('fresh import preserves complete provider continuity and unknown metadata', () => {
    const incoming = {
      id: 99,
      source: 'chatgpt',
      conversationKey: 'c1',
      ...notionState({ pageId: 'page-a', syncedAt: 100, key: 'm2', sequence: 2, heading: 'h-a', digest: 'd-a' }),
      feishuDocId: 'doc-a',
      feishuLastContentHash: 'hash-a',
      futureProviderMetadata: { opaque: true },
      updatedAt: 200,
    };

    const merged = mergeSyncMappingForImport(null, incoming);

    expect(merged).toMatchObject({
      notionPageId: 'page-a',
      notionSections: { conversations: { headingBlockId: 'h-a' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm2', lastSyncedSequence: 2 } },
      notionSectionDigests: { article: { digest: 'd-a' } },
      feishuDocId: 'doc-a',
      feishuLastContentHash: 'hash-a',
      futureProviderMetadata: { opaque: true },
    });
    expect(merged.id).toBeUndefined();
  });

  it('same Notion page uses the later lastSyncedAt as one complete snapshot', () => {
    const local = {
      ...notionState({
        pageId: 'page-a',
        syncedAt: 300,
        key: 'local',
        sequence: 3,
        heading: 'h-local',
        digest: 'd-local',
      }),
      updatedAt: 1,
    };
    const incoming = {
      ...notionState({
        pageId: 'page-a',
        syncedAt: 200,
        key: 'incoming',
        sequence: 9,
        heading: 'h-in',
        digest: 'd-in',
      }),
      updatedAt: 999,
    };

    const merged = mergeSyncMappingForImport(local, incoming);

    expect(merged.notionPageId).toBe('page-a');
    expect(merged.lastSyncedMessageKey).toBe('local');
    expect(merged.lastSyncedSequence).toBe(3);
    expect(merged.notionSections).toEqual({ conversations: { headingBlockId: 'h-local' } });
    expect(merged.notionSectionDigests).toEqual({ article: { digest: 'd-local', lastSyncedAt: 300 } });
    expect(merged.updatedAt).toBe(999);
  });

  it('same Notion page imports continuity only when both provider timestamps are valid and imported is newer', () => {
    const local = notionState({
      pageId: 'page-a',
      syncedAt: 100,
      key: 'local',
      sequence: 1,
      heading: 'h-local',
      digest: 'd-local',
    });
    const incomingEqual = notionState({
      pageId: 'page-a',
      syncedAt: 100,
      key: 'incoming-equal',
      sequence: 2,
      heading: 'h-equal',
      digest: 'd-equal',
    });
    const incomingNewer = notionState({
      pageId: 'page-a',
      syncedAt: 101,
      key: 'incoming-newer',
      sequence: 3,
      heading: 'h-newer',
      digest: 'd-newer',
    });
    const incomingMissing = notionState({
      pageId: 'page-a',
      key: 'incoming-missing',
      sequence: 4,
      heading: 'h-missing',
      digest: 'd-missing',
    });

    expect(mergeSyncMappingForImport(local, incomingEqual).lastSyncedMessageKey).toBe('local');
    expect(mergeSyncMappingForImport(local, incomingNewer).lastSyncedMessageKey).toBe('incoming-newer');
    expect(mergeSyncMappingForImport(local, incomingMissing).lastSyncedMessageKey).toBe('local');
    expect(mergeSyncMappingForImport(local, { ...incomingNewer, lastSyncedAt: null }).lastSyncedMessageKey).toBe(
      'local',
    );
    expect(mergeSyncMappingForImport(local, { ...incomingNewer, lastSyncedAt: '101' }).lastSyncedMessageKey).toBe(
      'local',
    );
    expect(
      mergeSyncMappingForImport({ ...local, lastSyncedAt: undefined }, incomingNewer).lastSyncedMessageKey,
    ).toBe('local');
  });

  it('different Notion pages keep the complete local provider state', () => {
    const local = notionState({
      pageId: 'page-local',
      syncedAt: 100,
      key: 'local',
      sequence: 1,
      heading: 'h-local',
      digest: 'd-local',
    });
    const incoming = notionState({
      pageId: 'page-incoming',
      syncedAt: 999,
      key: 'incoming',
      sequence: 9,
      heading: 'h-incoming',
      digest: 'd-incoming',
    });

    const merged = mergeSyncMappingForImport(local, incoming);

    expect(merged.notionPageId).toBe('page-local');
    expect(merged.lastSyncedMessageKey).toBe('local');
    expect(merged.lastSyncedSequence).toBe(1);
    expect(merged.notionSections).toEqual({ conversations: { headingBlockId: 'h-local' } });
    expect(merged.notionSectionCursors).toEqual(local.notionSectionCursors);
    expect(merged.notionSectionDigests).toEqual(local.notionSectionDigests);
  });

  it('keeps Feishu continuity atomic and uses provider freshness instead of mapping updatedAt', () => {
    const local = {
      feishuDocId: 'doc-local',
      feishuLastContentHash: 'hash-local',
      feishuLastSyncedAt: 20,
      updatedAt: 1,
    };

    expect(
      mergeSyncMappingForImport(local, {
        feishuDocId: 'doc-local',
        feishuLastContentHash: 'hash-local',
        feishuLastSyncedAt: 30,
        updatedAt: 0,
      }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-local', feishuLastSyncedAt: 30 });

    expect(
      mergeSyncMappingForImport(local, {
        feishuDocId: 'doc-local',
        feishuLastContentHash: 'hash-incoming',
        feishuLastSyncedAt: 30,
        updatedAt: 0,
      }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-incoming', feishuLastSyncedAt: 30 });

    expect(
      mergeSyncMappingForImport(local, {
        feishuDocId: 'doc-local',
        feishuLastContentHash: 'hash-incoming',
        feishuLastSyncedAt: 20,
        updatedAt: 999,
      }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-local', feishuLastSyncedAt: 20 });

    expect(
      mergeSyncMappingForImport(local, {
        feishuDocId: 'doc-local',
        feishuLastContentHash: 'hash-incoming',
        updatedAt: 999,
      }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-local', feishuLastSyncedAt: 20 });

    expect(
      mergeSyncMappingForImport(local, { feishuDocId: 'doc-other', feishuLastContentHash: 'hash-other', feishuLastSyncedAt: 999 }),
    ).toMatchObject({ feishuDocId: 'doc-local', feishuLastContentHash: 'hash-local', feishuLastSyncedAt: 20 });

    expect(
      mergeSyncMappingForImport({}, { feishuDocId: 'doc-incoming', feishuLastContentHash: 'hash-incoming' }),
    ).toMatchObject({ feishuDocId: 'doc-incoming', feishuLastContentHash: 'hash-incoming' });
  });

  it('merges GitHub backup continuity atomically by remote target and sync time', () => {
    const local = {
      source: 'chatgpt',
      conversationKey: 'c1',
      updatedAt: 300,
      ...githubState({ syncedAt: 300, marker: 'a' }),
    };
    const olderSameTarget = {
      updatedAt: 999,
      ...githubState({ syncedAt: 200, marker: 'b' }),
    };
    const newerSameTarget = {
      updatedAt: 1,
      ...githubState({ syncedAt: 400, marker: 'c' }),
    };
    const differentTarget = {
      updatedAt: 999,
      ...githubState({ remoteKey: 'github.com/example/other@main', syncedAt: 999, marker: 'd' }),
    };

    const olderMerged = mergeSyncMappingForImport(local, olderSameTarget);
    expect(olderMerged.githubProjectionFingerprint).toBe('a'.repeat(64));
    expect(olderMerged.githubManagedFiles).toEqual(local.githubManagedFiles);

    const newerMerged = mergeSyncMappingForImport(local, newerSameTarget);
    expect(newerMerged.githubProjectionFingerprint).toBe('c'.repeat(64));
    expect(newerMerged.githubManagedFiles).toEqual(newerSameTarget.githubManagedFiles);

    const differentMerged = mergeSyncMappingForImport(local, differentTarget);
    expect(differentMerged.githubRemoteKey).toBe('github.com/example/syncnos@main');
    expect(differentMerged.githubProjectionFingerprint).toBe('a'.repeat(64));
    expect(differentMerged.githubManagedFiles).toEqual(local.githubManagedFiles);
  });

  it('never uses mapping updatedAt as GitHub continuity freshness', () => {
    const local = { updatedAt: 500, ...githubState({ marker: 'a' }) };
    const newerAuditOnly = { updatedAt: 600, ...githubState({ marker: 'c' }) };

    expect(mergeSyncMappingForImport(local, newerAuditOnly).githubProjectionFingerprint).toBe('a'.repeat(64));

    const importedProviderFreshness = { updatedAt: 1, ...githubState({ marker: 'c', syncedAt: 700 }) };
    expect(mergeSyncMappingForImport(local, importedProviderFreshness).githubProjectionFingerprint).toBe('c'.repeat(64));

    const restored = mergeSyncMappingForImport({}, githubState({ marker: 'd', syncedAt: 700 }));
    expect(restored.githubRemoteKey).toBe('github.com/example/syncnos@main');
    expect(restored.githubProjectionFingerprint).toBe('d'.repeat(64));

    const preserved = mergeSyncMappingForImport(local, { updatedAt: 999, custom: 'incoming' });
    expect(preserved.githubRemoteKey).toBe('github.com/example/syncnos@main');
    expect(preserved.githubProjectionFingerprint).toBe('a'.repeat(64));
  });

  it('ignores malformed GitHub sync timestamps when choosing same-target backup continuity', () => {
    const localWithValidSyncTime = {
      updatedAt: 500,
      ...githubState({ syncedAt: 300, marker: 'a' }),
    };
    const importedWithStringSyncTime = {
      updatedAt: 100,
      ...githubState({ marker: 'b' }),
      githubLastSyncedAt: '999',
    };

    const stringMerged = mergeSyncMappingForImport(localWithValidSyncTime, importedWithStringSyncTime);
    expect(stringMerged.githubProjectionFingerprint).toBe('a'.repeat(64));
    expect(stringMerged.githubManagedFiles).toEqual(localWithValidSyncTime.githubManagedFiles);

    const localWithoutProviderTime = { updatedAt: 500, ...githubState({ marker: 'a' }) };
    const importedWithNegativeSyncTime = {
      updatedAt: 999,
      ...githubState({ marker: 'c' }),
      githubLastSyncedAt: -1,
    };

    const negativeMerged = mergeSyncMappingForImport(localWithoutProviderTime, importedWithNegativeSyncTime);
    expect(negativeMerged.githubProjectionFingerprint).toBe('a'.repeat(64));
    expect(negativeMerged.githubManagedFiles).toEqual(localWithoutProviderTime.githubManagedFiles);
    expect(negativeMerged.githubLastSyncedAt).toBeUndefined();
  });

  it('sanitizes imported GitHub continuity instead of trusting backup metadata as delete authority', () => {
    const incoming = {
      ...githubState({ marker: 'a' }),
      githubManagedFiles: {
        'safe/note.md': { sha: 'A'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
        '../outside.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
        '.github/workflows/owned.yml': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'asset' },
      },
    };

    const merged = mergeSyncMappingForImport({}, incoming);
    expect(merged.githubManagedFiles).toEqual({
      'safe/note.md': { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64), kind: 'markdown' },
    });
  });

  it('keeps local unknown metadata and only fills missing unknown keys from incoming', () => {
    const merged = mergeSyncMappingForImport(
      { custom: 'local', localOnly: 1 },
      { custom: 'incoming', incomingOnly: 2 },
    );

    expect(merged.custom).toBe('local');
    expect(merged.localOnly).toBe(1);
    expect(merged.incomingOnly).toBe(2);
  });

  it('does not mutate either input while replacing provider groups', () => {
    const local = {
      id: 1,
      ...notionState({
        pageId: 'page-a',
        syncedAt: 10,
        key: 'local',
        sequence: 1,
        heading: 'h-local',
        digest: 'd-local',
      }),
    };
    const incoming = {
      id: 2,
      ...notionState({ pageId: 'page-a', syncedAt: 20, key: 'incoming', sequence: 2, heading: 'h-in', digest: 'd-in' }),
    };
    const localBefore = structuredClone(local);
    const incomingBefore = structuredClone(incoming);

    mergeSyncMappingForImport(local, incoming);

    expect(local).toEqual(localBefore);
    expect(incoming).toEqual(incomingBefore);
  });
});
