/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const tabs = NS.popupTabs;
  const list = NS.popupList;
  const chatPreview = NS.popupChatPreview;
	  const popupExport = NS.popupExport;
	  const popupDelete = NS.popupDelete;
  const notion = NS.popupNotion;
  const notionAi = NS.popupNotionAi;
  const database = NS.popupDatabase;
  const articleFetch = NS.popupArticleFetch;
  const inpageVisibility = NS.popupInpageVisibility;
  const about = NS.popupAbout;
  const docsApi = NS.popupConversationDocs;
  const obsidianApi = NS.popupObsidian;
  const syncStateApi = NS.popupNotionSyncState;

	  if (!core || !tabs || !list || !chatPreview || !popupExport || !popupDelete || !notion || !notionAi || !database || !articleFetch || !inpageVisibility || !about) return;

  const { els, state, send, flashOk, copyTextToClipboard } = core;
  const contracts = NS.messageContracts || {};
  const notionTypes = contracts.NOTION_MESSAGE_TYPES || {
    SYNC_CONVERSATIONS: "notionSyncConversations",
    GET_SYNC_JOB_STATUS: "getNotionSyncJobStatus"
  };
  const obsidianTypes = contracts.OBSIDIAN_MESSAGE_TYPES || {
    OPEN_URL: "openObsidianUrl"
  };
  const uiEventTypes = contracts.UI_EVENT_TYPES || {
    CONVERSATIONS_CHANGED: "conversationsChanged"
  };
  const uiPortNames = contracts.UI_PORT_NAMES || {
    POPUP_EVENTS: "popup:events"
  };

  let syncPollTimer = 0;
  let conversationsEventsPort = null;
  let conversationsRefreshTimer = 0;
  let conversationsRefreshInFlight = false;
  let conversationsRefreshPending = false;

  function scheduleConversationsRefresh(delayMs) {
    if (conversationsRefreshTimer) return;
    conversationsRefreshTimer = setTimeout(() => {
      conversationsRefreshTimer = 0;
      if (conversationsRefreshInFlight) {
        conversationsRefreshPending = true;
        return;
      }
      conversationsRefreshInFlight = true;
      Promise.resolve()
        .then(() => list && typeof list.refresh === "function" ? list.refresh() : null)
        .catch(() => {})
        .finally(() => {
          conversationsRefreshInFlight = false;
          if (conversationsRefreshPending) {
            conversationsRefreshPending = false;
            scheduleConversationsRefresh(60);
          }
        });
    }, Number.isFinite(delayMs) ? delayMs : 180);
  }

  function requestConversationsRefresh(delayMs) {
    if (conversationsRefreshInFlight) {
      conversationsRefreshPending = true;
      return;
    }
    scheduleConversationsRefresh(delayMs);
  }

  function initConversationsEventsSubscription() {
    try {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.connect !== "function") return false;
      conversationsEventsPort = chrome.runtime.connect({ name: uiPortNames.POPUP_EVENTS });
    } catch (_e) {
      conversationsEventsPort = null;
      return false;
    }
    if (!conversationsEventsPort) return false;

    try {
      conversationsEventsPort.onMessage.addListener((msg) => {
        if (!msg || typeof msg.type !== "string") return;
        if (msg.type !== uiEventTypes.CONVERSATIONS_CHANGED) return;
        requestConversationsRefresh(160);
      });
    } catch (_e) {
      // ignore
    }

    try {
      conversationsEventsPort.onDisconnect.addListener(() => {
        conversationsEventsPort = null;
        if (conversationsRefreshTimer) clearTimeout(conversationsRefreshTimer);
        conversationsRefreshTimer = 0;
        conversationsRefreshPending = false;
      });
    } catch (_e) {
      // ignore
    }

    return true;
  }

  function setSyncingUi(isSyncing, { done, total } = {}) {
    if (!els.btnSyncNotion) return;
    state.notionSyncInProgress = !!isSyncing;
    if (state.notionSyncInProgress) {
      els.btnSyncNotion.disabled = true;
      const d = Number(done);
      const t = Number(total);
      if (Number.isFinite(d) && Number.isFinite(t) && t > 0) {
        els.btnSyncNotion.textContent = `Syncing(${d}/${t})`;
      } else {
        els.btnSyncNotion.textContent = "Syncing...";
      }
    } else {
      els.btnSyncNotion.textContent = "Sync";
    }
  }

  function applyPerConversationResults(perConversation) {
    if (!syncStateApi || typeof syncStateApi.applySyncResults !== "function") {
      if (!Array.isArray(perConversation) || !(state && state.notionSyncById instanceof Map)) return;
      const now = Date.now();
      for (const r of perConversation) {
        const conversationId = Number(r && r.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) continue;
        const ok = !!(r && r.ok);
        state.notionSyncById.set(conversationId, {
          ok,
          mode: r && r.mode ? String(r.mode) : (ok ? "ok" : "fail"),
          appended: Number(r && r.appended),
          error: r && r.error ? String(r.error) : "",
          at: Number(r && r.at) || now
        });
      }
      try {
        list && typeof list.render === "function" && list.render();
      } catch (_e) {
        // ignore
      }
      return;
    }
    syncStateApi.applySyncResults({
      rows: perConversation,
      state,
      onChanged: () => {
        try {
          list && typeof list.render === "function" && list.render();
        } catch (_e) {
          // ignore
        }
      }
    });
  }

  async function buildObsidianPayloads(selectedIds) {
    if (!docsApi || typeof docsApi.buildConversationDocs !== "function") {
      throw new Error("Conversation docs module not available.");
    }
    if (!obsidianApi || typeof obsidianApi.createObsidianPayloads !== "function") {
      throw new Error("Obsidian module not available.");
    }
    const docs = await docsApi.buildConversationDocs({ selectedIds });
    return obsidianApi.createObsidianPayloads(docs);
  }

  async function refreshSyncJobStatus({ pollOnce } = {}) {
    const res = await send(notionTypes.GET_SYNC_JOB_STATUS);
    if (!res || !res.ok) return { ok: false };
    const job = res.data && res.data.job ? res.data.job : null;
    if (job && job.perConversation) applyPerConversationResults(job.perConversation);

    const isRunning = !!(job && job.status === "running");
    if (job) {
      const done = Array.isArray(job.perConversation) ? job.perConversation.length : 0;
      const total = Array.isArray(job.conversationIds) ? job.conversationIds.length : 0;
      setSyncingUi(isRunning, { done, total });
    } else if (!state.notionSyncInProgress) {
      setSyncingUi(false);
    }
    if (!isRunning && syncPollTimer) {
      clearInterval(syncPollTimer);
      syncPollTimer = 0;
    }
    if (isRunning && !syncPollTimer && !pollOnce) {
      syncPollTimer = setInterval(() => {
        refreshSyncJobStatus({ pollOnce: true }).catch(() => {});
      }, 1000);
    }
    return { ok: true, job };
  }

  function initNotionSyncAction() {
    if (!els.btnSyncNotion) return;
    els.btnSyncNotion.addEventListener("click", async () => {
      const ids = list.getSelectedIds();
      if (!ids.length) return;
      const btn = els.btnSyncNotion;
      const prevText = btn.textContent;
      setSyncingUi(true, { done: 0, total: ids.length });
      refreshSyncJobStatus().catch(() => {});
      try {
        const res = await send(notionTypes.SYNC_CONVERSATIONS, { conversationIds: ids });
        if (!res || !res.ok) {
          alert((res && res.error && res.error.message) || "Sync failed.");
          return;
        }
        const data = res.data || {};
        const okCount = data.okCount || 0;
        const failCount = data.failCount || 0;
        const failures = Array.isArray(data.failures) ? data.failures : [];
        const results = Array.isArray(data.results) ? data.results : [];

        applyPerConversationResults(results);

        if (failCount) {
          const lines = failures.slice(0, 6).map((f) => `- ${f.conversationId}: ${f.error || "unknown error"}`);
          alert(`Sync finished.\n\nOK: ${okCount}\nFailed: ${failCount}\n\n${lines.join("\n")}`);
        } else {
          flashOk(btn);
          const summaryLines = results.slice(0, 6).map((r) => {
            const mode = r && r.mode ? String(r.mode) : "ok";
            const appended = Number(r && r.appended);
            const suffix = Number.isFinite(appended) ? ` (${appended})` : "";
            return `- ${r.conversationId}: ${mode}${suffix}`;
          });
          const extra = summaryLines.length ? `\n\n${summaryLines.join("\n")}` : "";
          alert(`Sync finished.\n\nOK: ${okCount}\nFailed: 0${extra}`);
        }
      } finally {
        // If popup closes mid-sync, background will still update the job status.
        state.notionSyncInProgress = false;
        btn.textContent = prevText;
        btn.disabled = false;
        await refreshSyncJobStatus({ pollOnce: true });
        await list.refresh();
      }
    });
  }

  function initObsidianAction() {
    if (!els.btnAddObsidian) return;
    els.btnAddObsidian.addEventListener("click", async () => {
      const ids = list.getSelectedIds();
      if (!ids.length) return;
      if (state.obsidianAddInProgress) return;

      const btn = els.btnAddObsidian;
      const prevText = btn.textContent || "Obsidian";
      state.obsidianAddInProgress = true;
      btn.disabled = true;
      btn.textContent = "Adding...";

      try {
        if (!obsidianApi || typeof obsidianApi.buildObsidianNewUrl !== "function") {
          throw new Error("Obsidian module not available.");
        }
        const payloads = await buildObsidianPayloads(ids);
        if (!payloads.length) throw new Error("No conversations selected.");

        let res = null;
        if (payloads.length === 1) {
          const payload = payloads[0];
          let useClipboard = false;
          try {
            await copyTextToClipboard(payload.markdown);
            useClipboard = true;
          } catch (_e) {
            // fallback to URI `content` mode
            useClipboard = false;
          }
          const url = obsidianApi.buildObsidianNewUrl({
            noteName: payload.noteName,
            markdown: payload.markdown,
            useClipboard,
            folder: payload.folder
          });
          res = await send(obsidianTypes.OPEN_URL, { url });
        } else {
          const urls = payloads.map((payload) => obsidianApi.buildObsidianNewUrl({
            noteName: payload.noteName,
            markdown: payload.markdown,
            useClipboard: false,
            folder: payload.folder
          }));
          res = await send(obsidianTypes.OPEN_URL, { urls });
        }
        if (!res || !res.ok) {
          throw new Error((res && res.error && res.error.message) || "Open Obsidian failed.");
        }
        flashOk(btn);
      } catch (e) {
        alert((e && e.message) || "Add to Obsidian failed.");
      } finally {
        state.obsidianAddInProgress = false;
        btn.textContent = prevText;
        try {
          list && typeof list.render === "function" && list.render();
        } catch (_e) {
          // ignore
        }
      }
    });
  }

  async function init() {
    list.init();
    chatPreview.init();
	    popupExport.init();
	    popupDelete.init();
	    notion.init();
	    notionAi.init();
	    database.init();
      articleFetch.init();
      inpageVisibility.init();
	    about.init();
	    initObsidianAction();
	    initNotionSyncAction();

    await tabs.init();
    await refreshSyncJobStatus();
    await list.refresh();
    initConversationsEventsSubscription();

    window.addEventListener("unload", () => {
      if (syncPollTimer) clearInterval(syncPollTimer);
      try {
        conversationsEventsPort && conversationsEventsPort.disconnect && conversationsEventsPort.disconnect();
      } catch (_e) {
        // ignore
      }
      if (conversationsRefreshTimer) clearTimeout(conversationsRefreshTimer);
      syncPollTimer = 0;
      conversationsRefreshTimer = 0;
    });
  }

  init().catch((e) => {
    alert((e && e.message) || "Popup init failed.");
  });
})();
