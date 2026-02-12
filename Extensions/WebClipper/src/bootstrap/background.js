/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // Load storage schema into this service worker.
  // Note: MV3 SW doesn't share globals with content scripts, so we import explicitly.
  try {
    // eslint-disable-next-line no-undef
    importScripts("../storage/schema.js");
    // eslint-disable-next-line no-undef
    importScripts(
      "../sync/notion/oauth-config.js",
      "../sync/notion/oauth-client.js",
      "../sync/notion/token-store.js",
      "../sync/notion/notion-api.js",
      "../sync/notion/notion-db-manager.js",
      "../sync/notion/notion-sync-service.js"
    );
  } catch (_e) {
    // ignore
  }

  function ok(data) {
    return { ok: true, data, error: null };
  }

  function err(message, extra) {
    return { ok: false, data: null, error: { message, extra: extra || null } };
  }

  const MESSAGE_TYPES = Object.freeze({
    UPSERT_CONVERSATION: "upsertConversation",
    UPSERT_MESSAGES_INCREMENTAL: "upsertMessagesIncremental",
    SYNC_CONVERSATION_MESSAGES: "syncConversationMessages",
    GET_CONVERSATIONS: "getConversations",
    GET_CONVERSATION_DETAIL: "getConversationDetail",
    DELETE_CONVERSATION: "deleteConversation",
    CLEAR_ALL: "clearAll"
  });

  const NOTION_MESSAGE_TYPES = Object.freeze({
    GET_AUTH_STATUS: "getNotionAuthStatus",
    DISCONNECT: "notionDisconnect",
    ENSURE_DATABASES: "notionEnsureDatabases",
    SYNC_CONVERSATIONS: "notionSyncConversations"
  });

  // IndexedDB schema is initialized lazily; this avoids MV3 SW cold-start races.
  const openDb = (NS.storageSchema && NS.storageSchema.openDb) || (async () => Promise.reject(new Error("schema not loaded")));

  function tx(db, storeNames, mode) {
    const t = db.transaction(storeNames, mode);
    return { t, stores: storeNames.reduce((acc, n) => ((acc[n] = t.objectStore(n)), acc), {}) };
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexedDB request failed"));
    });
  }

  async function upsertConversation(payload) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readwrite");
    const idx = stores.conversations.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([payload.source, payload.conversationKey]));

    const now = Date.now();
    const record = {
      id: existing ? existing.id : undefined,
      sourceType: payload.sourceType || "chat",
      source: payload.source,
      conversationKey: payload.conversationKey,
      title: payload.title || "",
      url: payload.url || "",
      warningFlags: Array.isArray(payload.warningFlags) ? payload.warningFlags : [],
      notionPageId: payload.notionPageId || (existing ? existing.notionPageId || "" : ""),
      lastCapturedAt: payload.lastCapturedAt || now
    };

    if (existing) {
      await reqToPromise(stores.conversations.put(record));
      await new Promise((r, rej) => {
        t.oncomplete = r;
        t.onerror = () => rej(t.error || new Error("transaction failed"));
      });
      return record;
    }

    const id = await reqToPromise(stores.conversations.add(record));
    record.id = id;
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return record;
  }

  async function upsertMessagesIncremental(conversationId, messages) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readwrite");
    const idx = stores.messages.index("by_conversationId_messageKey");

    let upserted = 0;
    for (const m of messages || []) {
      if (!m || !m.messageKey) continue;
      const existing = await reqToPromise(idx.get([conversationId, m.messageKey]));
      const record = {
        id: existing ? existing.id : undefined,
        conversationId,
        messageKey: m.messageKey,
        role: m.role || "assistant",
        contentText: m.contentText || "",
        sequence: Number.isFinite(m.sequence) ? m.sequence : 0,
        updatedAt: m.updatedAt || Date.now()
      };
      if (existing) {
        await reqToPromise(stores.messages.put(record));
      } else {
        const id = await reqToPromise(stores.messages.add(record));
        record.id = id;
      }
      upserted += 1;
    }

    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return { upserted };
  }

  async function syncConversationMessages(conversationId, messages) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readwrite");
    const idx = stores.messages.index("by_conversationId_messageKey");

    const presentKeys = new Set();
    let upserted = 0;

    for (const m of messages || []) {
      if (!m || !m.messageKey) continue;
      presentKeys.add(m.messageKey);
      const existing = await reqToPromise(idx.get([conversationId, m.messageKey]));
      const record = {
        id: existing ? existing.id : undefined,
        conversationId,
        messageKey: m.messageKey,
        role: m.role || "assistant",
        contentText: m.contentText || "",
        sequence: Number.isFinite(m.sequence) ? m.sequence : 0,
        updatedAt: m.updatedAt || Date.now()
      };
      if (existing) {
        await reqToPromise(stores.messages.put(record));
      } else {
        const id = await reqToPromise(stores.messages.add(record));
        record.id = id;
      }
      upserted += 1;
    }

    // Cleanup: delete messages that are no longer present in the captured snapshot.
    let deleted = 0;
    const seqIdx = stores.messages.index("by_conversationId_sequence");
    const range = IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]);
    const cursorReq = seqIdx.openCursor(range);
    await new Promise((resolve, reject) => {
      cursorReq.onerror = () => reject(cursorReq.error || new Error("cursor failed"));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const v = cursor.value;
        if (v && v.messageKey && !presentKeys.has(v.messageKey)) {
          cursor.delete();
          deleted += 1;
        }
        cursor.continue();
      };
    });

    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });

    return { upserted, deleted };
  }

  async function getConversations() {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readonly");
    const items = await reqToPromise(stores.conversations.getAll());
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    items.sort((a, b) => (b.lastCapturedAt || 0) - (a.lastCapturedAt || 0));
    return items;
  }

  async function getMessagesByConversationId(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readonly");
    const idx = stores.messages.index("by_conversationId_sequence");
    const items = await reqToPromise(idx.getAll(IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity])));
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return items;
  }

  async function deleteConversation(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "messages"], "readwrite");
    await reqToPromise(stores.conversations.delete(conversationId));

    // Delete messages for conversation by scanning index. OK for MVP scale.
    const idx = stores.messages.index("by_conversationId_sequence");
    const range = IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]);
    const cursorReq = idx.openCursor(range);
    await new Promise((resolve, reject) => {
      cursorReq.onerror = () => reject(cursorReq.error || new Error("cursor failed"));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
    });

    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return { deleted: true };
  }

  async function clearAll() {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "messages", "sync_mappings"], "readwrite");
    await Promise.all([
      reqToPromise(stores.conversations.clear()),
      reqToPromise(stores.messages.clear()),
      reqToPromise(stores.sync_mappings.clear())
    ]);
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return { cleared: true };
  }

  async function getConversationById(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readonly");
    const item = await reqToPromise(stores.conversations.get(conversationId));
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return item || null;
  }

  async function setConversationNotionPageId(conversationId, notionPageId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "sync_mappings"], "readwrite");
    const convo = await reqToPromise(stores.conversations.get(conversationId));
    if (!convo) throw new Error("conversation not found");
    convo.notionPageId = notionPageId || "";
    await reqToPromise(stores.conversations.put(convo));

    const idx = stores.sync_mappings.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([convo.source, convo.conversationKey]));
    const mapping = {
      id: existing ? existing.id : undefined,
      source: convo.source,
      conversationKey: convo.conversationKey,
      notionPageId: notionPageId || "",
      updatedAt: Date.now()
    };
    if (existing) await reqToPromise(stores.sync_mappings.put(mapping));
    else await reqToPromise(stores.sync_mappings.add(mapping));

    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return true;
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg.type !== "string") return err("invalid message");

    switch (msg.type) {
      case NOTION_MESSAGE_TYPES.GET_AUTH_STATUS: {
        const token = await (NS.notionTokenStore && NS.notionTokenStore.getToken ? NS.notionTokenStore.getToken() : Promise.resolve(null));
        return ok({ connected: !!(token && token.accessToken), token: token || null });
      }
      case NOTION_MESSAGE_TYPES.DISCONNECT: {
        await (NS.notionTokenStore && NS.notionTokenStore.clearToken ? NS.notionTokenStore.clearToken() : Promise.resolve());
        return ok({ disconnected: true });
      }
      case NOTION_MESSAGE_TYPES.ENSURE_DATABASES: {
        const token = await (NS.notionTokenStore && NS.notionTokenStore.getToken ? NS.notionTokenStore.getToken() : Promise.resolve(null));
        if (!token || !token.accessToken) return err("notion not connected");
        const parent = await new Promise((resolve) => {
          chrome.storage.local.get(["notion_parent_page_id"], (res) => resolve((res && res.notion_parent_page_id) || ""));
        });
        if (!parent) return err("missing parentPageId");
        if (!NS.notionDbManager || !NS.notionDbManager.ensureDatabasesForSources) return err("notion db manager missing");
        const mapping = await NS.notionDbManager.ensureDatabasesForSources({ accessToken: token.accessToken, parentPageId: parent });
        return ok(mapping);
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

        // Resolve sources up-front and ensure databases for them.
        const convos = [];
        const sourceSet = new Set();
        for (const id of ids) {
          const convo = await getConversationById(id);
          convos.push({ id, convo });
          if (convo && convo.source) sourceSet.add(convo.source);
        }
        if (!NS.notionDbManager || !NS.notionDbManager.ensureDatabasesForSources) return err("notion db manager missing");
        const mapping = await NS.notionDbManager.ensureDatabasesForSources({
          accessToken: token.accessToken,
          parentPageId: parent,
          sources: Array.from(sourceSet)
        });

        const results = [];
        for (const item of convos) {
          const id = item.id;
          const convo = item.convo;
          if (!convo) {
            results.push({ conversationId: id, ok: false, error: "conversation not found" });
            continue;
          }
          const dbId = mapping[convo.source] || "";
          if (!dbId) {
            results.push({ conversationId: id, ok: false, error: `unsupported source: ${convo.source}` });
            continue;
          }
          const messages = await getMessagesByConversationId(id);
          const blocks = NS.notionSyncService.messagesToBlocks(messages);
          try {
            let pageId = convo.notionPageId || "";
            if (pageId) {
              await NS.notionSyncService.updatePageProperties(token.accessToken, { pageId, title: convo.title, url: convo.url });
              await NS.notionSyncService.clearPageChildren(token.accessToken, pageId);
              await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
            } else {
              const created = await NS.notionSyncService.createPageInDatabase(token.accessToken, {
                databaseId: dbId,
                title: convo.title,
                url: convo.url
              });
              pageId = created && created.id ? created.id : "";
              if (!pageId) throw new Error("create page failed");
              await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
              await setConversationNotionPageId(id, pageId);
            }
            results.push({ conversationId: id, ok: true, notionPageId: pageId });
          } catch (e) {
            results.push({ conversationId: id, ok: false, error: e && e.message ? e.message : String(e) });
            // non-blocking: continue
          }
          // Basic pacing to reduce rate limiting when syncing in batch.
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
        const convo = await upsertConversation(payload);
        return ok(convo);
      }
      case MESSAGE_TYPES.UPSERT_MESSAGES_INCREMENTAL: {
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const res = await upsertMessagesIncremental(conversationId, msg.messages);
        return ok(res);
      }
      case MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES: {
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const res = await syncConversationMessages(conversationId, msg.messages);
        return ok(res);
      }
      case MESSAGE_TYPES.GET_CONVERSATIONS: {
        const items = await getConversations();
        return ok(items);
      }
      case MESSAGE_TYPES.GET_CONVERSATION_DETAIL: {
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const messages = await getMessagesByConversationId(conversationId);
        return ok({ conversationId, messages });
      }
      case MESSAGE_TYPES.DELETE_CONVERSATION: {
        const conversationId = Number(msg.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) return err("invalid conversationId");
        const res = await deleteConversation(conversationId);
        return ok(res);
      }
      case MESSAGE_TYPES.CLEAR_ALL: {
        const res = await clearAll();
        return ok(res);
      }
      default:
        return err(`unknown message type: ${msg.type}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    Promise.resolve()
      .then(() => handleMessage(msg))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse(err(e && e.message ? e.message : "unknown error", String(e))));
    return true;
  });

  async function exchangeNotionCodeForToken({ code }) {
    const cfg = NS.notionOAuthConfig && NS.notionOAuthConfig.getDefaults ? NS.notionOAuthConfig.getDefaults() : null;
    if (!cfg) throw new Error("notion oauth config missing");
    const client = NS.notionOAuthConfig && NS.notionOAuthConfig.loadClientConfig ? await NS.notionOAuthConfig.loadClientConfig() : { clientId: "", clientSecret: "" };
    if (!client.clientId || !client.clientSecret) throw new Error("notion clientId/clientSecret not configured");

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", code);
    form.set("redirect_uri", cfg.redirectUri);
    form.set("client_id", client.clientId);
    form.set("client_secret", client.clientSecret);

    const basic = btoa(`${client.clientId}:${client.clientSecret}`);
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basic}`
      },
      body: form.toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${text}`);
    const json = JSON.parse(text);
    if (!json || !json.access_token) throw new Error("no access_token in response");
    return json;
  }

  function parseQueryFromUrl(url) {
    try {
      const u = new URL(url);
      return {
        code: u.searchParams.get("code") || "",
        state: u.searchParams.get("state") || "",
        error: u.searchParams.get("error") || ""
      };
    } catch (_e) {
      return { code: "", state: "", error: "invalid_url" };
    }
  }

  async function handleNotionCallbackNavigation(details) {
    const cfg = NS.notionOAuthConfig && NS.notionOAuthConfig.getDefaults ? NS.notionOAuthConfig.getDefaults() : null;
    if (!cfg) return;
    const redirectBase = cfg.redirectUri;
    if (!details || !details.url || !details.url.startsWith(redirectBase)) return;

    const { code, state, error } = parseQueryFromUrl(details.url);
    if (error) {
      chrome.storage.local.set({ notion_oauth_last_error: error });
      return;
    }
    if (!code || !state) return;

    chrome.storage.local.get(["notion_oauth_pending_state"], async (res) => {
      const pending = (res && res.notion_oauth_pending_state) || "";
      if (!pending || pending !== state) return;

      try {
        const tokenJson = await exchangeNotionCodeForToken({ code });
        const token = {
          accessToken: tokenJson.access_token,
          workspaceId: tokenJson.workspace && tokenJson.workspace.id ? tokenJson.workspace.id : "",
          workspaceName: tokenJson.workspace && tokenJson.workspace.name ? tokenJson.workspace.name : "",
          createdAt: Date.now()
        };
        await (NS.notionTokenStore && NS.notionTokenStore.setToken ? NS.notionTokenStore.setToken(token) : Promise.resolve());
        chrome.storage.local.remove(["notion_oauth_pending_state"]);
        chrome.storage.local.set({ notion_oauth_last_error: "" });
        if (details.tabId >= 0 && chrome.tabs && chrome.tabs.remove) {
          chrome.tabs.remove(details.tabId);
        }
      } catch (e) {
        chrome.storage.local.set({ notion_oauth_last_error: e && e.message ? e.message : String(e) });
      }
    });
  }

  if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      handleNotionCallbackNavigation(details).catch(() => {});
    });
  }

  NS.__backgroundReady = true;
})();
