(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const defs = [];

  function aiLabelForSource(source) {
    const api = NS.notionAi;
    if (api && typeof api.optionNameForSource === "function") return api.optionNameForSource(source);
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
    const t = Number(value);
    const at = Number.isFinite(t) && t > 0 ? t : Date.now();
    return { date: { start: new Date(at).toISOString() } };
  }

  function asUrl(value) {
    const url = String(value || "").trim();
    return { url: url || "" };
  }

  function register(def) {
    const contract = NS.conversationKindContract;
    const checked = contract && contract.assertKindDef ? contract.assertKindDef(def) : def;
    const exists = defs.some((d) => d.id === checked.id);
    if (exists) return false;
    defs.push(checked);
    return true;
  }

  function pick(conversation) {
    for (const d of defs) {
      try {
        if (d.matches(conversation)) return d;
      } catch (_e) {
        // ignore and continue
      }
    }
    return null;
  }

  function list() {
    return defs.slice();
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
          const c = conversation || {};
          return {
            Name: asTitle(c.title),
            URL: asUrl(c.url),
            Date: asDate(c.lastCapturedAt),
            AI: { multi_select: [{ name: aiLabelForSource(c.source) }] }
          };
        },
        buildUpdateProperties(conversation) {
          const c = conversation || {};
          return {
            Name: asTitle(c.title),
            URL: asUrl(c.url),
            AI: { multi_select: [{ name: aiLabelForSource(c.source) }] }
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
          const c = conversation || {};
          return {
            Name: asTitle(c.title),
            URL: asUrl(c.url),
            Date: asDate(c.lastCapturedAt),
            Author: asRichText(c.author),
            Published: asRichText(c.publishedAt),
            Description: asRichText(c.description)
          };
        },
        buildUpdateProperties(conversation) {
          const c = conversation || {};
          return {
            Name: asTitle(c.title),
            URL: asUrl(c.url),
            Author: asRichText(c.author),
            Published: asRichText(c.publishedAt),
            Description: asRichText(c.description)
          };
        },
        shouldRebuild({ messages, mapping }) {
          const syncedAt = mapping && Number(mapping.lastSyncedAt);
          const lastSyncedAt = Number.isFinite(syncedAt) ? syncedAt : 0;
          const list = Array.isArray(messages) ? messages : [];
          return list.some((m) => Number(m && m.updatedAt) > lastSyncedAt);
        }
      }
    },
    obsidian: { folder: "SyncNos-WebArticles" }
  };

  // Register built-ins (order matters: article first, chat fallback).
  register(articleKind);
  register(chatKind);

  const api = {
    register,
    pick,
    list,
    CHAT_KIND_ID,
    ARTICLE_KIND_ID
  };
  NS.conversationKinds = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

