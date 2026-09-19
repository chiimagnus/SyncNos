import * as idb from '@services/comments/data/storage-idb';
import type { AddArticleCommentInput } from '@services/comments/domain/models';

export function addArticleComment(payload: AddArticleCommentInput) {
  return idb.addArticleComment(payload);
}

export function syncImportedArticleComments(items: idb.ImportedArticleCommentInput[]) {
  return idb.syncImportedArticleComments(items);
}

export function listArticleCommentsByCanonicalUrl(canonicalUrl: string) {
  return idb.listArticleCommentsByCanonicalUrl(canonicalUrl);
}

export function listArticleCommentsByConversationId(conversationId: number) {
  return idb.listArticleCommentsByConversationId(conversationId);
}

export function deleteArticleCommentById(id: number) {
  return idb.deleteArticleCommentById(id);
}

export function attachOrphanCommentsToConversation(canonicalUrl: string, conversationId: number) {
  return idb.attachOrphanCommentsToConversation(canonicalUrl, conversationId);
}

export function migrateArticleCommentsCanonicalUrl(input: {
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
  conversationId: number | null;
}): Promise<{ updated: number }> {
  return idb.migrateArticleCommentsCanonicalUrl(input);
}
