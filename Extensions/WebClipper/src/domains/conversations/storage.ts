/* eslint-disable import/no-unresolved */

// Conversation storage adapters (migration step for P4-16).
//
// Primary implementation uses IndexedDB via TS schema `openDb()`.
// Fallback delegates to legacy `globalThis.WebClipper.backgroundStorage` when schema isn't available.

import type { Conversation, ConversationDetail, ConversationMessage } from './models';
import * as idb from './storage-idb';

type LegacyStorage = {
  upsertConversation: (payload: any) => Promise<any>;
  syncConversationMessages: (conversationId: number, messages: any[]) => Promise<any>;
  getConversations: () => Promise<any[]>;
  getMessagesByConversationId: (conversationId: number) => Promise<any[]>;
  deleteConversationsByIds: (ids: any[]) => Promise<any>;
};

function legacy(): LegacyStorage {
  const NS: any = (globalThis as any).WebClipper || {};
  const storage = NS.backgroundStorage as LegacyStorage | undefined;
  if (!storage) throw new Error('storage module missing');
  return storage;
}

export async function listConversations(): Promise<Conversation[]> {
  try {
    return await idb.getConversations();
  } catch (_e) {
    return (await legacy().getConversations()) as any;
  }
}

export async function getConversationDetail(conversationId: number): Promise<ConversationDetail> {
  try {
    const messages = (await idb.getMessagesByConversationId(conversationId)) as ConversationMessage[];
    return { conversationId, messages };
  } catch (_e) {
    const messages = (await legacy().getMessagesByConversationId(conversationId)) as ConversationMessage[];
    return { conversationId, messages };
  }
}

export async function upsertConversation(payload: any): Promise<Conversation> {
  try {
    return (await idb.upsertConversation(payload)) as any;
  } catch (_e) {
    return (await legacy().upsertConversation(payload)) as any;
  }
}

export async function syncConversationMessages(conversationId: number, messages: any[]): Promise<{ upserted: number; deleted: number }> {
  try {
    return (await idb.syncConversationMessages(conversationId, messages)) as any;
  } catch (_e) {
    return (await legacy().syncConversationMessages(conversationId, messages)) as any;
  }
}

export async function deleteConversationsByIds(conversationIds: any[]): Promise<any> {
  try {
    return await idb.deleteConversationsByIds(conversationIds);
  } catch (_e) {
    return legacy().deleteConversationsByIds(conversationIds);
  }
}
