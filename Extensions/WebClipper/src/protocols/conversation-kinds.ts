import { assertKindDef, type ConversationKindDefinition } from './conversation-kind-contract';

type ConversationKindRegistry = {
  register: (definition: ConversationKindDefinition) => boolean;
  pick: (conversation: any) => ConversationKindDefinition | null;
  list: () => ConversationKindDefinition[];
  getNotionStorageKeys: () => string[];
  CHAT_KIND_ID: string;
  ARTICLE_KIND_ID: string;
};

const definitions: ConversationKindDefinition[] = [];

function aiLabelForSource(source: unknown): string {
  const namespace: any = (globalThis as any).WebClipper || {};
  const notionAi = namespace.notionAi;
  if (notionAi && typeof notionAi.optionNameForSource === 'function') {
    return notionAi.optionNameForSource(source);
  }
  const fallback = String(source || '').trim();
  return fallback || 'Unknown';
}

function asRichText(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return { rich_text: [] };
  return { rich_text: [{ type: 'text', text: { content: text } }] };
}

function asTitle(value: unknown) {
  const text = String(value || '').trim();
  return { title: [{ type: 'text', text: { content: text || 'Untitled' } }] };
}

function asDate(value: unknown) {
  const timestamp = Number(value);
  const capturedAt = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  return { date: { start: new Date(capturedAt).toISOString() } };
}

function asUrl(value: unknown) {
  const url = String(value || '').trim();
  return { url: url || '' };
}

function register(definition: ConversationKindDefinition): boolean {
  const checked = assertKindDef(definition);
  if (definitions.some((item) => item.id === checked.id)) return false;
  definitions.push(checked);
  return true;
}

function pick(conversation: any): ConversationKindDefinition | null {
  for (const definition of definitions) {
    try {
      if (definition.matches(conversation)) return definition;
    } catch (_e) {
      // ignore and continue
    }
  }
  return null;
}

function list(): ConversationKindDefinition[] {
  return definitions.slice();
}

function getNotionStorageKeys(): string[] {
  const output: string[] = [];
  for (const definition of definitions) {
    const key = String(definition?.notion?.dbSpec?.storageKey || '').trim();
    if (key) output.push(key);
  }
  return Array.from(new Set(output));
}

export const CHAT_KIND_ID = 'chat';
export const ARTICLE_KIND_ID = 'article';

const chatKind: ConversationKindDefinition = {
  id: CHAT_KIND_ID,
  matches: () => true,
  notion: {
    dbSpec: {
      title: 'SyncNos-AI Chats',
      storageKey: 'notion_db_id_syncnos_ai_chats',
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} },
        AI: { multi_select: { options: [] } },
      },
      ensureSchemaPatch: {
        AI: { multi_select: { options: [] } },
      },
    },
    pageSpec: {
      buildCreateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          Date: asDate(data.lastCapturedAt),
          AI: { multi_select: [{ name: aiLabelForSource(data.source) }] },
        };
      },
      buildUpdateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          AI: { multi_select: [{ name: aiLabelForSource(data.source) }] },
        };
      },
    },
  },
  obsidian: { folder: 'SyncNos-AIChats' },
};

const articleKind: ConversationKindDefinition = {
  id: ARTICLE_KIND_ID,
  matches: (conversation) => conversation && String(conversation.sourceType || '') === 'article',
  notion: {
    dbSpec: {
      title: 'SyncNos-Web Articles',
      storageKey: 'notion_db_id_syncnos_web_articles',
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} },
        Author: { rich_text: {} },
        Published: { rich_text: {} },
        Description: { rich_text: {} },
      },
      ensureSchemaPatch: {
        Author: { rich_text: {} },
        Published: { rich_text: {} },
        Description: { rich_text: {} },
      },
    },
    pageSpec: {
      buildCreateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          Date: asDate(data.lastCapturedAt),
          Author: asRichText(data.author),
          Published: asRichText(data.publishedAt),
          Description: asRichText(data.description),
        };
      },
      buildUpdateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          Author: asRichText(data.author),
          Published: asRichText(data.publishedAt),
          Description: asRichText(data.description),
        };
      },
      shouldRebuild({ messages, mapping }) {
        const syncedAt = Number(mapping?.lastSyncedAt);
        const lastSyncedAt = Number.isFinite(syncedAt) ? syncedAt : 0;
        const messageList = Array.isArray(messages) ? messages : [];
        return messageList.some((message) => Number(message?.updatedAt) > lastSyncedAt);
      },
    },
  },
  obsidian: { folder: 'SyncNos-WebArticles' },
};

register(articleKind);
register(chatKind);

export const conversationKinds: ConversationKindRegistry = {
  register,
  pick,
  list,
  getNotionStorageKeys,
  CHAT_KIND_ID,
  ARTICLE_KIND_ID,
};
