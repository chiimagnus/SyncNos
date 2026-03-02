/* eslint-disable import/no-unresolved */

// Conversation storage adapters (migration step for P4-16).
//
// This module intentionally delegates to the existing legacy implementation on
// `globalThis.WebClipper.backgroundStorage`. Once the IndexedDB layer is
// migrated to TS, these wrappers become the single call site to replace.

import type { Conversation, ConversationDetail, ConversationMessage } from './models';

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
  return (await legacy().getConversations()) as any;
}

export async function getConversationDetail(conversationId: number): Promise<ConversationDetail> {
  const messages = (await legacy().getMessagesByConversationId(conversationId)) as ConversationMessage[];
  return { conversationId, messages };
}

export async function upsertConversation(payload: any): Promise<Conversation> {
  return (await legacy().upsertConversation(payload)) as any;
}

export async function syncConversationMessages(conversationId: number, messages: any[]): Promise<{ upserted: number; deleted: number }> {
  return (await legacy().syncConversationMessages(conversationId, messages)) as any;
}

export async function deleteConversationsByIds(conversationIds: any[]): Promise<any> {
  return legacy().deleteConversationsByIds(conversationIds);
}

