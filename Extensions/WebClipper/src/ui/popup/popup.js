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
  const obsidianSyncUi = NS.popupObsidianSync;
  const syncStateApi = NS.popupNotionSyncState;

	  if (!core || !tabs || !list || !chatPreview || !popupExport || !popupDelete || !notion || !notionAi || !database || !articleFetch || !inpageVisibility || !about) return;

  const { els, state, send, flashOk } = core;
  const contracts = NS.messageContracts || {};
  const notionTypes = contracts.NOTION_MESSAGE_TYPES || {
    SYNC_CONVERSATIONS: "notionSyncConversations",
    GET_SYNC_JOB_STATUS: "getNotionSyncJobStatus"
  };
  const obsidianTypes = contracts.OBSIDIAN_MESSAGE_TYPES || {
    SYNC_CONVERSATIONS: "obsidianSyncConversations",
    GET_SYNC_STATUS: "obsidianGetSyncStatus"
  };
  const uiEventTypes = contracts.UI_EVENT_TYPES || {
    CONVERSATIONS_CHANGED: "conversationsChanged"
  };
  const uiPortNames = contracts.UI_PORT_NAMES || {
    POPUP_EVENTS: "popup:events"
  };

  let syncPollTimer = 0;
  let obsidianSyncPollTimer = 0;
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
        els.btnSyncNotion.textContent = `Notion(${d}/${t})`;
      } else {
        els.btnSyncNotion.textContent = "Notion...";
      }
    } else {
      els.btnSyncNotion.textContent = "Notion";
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

  function setObsidianSyncingUi(isSyncing, { done, total } = {}) {
    if (!els.btnSyncObsidian) return;
    state.obsidianSyncInProgress = !!isSyncing;
    if (state.obsidianSyncInProgress) {
      els.btnSyncObsidian.disabled = true;
      const d = Number(done);
      const t = Number(total);
      if (Number.isFinite(d) && Number.isFinite(t) && t > 0) {
        els.btnSyncObsidian.textContent = `Obsidian(${d}/${t})`;
      } else {
        els.btnSyncObsidian.textContent = "Obsidian...";
      }
    } else {
      els.btnSyncObsidian.textContent = "Obsidian";
    }
  }

  function applyObsidianPerConversationResults(perConversation) {
    const api = NS.popupObsidianSyncState;
    if (!api || typeof api.applySyncResults !== "function") {
      if (!Array.isArray(perConversation) || !(state && state.obsidianSyncById instanceof Map)) return;
      const now = Date.now();
      for (const r of perConversation) {
        const conversationId = Number(r && r.conversationId);
        if (!Number.isFinite(conversationId) || conversationId <= 0) continue;
        const ok = !!(r && r.ok);
        state.obsidianSyncById.set(conversationId, {
          ok,
          mode: r && r.mode ? String(r.mode) : (ok ? "ok" : "fail"),
          appended: Number(r && r.appended),
          error: r && r.error ? String(r.error) : "",
          at: Number(r && r.at) || now
        });
      }
      return;
    }
    api.applySyncResults({
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

  async function refreshObsidianSyncStatus({ pollOnce } = {}) {
    const res = await send(obsidianTypes.GET_SYNC_STATUS);
    if (!res || !res.ok) return { ok: false };
    const job = res.data && res.data.job ? res.data.job : null;
    if (job && Array.isArray(job.perConversation)) {
      applyObsidianPerConversationResults(job.perConversation);
    }

    const isRunning = !!(job && job.status === "running");
    if (job) {
      const done = Array.isArray(job.perConversation) ? job.perConversation.length : 0;
      const total = Array.isArray(job.conversationIds) ? job.conversationIds.length : 0;
      setObsidianSyncingUi(isRunning, { done, total });
    } else if (!state.obsidianSyncInProgress) {
      setObsidianSyncingUi(false);
    }

    if (!isRunning && obsidianSyncPollTimer) {
      clearInterval(obsidianSyncPollTimer);
      obsidianSyncPollTimer = 0;
    }
    if (isRunning && !obsidianSyncPollTimer && !pollOnce) {
      obsidianSyncPollTimer = setInterval(() => {
        refreshObsidianSyncStatus({ pollOnce: true }).catch(() => {});
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

  function initObsidianSyncAction() {
    if (!els.btnSyncObsidian) return;
    els.btnSyncObsidian.addEventListener("click", async () => {
      const ids = list.getSelectedIds();
      if (!ids.length) return;
      if (state.obsidianSyncInProgress) return;

      const btn = els.btnSyncObsidian;
      const prevText = btn.textContent || "Obsidian";
      state.obsidianSyncInProgress = true;
      btn.disabled = true;
      btn.textContent = "Obsidian...";

      try {
        setObsidianSyncingUi(true, { done: 0, total: ids.length });
        refreshObsidianSyncStatus().catch(() => {});
        const res = await send(obsidianTypes.SYNC_CONVERSATIONS, { conversationIds: ids });
        if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "Sync failed.");

        const data = res.data || {};
        const okCount = data.okCount || 0;
        const failCount = data.failCount || 0;
        const failures = Array.isArray(data.failures) ? data.failures : [];
        const results = Array.isArray(data.results) ? data.results : [];
        applyObsidianPerConversationResults(results);
        try {
          list && typeof list.render === "function" && list.render();
        } catch (_e) {
          // ignore
        }

        if (failCount) {
          const lines = failures.slice(0, 6).map((f) => `- ${f.conversationId}: ${f.error || "unknown error"}`);
          alert(`Obsidian sync finished.\n\nOK: ${okCount}\nFailed: ${failCount}\n\n${lines.join("\n")}`);
        } else {
          flashOk(btn);
          alert(`Obsidian sync finished.\n\nOK: ${okCount}\nFailed: 0`);
        }
        flashOk(btn);
      } catch (e) {
        alert((e && e.message) || "Obsidian sync failed.");
      } finally {
        state.obsidianSyncInProgress = false;
        btn.textContent = prevText;
        btn.disabled = false;
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
      obsidianSyncUi && typeof obsidianSyncUi.init === "function" && obsidianSyncUi.init();
	    initObsidianSyncAction();
	    initNotionSyncAction();

    await tabs.init();
    await refreshSyncJobStatus();
    await refreshObsidianSyncStatus();
    await list.refresh();
    initConversationsEventsSubscription();

    window.addEventListener("unload", () => {
      if (syncPollTimer) clearInterval(syncPollTimer);
      if (obsidianSyncPollTimer) clearInterval(obsidianSyncPollTimer);
      try {
        conversationsEventsPort && conversationsEventsPort.disconnect && conversationsEventsPort.disconnect();
      } catch (_e) {
        // ignore
      }
      if (conversationsRefreshTimer) clearTimeout(conversationsRefreshTimer);
      syncPollTimer = 0;
      obsidianSyncPollTimer = 0;
      conversationsRefreshTimer = 0;
    });
  }

  init().catch((e) => {
    alert((e && e.message) || "Popup init failed.");
  });
})();
