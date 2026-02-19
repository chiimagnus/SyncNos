/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const MESSAGE_TYPES = Object.freeze({
    UPSERT_CONVERSATION: "upsertConversation",
    SYNC_CONVERSATION_MESSAGES: "syncConversationMessages",
    GET_CONVERSATIONS: "getConversations",
    GET_CONVERSATION_DETAIL: "getConversationDetail",
    DELETE_CONVERSATIONS: "deleteConversations",
  });

  const NOTION_MESSAGE_TYPES = Object.freeze({
    GET_AUTH_STATUS: "getNotionAuthStatus",
    DISCONNECT: "notionDisconnect",
    SYNC_CONVERSATIONS: "notionSyncConversations"
  });

  function ok(data) {
    return { ok: true, data, error: null };
  }

  function err(message, extra) {
    return { ok: false, data: null, error: { message, extra: extra || null } };
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg.type !== "string") return err("invalid message");

    const storage = NS.backgroundStorage;
    if (!storage) return err("storage module missing");

    switch (msg.type) {
      case NOTION_MESSAGE_TYPES.GET_AUTH_STATUS: {
        const token = await (NS.notionTokenStore && NS.notionTokenStore.getToken ? NS.notionTokenStore.getToken() : Promise.resolve(null));
        return ok({ connected: !!(token && token.accessToken), token: token || null });
      }
      case NOTION_MESSAGE_TYPES.DISCONNECT: {
        await (NS.notionTokenStore && NS.notionTokenStore.clearToken ? NS.notionTokenStore.clearToken() : Promise.resolve());
        return ok({ disconnected: true });
      }
      case NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS: {
        const token = await (NS.notionTokenStore && NS.notionTokenStore.getToken ? NS.notionTokenStore.getToken() : Promise.resolve(null));
        if (!token || !token.accessToken) return err("notion not connected");
        const parent = await new Promise((resolve) => {
          chrome.storage.local.get(["notion_parent_page_id"], (res) => resolve((res && res.notion_parent_page_id) || ""));
        });
        if (!parent) return err("missing parentPageId");
        const ids = Array.isArray(msg.conversationIds) ? msg.conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : [];
        if (!ids.length) return err("no conversationIds");
        if (!NS.notionSyncService) return err("notion sync service missing");

        const convos = [];
        for (const id of ids) {
          // eslint-disable-next-line no-await-in-loop
          const convo = await storage.getConversationById(id);
          convos.push({ id, convo });
        }

        if (!NS.notionDbManager || !NS.notionDbManager.ensureDatabase) return err("notion db manager missing");
        const db = await NS.notionDbManager.ensureDatabase({ accessToken: token.accessToken, parentPageId: parent });
        const dbId = db && db.databaseId ? db.databaseId : "";
        if (!dbId) return err("missing databaseId");

        const results = [];
        for (const item of convos) {
          const id = item.id;
          const convo = item.convo;
          if (!convo) {
            results.push({ conversationId: id, ok: false, error: "conversation not found" });
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          const messages = await storage.getMessagesByConversationId(id);
          const blocks = NS.notionSyncService.messagesToBlocks(messages, { source: convo.source });
          try {
            let pageId = convo.notionPageId || "";
            if (pageId) {
              let validForTargetDb = false;
              try {
                const page = await NS.notionSyncService.getPage(token.accessToken, pageId);
                validForTargetDb = NS.notionSyncService.pageBelongsToDatabase(page, dbId);
              } catch (_e) {
                validForTargetDb = false;
              }

              if (!validForTargetDb) pageId = "";
            }

            if (pageId) {
              await NS.notionSyncService.updatePageProperties(token.accessToken, {
                pageId,
                title: convo.title,
                url: convo.url,
                ai: convo.source
              });
              await NS.notionSyncService.clearPageChildren(token.accessToken, pageId);
              await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
            } else {
              const created = await NS.notionSyncService.createPageInDatabase(token.accessToken, {
                databaseId: dbId,
                title: convo.title,
                url: convo.url,
                ai: convo.source
              });
              pageId = created && created.id ? created.id : "";
              if (!pageId) throw new Error("create page failed");
              await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
              await storage.setConversationNotionPageId(id, pageId);
            }
            results.push({ conversationId: id, ok: true, notionPageId: pageId });
          } catch (e) {
            results.push({ conversationId: id, ok: false, error: e && e.message ? e.message : String(e) });
            // non-blocking: continue
          }
          // Basic pacing to reduce rate limiting when syncing in batch.
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 250));
        }

        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        const failures = results.filter((r) => !r.ok);
        return ok({ results, okCount, failCount, failures });
      }
      case MESSAGE_TYPES.UPSERT_CONVERSATION: {
        const payload = msg.payload || {};
        if (!payload.source) return err("missing conversation source");
        if (!payload.conversationKey) return err("missing conversationKey");
        const convo = await storage.upsertConversation(payload);
        return ok(convo);
      }
      case MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES: {
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const res = await storage.syncConversationMessages(conversationId, msg.messages);
        return ok(res);
      }
      case MESSAGE_TYPES.GET_CONVERSATIONS: {
        const items = await storage.getConversations();
        return ok(items);
      }
      case MESSAGE_TYPES.GET_CONVERSATION_DETAIL: {
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const messages = await storage.getMessagesByConversationId(conversationId);
        return ok({ conversationId, messages });
      }
      case MESSAGE_TYPES.DELETE_CONVERSATIONS: {
        const ids = Array.isArray(msg.conversationIds) ? msg.conversationIds : [];
        const res = await storage.deleteConversationsByIds(ids);
        return ok(res);
      }
      default:
        return err(`unknown message type: ${msg.type}`);
    }
  }

  function start() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      Promise.resolve()
        .then(() => handleMessage(msg))
        .then((res) => sendResponse(res))
        .catch((e) => sendResponse(err(e && e.message ? e.message : "unknown error", String(e))));
      return true;
    });

    const oauth = NS.backgroundNotionOAuth;
    oauth && oauth.ensureDefaultNotionOAuthClientId && oauth.ensureDefaultNotionOAuthClientId();
    oauth && oauth.setupNotionOAuthNavigationListener && oauth.setupNotionOAuthNavigationListener();

    if (chrome && chrome.runtime && chrome.runtime.onInstalled && oauth && oauth.ensureDefaultNotionOAuthClientId) {
      chrome.runtime.onInstalled.addListener(() => oauth.ensureDefaultNotionOAuthClientId());
    }

    NS.__backgroundReady = true;
  }

  NS.backgroundRouter = { start };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.backgroundRouter;
})();

