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

  const OBSIDIAN_MESSAGE_TYPES = contracts.OBSIDIAN_MESSAGE_TYPES || Object.freeze({
    GET_SETTINGS: "obsidianGetSettings",
    SAVE_SETTINGS: "obsidianSaveSettings",
    TEST_CONNECTION: "obsidianTestConnection",
    SYNC_CONVERSATIONS: "obsidianSyncConversations",
    GET_SYNC_STATUS: "obsidianGetSyncStatus"
  });

  const ARTICLE_MESSAGE_TYPES = contracts.ARTICLE_MESSAGE_TYPES || Object.freeze({
    FETCH_ACTIVE_TAB: "fetchActiveTabArticle"
  });

  const UI_MESSAGE_TYPES = contracts.UI_MESSAGE_TYPES || Object.freeze({
    OPEN_EXTENSION_POPUP: "openExtensionPopup",
    APPLY_INPAGE_VISIBILITY: "applyInpageVisibility"
  });

  const UI_EVENT_TYPES = contracts.UI_EVENT_TYPES || Object.freeze({
    CONVERSATIONS_CHANGED: "conversationsChanged"
  });

  const UI_PORT_NAMES = contracts.UI_PORT_NAMES || Object.freeze({
    POPUP_EVENTS: "popup:events"
  });

  const BACKGROUND_INSTANCE_ID = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const NOTION_DISCONNECT_BASE_STORAGE_KEYS = Object.freeze([
    "notion_parent_page_id",
    "notion_oauth_pending_state",
    "notion_oauth_last_error"
  ]);

  function getNotionDbStorageKeys() {
    const kinds = NS.conversationKinds;
    if (kinds && typeof kinds.getNotionStorageKeys === "function") {
      try {
        const keys = kinds.getNotionStorageKeys();
        if (Array.isArray(keys) && keys.length) return keys.map((k) => String(k || "").trim()).filter(Boolean);
      } catch (_e) {
        // ignore
      }
    }
    // Fallback (load-order safety).
    return ["notion_db_id_syncnos_ai_chats", "notion_db_id_syncnos_web_articles"];
  }

  function ok(data) {
    return { ok: true, data, error: null };
  }

  function err(message, extra) {
    return { ok: false, data: null, error: { message, extra: extra || null } };
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (!Array.isArray(keys) || !keys.length) return resolve(false);
      if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.remove !== "function") return resolve(false);
      chrome.storage.local.remove(keys, () => resolve(true));
    });
  }

  function notionDisconnectStorageKeys() {
    const out = NOTION_DISCONNECT_BASE_STORAGE_KEYS.slice();
    out.push(...getNotionDbStorageKeys());
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
      case UI_MESSAGE_TYPES.APPLY_INPAGE_VISIBILITY: {
        const api = NS.backgroundInpageWebVisibility;
        if (!api || typeof api.applyVisibilitySetting !== "function") {
          return err("inpage web visibility manager missing", { code: "INPAGE_VISIBILITY_UNAVAILABLE" });
        }
        try {
          const data = await api.applyVisibilitySetting({ reason: "popup" });
          return ok(data);
        } catch (e) {
          return err(e && e.message ? e.message : String(e || "apply inpage visibility failed"));
        }
      }
      case OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS: {
        const store = NS.obsidianSettingsStore;
        if (!store || typeof store.getSettings !== "function") return err("obsidian settings store missing");
        const data = await store.getSettings();
        return ok(data);
      }
      case OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS: {
        const store = NS.obsidianSettingsStore;
        if (!store || typeof store.saveSettings !== "function") return err("obsidian settings store missing");
        const data = await store.saveSettings({
          enabled: msg.enabled,
          apiBaseUrl: msg.apiBaseUrl,
          apiKey: msg.apiKey,
          authHeaderName: msg.authHeaderName,
          chatFolder: msg.chatFolder,
          articleFolder: msg.articleFolder
        });
        return ok(data);
      }
      case OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION: {
        const orchestrator = NS.obsidianSyncOrchestrator;
        if (!orchestrator || typeof orchestrator.testConnection !== "function") return err("obsidian sync orchestrator missing");
        const data = await orchestrator.testConnection({ instanceId: BACKGROUND_INSTANCE_ID });
        return ok(data);
      }
      case OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS: {
        const orchestrator = NS.obsidianSyncOrchestrator;
        if (!orchestrator || typeof orchestrator.getSyncStatus !== "function") return err("obsidian sync orchestrator missing");
        const data = await orchestrator.getSyncStatus({ instanceId: BACKGROUND_INSTANCE_ID });
        return ok(data);
      }
      case OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS: {
        const orchestrator = NS.obsidianSyncOrchestrator;
        if (!orchestrator || typeof orchestrator.syncConversations !== "function") return err("obsidian sync orchestrator missing");
        const data = await orchestrator.syncConversations({
          conversationIds: msg.conversationIds,
          forceFullConversationIds: msg.forceFullConversationIds,
          instanceId: BACKGROUND_INSTANCE_ID
        });
        return ok(data);
      }
      case ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB: {
        const articleService = NS.articleFetchService;
        if (!articleService || typeof articleService.fetchActiveTabArticle !== "function") {
          return err("article fetch service missing");
        }
        try {
          const data = await articleService.fetchActiveTabArticle({ tabId: msg.tabId });
          try {
            const hub = NS.backgroundEventsHub;
            const conversationId = Number(data && data.conversationId);
            if (hub && typeof hub.broadcast === "function" && Number.isFinite(conversationId) && conversationId > 0) {
              hub.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, { reason: "articleFetch", conversationId });
            }
          } catch (_e) {
            // ignore
          }
          return ok(data);
        } catch (e) {
          return err(e && e.message ? e.message : String(e || "article fetch failed"));
        }
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
        try {
          const hub = NS.backgroundEventsHub;
          if (hub && typeof hub.broadcast === "function") {
            hub.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, { reason: "upsert", conversationId });
          }
        } catch (_e) {
          // ignore
        }
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
        try {
          const hub = NS.backgroundEventsHub;
          if (hub && typeof hub.broadcast === "function") {
            const normalizedIds = Array.isArray(ids)
              ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
              : [];
            hub.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, { reason: "delete", conversationIds: normalizedIds });
          }
        } catch (_e) {
          // ignore
        }
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

    // Port subscription:
    // When popup opens, it connects via `chrome.runtime.connect`. That Port keeps MV3 service worker alive
    // during the popup lifetime, and automatically disconnects when the popup closes.
    try {
      const hub = NS.backgroundEventsHub;
      if (chrome && chrome.runtime && typeof chrome.runtime.onConnect?.addListener === "function") {
        chrome.runtime.onConnect.addListener((port) => {
          if (!port || port.name !== UI_PORT_NAMES.POPUP_EVENTS) return;
          if (hub && typeof hub.registerPort === "function") hub.registerPort(port);
        });
      }
    } catch (_e) {
      // ignore
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
