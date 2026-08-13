import { mapSqliteError } from './database';
import { migrateArticleCommentsCanonicalUrlWithinTransaction } from './comments-repository';
import { runFactsTransaction } from './revision';
import {
  updateArticleConversationUrlWithinTransaction,
  type SqliteArticleUrlUpdateResult,
} from './conversations-repository';
import type { SyncNosSqliteDatabase } from './schema';

export type UpdateSqliteArticleUrlInput = Readonly<{
  conversationKey: unknown;
  fromCanonicalUrl: unknown;
  source: unknown;
  toCanonicalUrl: unknown;
}>;

export type SqliteArticleUrlOperationResult = SqliteArticleUrlUpdateResult &
  Readonly<{
    commentsUpdated: number;
  }>;

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error);
  }
}

/** The only SQLite path that changes an article URL and its comment context together. */
export function updateSqliteArticleUrl(
  database: SyncNosSqliteDatabase,
  input: UpdateSqliteArticleUrlInput,
): SqliteArticleUrlOperationResult {
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const article = updateArticleConversationUrlWithinTransaction(database, input);
        const commentsUpdated = migrateArticleCommentsCanonicalUrlWithinTransaction(database, {
          conversationId: article.conversationId,
          conversationKey: article.conversationKey,
          conversationSource: article.conversationSource,
          fromCanonicalUrl: article.fromCanonicalUrl,
          toCanonicalUrl: article.toCanonicalUrl,
        });
        return Object.freeze({ ...article, commentsUpdated });
      }).result,
  );
}
