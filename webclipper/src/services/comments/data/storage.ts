import * as idb from '@services/comments/data/storage-idb';

export async function addArticleComment(payload: any) {
  return await idb.addArticleComment(payload);
}

export async function listArticleCommentsByCanonicalUrl(canonicalUrl: string) {
  return await idb.listArticleCommentsByCanonicalUrl(canonicalUrl);
}

export async function listArticleCommentsByConversationId(conversationId: number) {
  return await idb.listArticleCommentsByConversationId(conversationId);
}

export async function getArticleCommentDeleteContextById(id: number) {
  return await idb.getArticleCommentDeleteContextById(id);
}

export async function deleteArticleCommentById(id: number) {
  return await idb.deleteArticleCommentById(id);
}

export async function hasAnyArticleCommentsForCanonicalUrl(canonicalUrl: string) {
  return await idb.hasAnyArticleCommentsForCanonicalUrl(canonicalUrl);
}

export async function attachOrphanCommentsToConversation(canonicalUrl: string, conversationId: number) {
  return await idb.attachOrphanCommentsToConversation(canonicalUrl, conversationId);
}

export async function migrateArticleCommentsCanonicalUrl(
  fromCanonicalUrl: string,
  toCanonicalUrl: string,
): Promise<{ updated: number }> {
  return await idb.migrateArticleCommentsCanonicalUrl(fromCanonicalUrl, toCanonicalUrl);
}
