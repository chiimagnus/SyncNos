import * as idb from '@services/comments/data/storage-idb';
import type { AddArticleCommentInput } from '@services/comments/domain/models';

export async function addArticleComment(payload: AddArticleCommentInput) {
  return await idb.addArticleComment(payload);
}

export async function listArticleCommentsByCanonicalUrl(canonicalUrl: string) {
  return await idb.listArticleCommentsByCanonicalUrl(canonicalUrl);
}

export async function listArticleCommentsByConversationId(conversationId: number) {
  return await idb.listArticleCommentsByConversationId(conversationId);
}

export async function deleteArticleCommentById(id: number) {
  return await idb.deleteArticleCommentById(id);
}

export async function attachOrphanCommentsToConversation(canonicalUrl: string, conversationId: number) {
  return await idb.attachOrphanCommentsToConversation(canonicalUrl, conversationId);
}

export async function migrateArticleCommentsCanonicalUrl(input: {
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
  conversationId: number | null;
}): Promise<{ updated: number }> {
  return await idb.migrateArticleCommentsCanonicalUrl(input);
}
