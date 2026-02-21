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
    SYNC_CONVERSATIONS: "notionSyncConversations",
    GET_SYNC_JOB_STATUS: "getNotionSyncJobStatus"
  });

  const NOTION_SYNC_JOB_KEY = "notion_sync_job_v1";

  function ok(data) {
    return { ok: true, data, error: null };
  }

  function err(message, extra) {
    return { ok: false, data: null, error: { message, extra: extra || null } };
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res || {})));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  async function getNotionSyncJob() {
    try {
      const res = await storageGet([NOTION_SYNC_JOB_KEY]);
      const job = res && res[NOTION_SYNC_JOB_KEY] ? res[NOTION_SYNC_JOB_KEY] : null;
      return job && typeof job === "object" ? job : null;
    } catch (_e) {
      return null;
    }
  }

  async function setNotionSyncJob(job) {
    try {
      await storageSet({ [NOTION_SYNC_JOB_KEY]: job || null });
      return true;
    } catch (_e) {
      return false;
    }
  }

  function isRunningJob(job) {
    if (!job || typeof job !== "object") return false;
    if (job.status !== "running") return false;
    const updatedAt = Number(job.updatedAt) || 0;
    if (!updatedAt) return true;
    // Stale guard: treat as not running after 20 minutes without updates.
    return (Date.now() - updatedAt) < 20 * 60 * 1000;
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
      case NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS: {
        const job = await getNotionSyncJob();
        return ok({ job });
      }
      case NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS: {
        const existingJob = await getNotionSyncJob();
        if (isRunningJob(existingJob)) return err("sync already in progress");

        const token = await (NS.notionTokenStore && NS.notionTokenStore.getToken ? NS.notionTokenStore.getToken() : Promise.resolve(null));
        if (!token || !token.accessToken) return err("notion not connected");
        const parent = await new Promise((resolve) => {
          chrome.storage.local.get(["notion_parent_page_id"], (res) => resolve((res && res.notion_parent_page_id) || ""));
        });
        if (!parent) return err("missing parentPageId");
        const ids = Array.isArray(msg.conversationIds) ? msg.conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : [];
        if (!ids.length) return err("no conversationIds");
        if (!NS.notionSyncService) return err("notion sync service missing");

        if (!NS.notionDbManager || !NS.notionDbManager.ensureDatabase) return err("notion db manager missing");
        const db = await NS.notionDbManager.ensureDatabase({ accessToken: token.accessToken, parentPageId: parent });
        const dbId = db && db.databaseId ? db.databaseId : "";
        if (!dbId) return err("missing databaseId");

        function toConvoLabel(convo) {
          if (!convo) return "(missing conversation)";
          const t = convo.title || "";
          return t ? `"${t}"` : `conversation#${convo.id || "?"}`;
        }

        function extractCursor(mapping) {
          const m = mapping && typeof mapping === "object" ? mapping : {};
          const lastSyncedMessageKey = (m.lastSyncedMessageKey && String(m.lastSyncedMessageKey).trim()) ? String(m.lastSyncedMessageKey).trim() : "";
          const lastSyncedSequence = Number(m.lastSyncedSequence);
          const seq = Number.isFinite(lastSyncedSequence) ? lastSyncedSequence : null;
          return { lastSyncedMessageKey, lastSyncedSequence: seq };
        }

        function computeNewMessages(messages, cursor) {
          const list = Array.isArray(messages) ? messages : [];
          if (!list.length) return { ok: true, mode: "empty", newMessages: [], rebuild: false };
          const key = cursor && cursor.lastSyncedMessageKey ? String(cursor.lastSyncedMessageKey) : "";
          const seq = cursor && Number.isFinite(cursor.lastSyncedSequence) ? Number(cursor.lastSyncedSequence) : null;

          if (key) {
            const idx = list.findIndex((m) => m && String(m.messageKey || "") === key);
            if (idx < 0) return { ok: false, mode: "cursor_missing", newMessages: [], rebuild: true };
            return { ok: true, mode: "append", newMessages: list.slice(idx + 1), rebuild: false };
          }

          if (seq != null) {
            const next = list.filter((m) => m && Number(m.sequence) > seq);
            return { ok: true, mode: "append", newMessages: next, rebuild: false };
          }

          return { ok: false, mode: "cursor_missing", newMessages: [], rebuild: true };
        }

        function lastMessageCursor(messages) {
          const list = Array.isArray(messages) ? messages : [];
          if (!list.length) return { lastSyncedMessageKey: "", lastSyncedSequence: null, lastSyncedAt: Date.now() };
          const last = list[list.length - 1];
          const key = last && last.messageKey ? String(last.messageKey) : "";
          const seq = Number(last && last.sequence);
          return {
            lastSyncedMessageKey: key,
            lastSyncedSequence: Number.isFinite(seq) ? seq : null,
            lastSyncedAt: Date.now()
          };
        }

        const results = [];
        const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const jobStartedAt = Date.now();
        await setNotionSyncJob({
          id: jobId,
          status: "running",
          startedAt: jobStartedAt,
          updatedAt: jobStartedAt,
          conversationIds: ids,
          perConversation: []
        });

        for (const id of ids) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const mapped = await (storage.getSyncMappingByConversation ? storage.getSyncMappingByConversation(id) : Promise.resolve(null));
            const convo = mapped && mapped.conversation ? mapped.conversation : null;
            const mapping = mapped && mapped.mapping ? mapped.mapping : null;
            if (!convo) {
              results.push({ conversationId: id, ok: false, error: "conversation not found" });
              continue;
            }

            // eslint-disable-next-line no-await-in-loop
            const messages = await storage.getMessagesByConversationId(id);
            const cursor = extractCursor(mapping);

            let pageId = "";
            if (mapping && mapping.notionPageId) pageId = String(mapping.notionPageId || "");
            if (!pageId && convo.notionPageId) pageId = String(convo.notionPageId || "");

            let page = null;
            let pageUsable = false;
            if (pageId) {
              try {
                // eslint-disable-next-line no-await-in-loop
                page = await NS.notionSyncService.getPage(token.accessToken, pageId);
                pageUsable = NS.notionSyncService.isPageUsableForDatabase
                  ? NS.notionSyncService.isPageUsableForDatabase(page, dbId)
                  : NS.notionSyncService.pageBelongsToDatabase(page, dbId);
              } catch (_e) {
                pageUsable = false;
              }
              if (!pageUsable) pageId = "";
            }

            if (!pageId) {
              // Create new page (first sync or page missing/deleted/trashed).
              // eslint-disable-next-line no-await-in-loop
              const created = await NS.notionSyncService.createPageInDatabase(token.accessToken, {
                databaseId: dbId,
                title: convo.title,
                url: convo.url,
                ai: convo.source
              });
              pageId = created && created.id ? created.id : "";
              if (!pageId) throw new Error("create page failed");
              // eslint-disable-next-line no-await-in-loop
              await storage.setConversationNotionPageId(id, pageId);

              const blocks = NS.notionSyncService.messagesToBlocks(messages, { source: convo.source });
              if (blocks.length) {
                // eslint-disable-next-line no-await-in-loop
                await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
              }
              const nextCursor = lastMessageCursor(messages);
              if (storage.setSyncCursor) {
                // eslint-disable-next-line no-await-in-loop
                await storage.setSyncCursor(id, nextCursor);
              }
              results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "created", appended: messages.length });
              // eslint-disable-next-line no-await-in-loop
              await new Promise((r) => setTimeout(r, 250));
              continue;
            }

            // Page exists and is usable.
            // eslint-disable-next-line no-await-in-loop
            await NS.notionSyncService.updatePageProperties(token.accessToken, {
              pageId,
              title: convo.title,
              url: convo.url,
              ai: convo.source
            });

            const inc = computeNewMessages(messages, cursor);
            if (inc.rebuild) {
              if (!messages.length) throw new Error(`missing cursor for ${toConvoLabel(convo)} and no local messages to rebuild`);
              // Force clear & rebuild (cursor missing or not found).
              // eslint-disable-next-line no-await-in-loop
              await NS.notionSyncService.clearPageChildren(token.accessToken, pageId);
              const blocks = NS.notionSyncService.messagesToBlocks(messages, { source: convo.source });
              if (blocks.length) {
                // eslint-disable-next-line no-await-in-loop
                await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
              }
              const nextCursor = lastMessageCursor(messages);
              if (storage.setSyncCursor) {
                // eslint-disable-next-line no-await-in-loop
                await storage.setSyncCursor(id, nextCursor);
              }
              results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "rebuilt", appended: messages.length });
            } else if (inc.newMessages && inc.newMessages.length) {
              const blocks = NS.notionSyncService.messagesToBlocks(inc.newMessages, { source: convo.source });
              if (blocks.length) {
                // eslint-disable-next-line no-await-in-loop
                await NS.notionSyncService.appendChildren(token.accessToken, pageId, blocks);
              }
              const nextCursor = lastMessageCursor(messages);
              if (storage.setSyncCursor) {
                // eslint-disable-next-line no-await-in-loop
                await storage.setSyncCursor(id, nextCursor);
              }
              results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "appended", appended: inc.newMessages.length });
            } else {
              // No new messages.
              const nextCursor = lastMessageCursor(messages);
              if (storage.setSyncCursor) {
                // eslint-disable-next-line no-await-in-loop
                await storage.setSyncCursor(id, nextCursor);
              }
              results.push({ conversationId: id, ok: true, notionPageId: pageId, mode: "no_changes", appended: 0 });
            }
          } catch (e) {
            results.push({ conversationId: id, ok: false, error: e && e.message ? e.message : String(e) });
          }

          // Best-effort job status update for popup re-open.
          try {
            // eslint-disable-next-line no-await-in-loop
            await setNotionSyncJob({
              id: jobId,
              status: "running",
              startedAt: jobStartedAt,
              updatedAt: Date.now(),
              conversationIds: ids,
              perConversation: results.map((r) => ({
                conversationId: r.conversationId,
                ok: !!r.ok,
                mode: r.mode || (r.ok ? "ok" : "fail"),
                appended: Number(r.appended) || 0,
                error: r.error || "",
                at: Date.now()
              }))
            });
          } catch (_e) {
            // ignore
          }

          // Basic pacing to reduce rate limiting when syncing in batch.
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 250));
        }

        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        const failures = results.filter((r) => !r.ok);
        await setNotionSyncJob({
          id: jobId,
          status: "done",
          startedAt: jobStartedAt,
          updatedAt: Date.now(),
          finishedAt: Date.now(),
          conversationIds: ids,
          okCount,
          failCount,
          perConversation: results.map((r) => ({
            conversationId: r.conversationId,
            ok: !!r.ok,
            mode: r.mode || (r.ok ? "ok" : "fail"),
            appended: Number(r.appended) || 0,
            error: r.error || "",
            at: Date.now()
          }))
        });
        return ok({ results, okCount, failCount, failures, jobId });
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
  // Test hook (Node/Vitest). In extension runtime this is unused.
  NS.backgroundRouter.__handleMessageForTests = handleMessage;
  if (typeof module !== "undefined" && module.exports) module.exports = NS.backgroundRouter;
})();
