import {
  clearSyncCursor,
  deleteConversationsByIds,
  getConversationById,
  getConversations,
  getMessagesByConversationId,
  getSyncMappingByConversation,
  setConversationNotionPageId,
  setSyncCursor,
  syncConversationMessages,
  upsertConversation,
} from '../data/storage-idb';

export const backgroundStorage = {
  upsertConversation,
  syncConversationMessages,
  getConversations,
  getConversationById,
  getMessagesByConversationId,
  deleteConversationsByIds,
  setConversationNotionPageId,
  getSyncMappingByConversation,
  setSyncCursor,
  clearSyncCursor,
};
