export type ArticleCommentInvariantCode = 'parent_not_found' | 'parent_not_root' | 'parent_context_mismatch';

/** A reply can only target the root comment in its exact article context. */
export class ArticleCommentInvariantError extends Error {
  constructor(public readonly code: ArticleCommentInvariantCode) {
    super(code);
    this.name = 'ArticleCommentInvariantError';
  }
}
