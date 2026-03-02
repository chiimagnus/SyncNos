const { assertKindDef } = require("./conversation-kind-contract.js");

const definitions = [];

function aiLabelForSource(source) {
  const sourceKey = String(source || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  const sourceNameMap = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    deepseek: "DeepSeek",
    kimi: "Kimi",
    doubao: "豆包",
    yuanbao: "元宝",
    poe: "Poe",
    notionai: "NotionAI",
    goodlinks: "GoodLinks"
  };

  const mapped = sourceNameMap[sourceKey];
  if (mapped) return mapped;
  const fallback = String(source || "").trim();
  return fallback || "Unknown";
}

function asRichText(value) {
  const text = String(value || "").trim();
  if (!text) return { rich_text: [] };
  return { rich_text: [{ type: "text", text: { content: text } }] };
}

function asTitle(value) {
  const text = String(value || "").trim();
  return { title: [{ type: "text", text: { content: text || "Untitled" } }] };
}

function asDate(value) {
  const timestamp = Number(value);
  const capturedAt = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  return { date: { start: new Date(capturedAt).toISOString() } };
}

function asUrl(value) {
  const url = String(value || "").trim();
  return { url: url || "" };
}

function register(definition) {
  const checked = assertKindDef(definition);
  if (definitions.some((item) => item.id === checked.id)) return false;
  definitions.push(checked);
  return true;
}

function pick(conversation) {
  for (const definition of definitions) {
    try {
      if (definition.matches(conversation)) return definition;
    } catch (_e) {
      // ignore and continue
    }
  }
  return null;
}

function list() {
  return definitions.slice();
}

function getNotionStorageKeys() {
  const output = [];
  for (const definition of definitions) {
    const key = String((definition && definition.notion && definition.notion.dbSpec && definition.notion.dbSpec.storageKey) || "").trim();
    if (key) output.push(key);
  }
  return Array.from(new Set(output));
}

const CHAT_KIND_ID = "chat";
const ARTICLE_KIND_ID = "article";

const chatKind = {
  id: CHAT_KIND_ID,
  matches: () => true,
  notion: {
    dbSpec: {
      title: "SyncNos-AI Chats",
      storageKey: "notion_db_id_syncnos_ai_chats",
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} },
        AI: { multi_select: { options: [] } }
      },
      ensureSchemaPatch: {
        AI: { multi_select: { options: [] } }
      }
    },
    pageSpec: {
      buildCreateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          Date: asDate(data.lastCapturedAt),
          AI: { multi_select: [{ name: aiLabelForSource(data.source) }] }
        };
      },
      buildUpdateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          AI: { multi_select: [{ name: aiLabelForSource(data.source) }] }
        };
      }
    }
  },
  obsidian: { folder: "SyncNos-AIChats" }
};

const articleKind = {
  id: ARTICLE_KIND_ID,
  matches: (conversation) => conversation && String(conversation.sourceType || "") === "article",
  notion: {
    dbSpec: {
      title: "SyncNos-Web Articles",
      storageKey: "notion_db_id_syncnos_web_articles",
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} },
        Author: { rich_text: {} },
        Published: { rich_text: {} },
        Description: { rich_text: {} }
      },
      ensureSchemaPatch: {
        Author: { rich_text: {} },
        Published: { rich_text: {} },
        Description: { rich_text: {} }
      }
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
          Description: asRichText(data.description)
        };
      },
      buildUpdateProperties(conversation) {
        const data = conversation || {};
        return {
          Name: asTitle(data.title),
          URL: asUrl(data.url),
          Author: asRichText(data.author),
          Published: asRichText(data.publishedAt),
          Description: asRichText(data.description)
        };
      },
      shouldRebuild({ messages, mapping }) {
        const syncedAt = Number(mapping && mapping.lastSyncedAt);
        const lastSyncedAt = Number.isFinite(syncedAt) ? syncedAt : 0;
        const messageList = Array.isArray(messages) ? messages : [];
        return messageList.some((message) => Number(message && message.updatedAt) > lastSyncedAt);
      }
    }
  },
  obsidian: { folder: "SyncNos-WebArticles" }
};

register(articleKind);
register(chatKind);

const conversationKinds = {
  register,
  pick,
  list,
  getNotionStorageKeys,
  CHAT_KIND_ID,
  ARTICLE_KIND_ID
};

module.exports = conversationKinds;
module.exports.conversationKinds = conversationKinds;
module.exports.CHAT_KIND_ID = CHAT_KIND_ID;
module.exports.ARTICLE_KIND_ID = ARTICLE_KIND_ID;
