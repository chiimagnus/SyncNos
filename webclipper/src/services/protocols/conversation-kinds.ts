import { assertKindDef, type ConversationKindDefinition } from '@services/protocols/conversation-kind-contract.ts';

type ConversationKindRegistry = {
  register: (definition: ConversationKindDefinition) => boolean;
  pick: (conversation: any) => ConversationKindDefinition | null;
  list: () => ConversationKindDefinition[];
  getNotionDbSpecByKindId: (kindId: string) => ConversationKindDefinition['notion']['dbSpec'] | null;
  getNotionStorageKeys: () => string[];
  CHAT_KIND_ID: string;
  ARTICLE_KIND_ID: string;
};

const definitions: ConversationKindDefinition[] = [];

function aiLabelForSource(source: unknown): string {
  const sourceKey = String(source || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  const sourceNameMap: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    doubao: '豆包',
    yuanbao: '元宝',
    poe: 'Poe',
    notionai: 'NotionAI',
    goodlinks: 'GoodLinks',
  };

  const mapped = sourceNameMap[sourceKey];
  if (mapped) return mapped;
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
  const raw = String(value ?? '').trim();
  if (!raw) return { url: null };
  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return { url: null };
    return { url: raw };
  } catch (_e) {
    return { url: null };
  }
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

function getNotionDbSpecByKindId(kindId: string) {
  const id = String(kindId || '').trim();
  if (!id) return null;
  const definition = definitions.find((item) => String(item?.id || '').trim() === id);
  if (!definition || !definition.notion || !definition.notion.dbSpec) return null;
  return definition.notion.dbSpec;
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
      },
      ensureSchemaPatch: {
        Author: { rich_text: {} },
        Published: { rich_text: {} },
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
        };
      },
      buildUpdateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          Author: asRichText(data.author),
          Published: asRichText(data.publishedAt),
        };
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
  getNotionDbSpecByKindId,
  getNotionStorageKeys,
  CHAT_KIND_ID,
  ARTICLE_KIND_ID,
};
