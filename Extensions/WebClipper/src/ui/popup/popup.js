(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const tabs = NS.popupTabs;
  const list = NS.popupList;
  const popupExport = NS.popupExport;
  const notion = NS.popupNotion;
  const about = NS.popupAbout;

  if (!core || !tabs || !list || !popupExport || !notion || !about) return;

  const { els, send, flashOk } = core;

  function initNotionSyncAction() {
    if (!els.btnSyncNotion) return;
    els.btnSyncNotion.addEventListener("click", async () => {
      const ids = list.getSelectedIds();
      if (!ids.length) return;
      const res = await send("notionSyncConversations", { conversationIds: ids });
      if (!res || !res.ok) {
        alert((res && res.error && res.error.message) || "Sync failed.");
        return;
      }
      const data = res.data || {};
      const okCount = data.okCount || 0;
      const failCount = data.failCount || 0;
      const failures = Array.isArray(data.failures) ? data.failures : [];
      if (failCount) {
        const lines = failures.slice(0, 6).map((f) => `- ${f.conversationId}: ${f.error || "unknown error"}`);
        alert(`Sync finished.\n\nOK: ${okCount}\nFailed: ${failCount}\n\n${lines.join("\n")}`);
      } else {
        flashOk(els.btnSyncNotion);
        alert(`Sync finished.\n\nOK: ${okCount}\nFailed: 0`);
      }
      await list.refresh();
    });
  }

  async function init() {
    list.init();
    popupExport.init();
    notion.init();
    about.init();
    initNotionSyncAction();

    await tabs.init();
    await list.refresh();
  }

  init().catch((e) => {
    alert((e && e.message) || "Popup init failed.");
  });
})();
