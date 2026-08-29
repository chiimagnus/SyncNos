import {
  deleteConversationsByIds,
  getConversationById,
  getMessagesByConversationId,
  getSyncMappingByConversation,
  patchSyncMapping,
  recordObsidianRemoteWrite,
  setConversationNotionPageId,
  setSyncCursor,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage-idb';
import {
  attachOrphanCommentsToConversation as attachOrphanArticleCommentsToConversation,
  listArticleCommentsByConversationId as getArticleCommentsByConversationId,
} from '@services/comments/data/storage';

export const backgroundStorage = {
  upsertConversation,
  syncConversationMessages,
  getConversationById,
  getMessagesByConversationId,
  deleteConversationsByIds,
  setConversationNotionPageId,
  getSyncMappingByConversation,
  patchSyncMapping,
  recordObsidianRemoteWrite,
  setSyncCursor,
  getArticleCommentsByConversationId,
  attachOrphanArticleCommentsToConversation,
};
