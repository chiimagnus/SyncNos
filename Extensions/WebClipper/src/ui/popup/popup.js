/* global chrome */

(function () {
  function send(type, payload) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => resolve(res)));
  }

  const els = {
    list: document.getElementById("list"),
    stats: document.getElementById("stats"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnClearAll: document.getElementById("btnClearAll"),
    chkSelectAll: document.getElementById("chkSelectAll"),
    btnExportJson: document.getElementById("btnExportJson"),
    btnExportMd: document.getElementById("btnExportMd")
  };

  const state = {
    conversations: [],
    selectedIds: new Set()
  };

  function formatTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch (_e) {
      return "";
    }
  }

  function hasWarningFlags(c) {
    return Array.isArray(c.warningFlags) && c.warningFlags.length > 0;
  }

  function render() {
    els.list.innerHTML = "";
    for (const c of state.conversations) {
      const row = document.createElement("div");
      row.className = "row";

      const left = document.createElement("label");
      left.className = "checkbox";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = state.selectedIds.has(c.id);
      chk.addEventListener("change", () => {
        if (chk.checked) state.selectedIds.add(c.id);
        else state.selectedIds.delete(c.id);
        syncSelectAllCheckbox();
      });
      left.appendChild(chk);

      const meta = document.createElement("div");
      meta.className = "meta";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = c.title || "(untitled)";
      if (hasWarningFlags(c)) {
        const pill = document.createElement("span");
        pill.className = "pill warn";
        pill.textContent = "warning";
        name.appendChild(pill);
      }
      meta.appendChild(name);

      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = `${c.source || ""} · ${formatTime(c.lastCapturedAt)}${c.url ? " · " + c.url : ""}`;
      meta.appendChild(sub);

      const right = document.createElement("div");
      right.className = "right";
      const del = document.createElement("button");
      del.className = "mini danger";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        await send("deleteConversation", { conversationId: c.id });
        state.selectedIds.delete(c.id);
        await refresh();
      });
      right.appendChild(del);

      row.appendChild(left);
      row.appendChild(meta);
      row.appendChild(right);

      els.list.appendChild(row);
    }

    els.stats.textContent = `${state.conversations.length} conversations`;
    syncSelectAllCheckbox();
  }

  function syncSelectAllCheckbox() {
    const total = state.conversations.length;
    const selected = state.selectedIds.size;
    els.chkSelectAll.indeterminate = selected > 0 && selected < total;
    els.chkSelectAll.checked = total > 0 && selected === total;
  }

  async function refresh() {
    const res = await send("getConversations");
    state.conversations = (res && res.ok && Array.isArray(res.data)) ? res.data : [];
    // Keep selection only for existing IDs
    const ids = new Set(state.conversations.map((c) => c.id));
    state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => ids.has(id)));
    render();
  }

  function getSelectedIds() {
    return Array.from(state.selectedIds);
  }

  async function exportJson() {
    // Placeholder: full export implemented in Task 7.
    const ids = getSelectedIds();
    if (!ids.length) return;
    const payload = { ids, exportedAt: Date.now() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: "webclipper-export.json", saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  async function exportMd() {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const text = `# WebClipper Export\n\n- conversations: ${ids.length}\n- exportedAt: ${new Date().toISOString()}\n`;
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: "webclipper-export.md", saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  els.btnRefresh.addEventListener("click", refresh);
  els.btnClearAll.addEventListener("click", async () => {
    await send("clearAll");
    state.selectedIds.clear();
    await refresh();
  });
  els.chkSelectAll.addEventListener("change", () => {
    if (els.chkSelectAll.checked) {
      for (const c of state.conversations) state.selectedIds.add(c.id);
    } else {
      state.selectedIds.clear();
    }
    render();
  });

  els.btnExportJson.addEventListener("click", exportJson);
  els.btnExportMd.addEventListener("click", exportMd);

  refresh();
})();

