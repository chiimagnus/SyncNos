(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const list = NS.popupList;
  if (!core || !list) return;

  const {
    els,
    state,
    send,
    flashOk,
    sanitizeFilenamePart,
    createZipBlob,
    downloadBlob,
    conversationToMarkdown
  } = core;

  function isExportMenuOpen() {
    return !!(els.exportMenu && !els.exportMenu.hidden);
  }

  function closeExportMenu() {
    if (els.exportMenu) els.exportMenu.hidden = true;
    if (els.btnExport) els.btnExport.setAttribute("aria-expanded", "false");
  }

  function openExportMenu() {
    if (els.exportMenu) els.exportMenu.hidden = false;
    if (els.btnExport) els.btnExport.setAttribute("aria-expanded", "true");
  }

  async function exportJson() {
    const ids = list.getSelectedIds();
    if (!ids.length) return;
    const selected = state.conversations.filter((conversation) => state.selectedIds.has(conversation.id));
    const items = [];
    for (const conversation of selected) {
      const detail = await send("getConversationDetail", { conversationId: conversation.id });
      items.push({
        conversation,
        messages: (detail && detail.ok && detail.data && Array.isArray(detail.data.messages)) ? detail.data.messages : []
      });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      count: items.length,
      items
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonFilename = `webclipper-export-${stamp}.json`;
    const zipBlob = await createZipBlob([
      { name: jsonFilename, data: JSON.stringify(payload, null, 2) }
    ]);
    downloadBlob({ blob: zipBlob, filename: `webclipper-export-${stamp}.zip`, saveAs: false });
    flashOk(els.btnExport);
  }

  async function exportMd({ mergeSingle }) {
    const ids = list.getSelectedIds();
    if (!ids.length) return;
    const selected = state.conversations.filter((conversation) => state.selectedIds.has(conversation.id));
    const docs = [];
    for (const conversation of selected) {
      const detail = await send("getConversationDetail", { conversationId: conversation.id });
      const messages = (detail && detail.ok && detail.data && Array.isArray(detail.data.messages)) ? detail.data.messages : [];
      docs.push({ conversation, markdown: conversationToMarkdown({ conversation, messages }) });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = [];

    if (mergeSingle) {
      const text = docs.map((doc) => doc.markdown).join("\n---\n\n");
      files.push({ name: `webclipper-export-${stamp}.md`, data: text });
    } else {
      for (let i = 0; i < docs.length; i += 1) {
        const item = docs[i];
        const conversation = item.conversation || {};
        const source = sanitizeFilenamePart(conversation.source || "unknown", "unknown");
        const title = sanitizeFilenamePart(conversation.title || "untitled", "untitled");
        const file = `webclipper-${source}-${title}-${i + 1}-${stamp}.md`;
        files.push({ name: file, data: item.markdown });
      }
    }

    const zipBlob = await createZipBlob(files);
    downloadBlob({ blob: zipBlob, filename: `webclipper-export-${stamp}.zip`, saveAs: false });
    flashOk(els.btnExport);
  }

  function safeExportSingleMarkdown() {
    exportMd({ mergeSingle: true }).catch((e) => {
      alert((e && e.message) || "Export Markdown failed.");
    });
  }

  function safeExportMultiMarkdown() {
    exportMd({ mergeSingle: false }).catch((e) => {
      alert((e && e.message) || "Export Markdown failed.");
    });
  }

  function safeExportJsons() {
    exportJson().catch((e) => {
      alert((e && e.message) || "Export JSON failed.");
    });
  }

  function init() {
    if (els.btnExport) {
      els.btnExport.addEventListener("click", (e) => {
        if (!e) return;
        e.preventDefault();
        if (isExportMenuOpen()) closeExportMenu();
        else openExportMenu();
      });
    }

    if (els.menuExportSingleMarkdown) {
      els.menuExportSingleMarkdown.addEventListener("click", () => {
        closeExportMenu();
        safeExportSingleMarkdown();
      });
    }

    if (els.menuExportMultiMarkdown) {
      els.menuExportMultiMarkdown.addEventListener("click", () => {
        closeExportMenu();
        safeExportMultiMarkdown();
      });
    }

    if (els.menuExportJsons) {
      els.menuExportJsons.addEventListener("click", () => {
        closeExportMenu();
        safeExportJsons();
      });
    }

    document.addEventListener("click", (e) => {
      if (!isExportMenuOpen()) return;
      const target = e && e.target ? e.target : null;
      if (target && ((els.exportMenu && els.exportMenu.contains(target)) || (els.btnExport && els.btnExport.contains(target)))) return;
      closeExportMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (!isExportMenuOpen()) return;
      if (e && e.key === "Escape") closeExportMenu();
    });
  }

  NS.popupExport = {
    init
  };
})();
