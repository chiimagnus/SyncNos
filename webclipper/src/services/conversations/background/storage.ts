import {
  clearSyncCursor,
  deleteConversationsByIds,
  getConversationById,
  getConversations,
  getMessagesByConversationId,
  getSyncMappingByConversation,
  patchSyncMapping,
  setConversationNotionPageId,
  setSyncCursor,
  syncConversationMessages,
  upsertConversation,
} from '../data/storage-idb';
import {
  attachOrphanCommentsToConversation as attachOrphanArticleCommentsToConversation,
  listArticleCommentsByConversationId as getArticleCommentsByConversationId,
} from '../../comments/data/storage';

export const backgroundStorage = {
  upsertConversation,
  syncConversationMessages,
  getConversations,
  getConversationById,
  getMessagesByConversationId,
  deleteConversationsByIds,
  setConversationNotionPageId,
  getSyncMappingByConversation,
  patchSyncMapping,
  setSyncCursor,
  clearSyncCursor,
  getArticleCommentsByConversationId,
  attachOrphanArticleCommentsToConversation,
};
