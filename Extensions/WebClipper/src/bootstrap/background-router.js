/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const contracts = NS.messageContracts || {};

  const MESSAGE_TYPES = contracts.CORE_MESSAGE_TYPES || Object.freeze({
    UPSERT_CONVERSATION: "upsertConversation",
    SYNC_CONVERSATION_MESSAGES: "syncConversationMessages",
    GET_CONVERSATIONS: "getConversations",
    GET_CONVERSATION_DETAIL: "getConversationDetail",
    DELETE_CONVERSATIONS: "deleteConversations",
  });

  const NOTION_MESSAGE_TYPES = contracts.NOTION_MESSAGE_TYPES || Object.freeze({
    GET_AUTH_STATUS: "getNotionAuthStatus",
    DISCONNECT: "notionDisconnect",
    SYNC_CONVERSATIONS: "notionSyncConversations",
    GET_SYNC_JOB_STATUS: "getNotionSyncJobStatus"
  });

  const ARTICLE_MESSAGE_TYPES = contracts.ARTICLE_MESSAGE_TYPES || Object.freeze({
    FETCH_ARTICLE: "fetchArticle"
  });

  const OBSIDIAN_MESSAGE_TYPES = contracts.OBSIDIAN_MESSAGE_TYPES || Object.freeze({
    OPEN_URL: "openObsidianUrl"
  });

  const UI_MESSAGE_TYPES = contracts.UI_MESSAGE_TYPES || Object.freeze({
    OPEN_EXTENSION_POPUP: "openExtensionPopup"
  });

  const BACKGROUND_INSTANCE_ID = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const NOTION_DISCONNECT_STORAGE_KEYS = Object.freeze([
    "notion_parent_page_id",
    "notion_db_id_syncnos_ai_chats",
    "notion_oauth_pending_state",
    "notion_oauth_last_error"
  ]);

  function ok(data) {
    return { ok: true, data, error: null };
  }

  function err(message, extra) {
    return { ok: false, data: null, error: { message, extra: extra || null } };
  }

  function normalizeObsidianUrls(msg) {
    if (!msg || typeof msg !== "object") return [];
    if (Array.isArray(msg.urls)) {
      return msg.urls
        .map((url) => String(url || "").trim())
        .filter((url) => !!url);
    }
    const single = String(msg.url || "").trim();
    return single ? [single] : [];
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (!Array.isArray(keys) || !keys.length) return resolve(false);
      if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.remove !== "function") return resolve(false);
      chrome.storage.local.remove(keys, () => resolve(true));
    });
  }

  function notionDisconnectStorageKeys() {
    const out = NOTION_DISCONNECT_STORAGE_KEYS.slice();
    const notionJobStore = NS.notionSyncJobStore;
    const syncJobKey = notionJobStore && notionJobStore.NOTION_SYNC_JOB_KEY ? String(notionJobStore.NOTION_SYNC_JOB_KEY).trim() : "";
    if (syncJobKey) out.push(syncJobKey);
    return Array.from(new Set(out));
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg.type !== "string") return err("invalid message");

      switch (msg.type) {
      case UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP: {
        if (!chrome || !chrome.action || typeof chrome.action.openPopup !== "function") {
          return err("open popup is not supported in this browser", { code: "OPEN_POPUP_UNSUPPORTED" });
        }
        try {
          await chrome.action.openPopup();
          return ok({ opened: true });
        } catch (e) {
          const message = e && e.message ? e.message : String(e || "open popup failed");
          return err(message, { code: "OPEN_POPUP_FAILED" });
        }
      }
      case ARTICLE_MESSAGE_TYPES.FETCH_ARTICLE: {
        const fetcher = NS.articleFetcher;
        if (!fetcher || typeof fetcher.fetchArticleFromActiveTab !== "function") {
          return err("article fetcher not available");
        }
        try {
          const data = await fetcher.fetchArticleFromActiveTab();
          return ok(data);
        } catch (e) {
          return err(e && e.message ? e.message : String(e));
        }
      }
      case OBSIDIAN_MESSAGE_TYPES.OPEN_URL: {
        const obsidianService = NS.obsidianUrlService;
        if (!obsidianService || typeof obsidianService.isObsidianUrl !== "function" || typeof obsidianService.openObsidianUrl !== "function") {
          return err("obsidian url service missing");
        }
        const urls = normalizeObsidianUrls(msg);
        if (!urls.length) return err("invalid obsidian url");
        for (const targetUrl of urls) {
          if (!obsidianService.isObsidianUrl(targetUrl)) return err("invalid obsidian url");
        }
        for (const targetUrl of urls) {
          // open in sequence to preserve creation order
          // eslint-disable-next-line no-await-in-loop
          await obsidianService.openObsidianUrl(targetUrl);
        }
        return ok({ opened: true, count: urls.length });
      }
      case NOTION_MESSAGE_TYPES.GET_AUTH_STATUS: {
        const token = await (NS.notionTokenStore && NS.notionTokenStore.getToken ? NS.notionTokenStore.getToken() : Promise.resolve(null));
        return ok({ connected: !!(token && token.accessToken), token: token || null });
      }
      case NOTION_MESSAGE_TYPES.DISCONNECT: {
        await (NS.notionTokenStore && NS.notionTokenStore.clearToken ? NS.notionTokenStore.clearToken() : Promise.resolve());
        const clearedKeys = notionDisconnectStorageKeys();
        await storageRemove(clearedKeys);
        return ok({ disconnected: true, clearedKeys });
      }
      case NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS: {
        const notionSyncOrchestrator = NS.notionSyncOrchestrator;
        if (!notionSyncOrchestrator || typeof notionSyncOrchestrator.getSyncJobStatus !== "function") {
          return err("notion sync orchestrator missing");
        }
        try {
          const data = await notionSyncOrchestrator.getSyncJobStatus({ instanceId: BACKGROUND_INSTANCE_ID });
          return ok(data);
        } catch (e) {
          return err(e && e.message ? e.message : String(e));
        }
      }
      case NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS: {
        const notionSyncOrchestrator = NS.notionSyncOrchestrator;
        if (!notionSyncOrchestrator || typeof notionSyncOrchestrator.syncConversations !== "function") {
          return err("notion sync orchestrator missing");
        }
        try {
          const data = await notionSyncOrchestrator.syncConversations({
            conversationIds: msg.conversationIds,
            instanceId: BACKGROUND_INSTANCE_ID
          });
          return ok(data);
        } catch (e) {
          return err(e && e.message ? e.message : String(e));
        }
      }
      case MESSAGE_TYPES.UPSERT_CONVERSATION: {
        const storage = NS.backgroundStorage;
        if (!storage) return err("storage module missing");
        const payload = msg.payload || {};
        if (!payload.source) return err("missing conversation source");
        if (!payload.conversationKey) return err("missing conversationKey");
        const convo = await storage.upsertConversation(payload);
        return ok(convo);
      }
      case MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES: {
        const storage = NS.backgroundStorage;
        if (!storage) return err("storage module missing");
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const res = await storage.syncConversationMessages(conversationId, msg.messages);
        return ok(res);
      }
      case MESSAGE_TYPES.GET_CONVERSATIONS: {
        const storage = NS.backgroundStorage;
        if (!storage) return err("storage module missing");
        const items = await storage.getConversations();
        return ok(items);
      }
      case MESSAGE_TYPES.GET_CONVERSATION_DETAIL: {
        const storage = NS.backgroundStorage;
        if (!storage) return err("storage module missing");
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const messages = await storage.getMessagesByConversationId(conversationId);
        return ok({ conversationId, messages });
      }
      case MESSAGE_TYPES.DELETE_CONVERSATIONS: {
        const storage = NS.backgroundStorage;
        if (!storage) return err("storage module missing");
        const ids = Array.isArray(msg.conversationIds) ? msg.conversationIds : [];
        const res = await storage.deleteConversationsByIds(ids);
        return ok(res);
      }
      default:
        return err(`unknown message type: ${msg.type}`);
    }
  }

  function start() {
    const notionJobStore = NS.notionSyncJobStore;
    if (notionJobStore && typeof notionJobStore.abortRunningJobIfFromOtherInstance === "function") {
      notionJobStore.abortRunningJobIfFromOtherInstance(BACKGROUND_INSTANCE_ID).catch(() => {});
    }
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
  // Test hook (Node/Vitest). In extension runtime this is unused.
  NS.backgroundRouter.__handleMessageForTests = handleMessage;
  if (typeof module !== "undefined" && module.exports) module.exports = NS.backgroundRouter;
})();
