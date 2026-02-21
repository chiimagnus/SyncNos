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

  const { els, send, flashOk } = core;

  function initNotionSyncAction() {
    if (!els.btnSyncNotion) return;
    els.btnSyncNotion.addEventListener("click", async () => {
      const ids = list.getSelectedIds();
      if (!ids.length) return;
      const btn = els.btnSyncNotion;
      const prevText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Syncing...";
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
        btn.textContent = prevText;
        btn.disabled = false;
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
    await list.refresh();
  }

  init().catch((e) => {
    alert((e && e.message) || "Popup init failed.");
  });
})();
