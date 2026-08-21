import { describe, expect, it } from 'vitest';
import { normalizeCommentThreadGraph } from '@services/comments/domain/comment-thread-graph';

const item = (id: number, parentId: number | null, createdAt = id) => ({
  id,
  parentId,
  conversationId: 1,
  canonicalUrl: 'https://example.com',
  authorName: null,
  quoteText: '',
  commentText: String(id),
  locator: null,
  createdAt,
  updatedAt: createdAt,
});

describe('comment thread graph', () => {
  it('sorts roots descending and replies ascending', () => {
    const graph = normalizeCommentThreadGraph([item(1, null, 1), item(2, 1, 3), item(3, 1, 2), item(4, null, 4)]);
    expect(graph.threads.map((t) => t.root.id)).toEqual([4, 1]);
    expect(graph.threads[1].replies.map((r) => r.id)).toEqual([3, 2]);
  });
  it('keeps equal-time thread and reply order stable across local id remaps', () => {
    const sourceRootA = { ...item(41, null, 100), commentText: 'same-root' };
    const sourceRootB = { ...item(57, null, 100), commentText: 'same-root' };
    const sourceReplyA = { ...item(80, 41, 110), commentText: 'reply-z' };
    const sourceReplyB = { ...item(70, 57, 110), commentText: 'reply-a' };
    const sourceReplyA2 = { ...item(81, 41, 110), commentText: 'reply-a' };
    const restoredRootA = { ...sourceRootA, id: 2 };
    const restoredRootB = { ...sourceRootB, id: 1 };
    const restoredReplyA = { ...sourceReplyA, id: 3, parentId: 2 };
    const restoredReplyB = { ...sourceReplyB, id: 4, parentId: 1 };
    const restoredReplyA2 = { ...sourceReplyA2, id: 5, parentId: 2 };

    const source = normalizeCommentThreadGraph([sourceRootA, sourceRootB, sourceReplyA, sourceReplyB, sourceReplyA2]);
    const restored = normalizeCommentThreadGraph([
      restoredRootA,
      restoredRootB,
      restoredReplyA,
      restoredReplyB,
      restoredReplyA2,
    ]);

    const project = (graph: ReturnType<typeof normalizeCommentThreadGraph>) =>
      graph.threads.map((thread) => ({
        root: thread.root.commentText,
        replies: thread.replies.map((reply) => reply.commentText),
      }));
    expect(project(restored)).toEqual(project(source));
  });

  it('classifies duplicates, orphans and cycles deterministically', () => {
    const graph = normalizeCommentThreadGraph([item(1, 2), item(2, 1), item(3, 999), item(3, null)]);
    expect(graph.duplicateIds).toEqual([3]);
    expect(graph.orphanIds).toEqual([3]);
    expect(graph.cycleIds).toEqual([1, 2]);
  });
});
