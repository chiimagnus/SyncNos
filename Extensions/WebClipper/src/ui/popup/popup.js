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
	  const about = NS.popupAbout;

	  if (!core || !tabs || !list || !chatPreview || !popupExport || !popupDelete || !notion || !notionAi || !database || !about) return;

  const { els, state, send, flashOk } = core;

  let syncPollTimer = 0;

  function setSyncingUi(isSyncing) {
    if (!els.btnSyncNotion) return;
    state.notionSyncInProgress = !!isSyncing;
    if (state.notionSyncInProgress) {
      els.btnSyncNotion.disabled = true;
      els.btnSyncNotion.textContent = "Syncing...";
    } else {
      els.btnSyncNotion.textContent = "Sync";
    }
  }

  function applyPerConversationResults(perConversation) {
    if (!state || !state.notionSyncById) return;
    if (!Array.isArray(perConversation)) return;
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
  }

  async function refreshSyncJobStatus({ pollOnce } = {}) {
    const res = await send("getNotionSyncJobStatus");
    if (!res || !res.ok) return { ok: false };
    const job = res.data && res.data.job ? res.data.job : null;
    if (job && job.perConversation) applyPerConversationResults(job.perConversation);

    const isRunning = job && job.status === "running";
    setSyncingUi(!!isRunning);
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
      setSyncingUi(true);
      try {
        const res = await send("notionSyncConversations", { conversationIds: ids });
        if (!res || !res.ok) {
          alert((res && res.error && res.error.message) || "Sync failed.");
          return;
        }
        const data = res.data || {};
        const okCount = data.okCount || 0;
        const failCount = data.failCount || 0;
        const failures = Array.isArray(data.failures) ? data.failures : [];
        const results = Array.isArray(data.results) ? data.results : [];

        try {
          const now = Date.now();
          for (const r of results) {
            const conversationId = Number(r && r.conversationId);
            if (!Number.isFinite(conversationId) || conversationId <= 0) continue;
            const ok = !!(r && r.ok);
            state && state.notionSyncById && state.notionSyncById.set(conversationId, {
              ok,
              mode: r && r.mode ? String(r.mode) : (ok ? "ok" : "fail"),
              appended: Number(r && r.appended),
              error: r && r.error ? String(r.error) : "",
              at: now
            });
          }
        } catch (_e) {
          // ignore
        }

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

  async function init() {
    list.init();
    chatPreview.init();
	    popupExport.init();
	    popupDelete.init();
	    notion.init();
	    notionAi.init();
	    database.init();
	    about.init();
	    initNotionSyncAction();

    await tabs.init();
    await refreshSyncJobStatus();
    await list.refresh();
  }

  init().catch((e) => {
    alert((e && e.message) || "Popup init failed.");
  });
})();
