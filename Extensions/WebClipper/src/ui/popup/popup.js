/* global chrome */

(function () {
  function send(type, payload) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => resolve(res)));
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res || {})));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  const els = {
    list: document.getElementById("list"),
    stats: document.getElementById("stats"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnClearAll: document.getElementById("btnClearAll"),
    chkSelectAll: document.getElementById("chkSelectAll"),
    btnExportJson: document.getElementById("btnExportJson"),
    btnExportMd: document.getElementById("btnExportMd"),
    btnNotionConnect: document.getElementById("btnNotionConnect"),
    notionClientId: document.getElementById("notionClientId"),
    notionClientSecret: document.getElementById("notionClientSecret"),
    btnNotionSaveConfig: document.getElementById("btnNotionSaveConfig")
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
        const confirmed = confirm(`Delete conversation?\n\n${c.title || "(untitled)"}`);
        if (!confirmed) return;
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
    const ids = getSelectedIds();
    if (!ids.length) return;
    const selected = state.conversations.filter((c) => state.selectedIds.has(c.id));
    const items = [];
    for (const c of selected) {
      const detail = await send("getConversationDetail", { conversationId: c.id });
      items.push({
        conversation: c,
        messages: (detail && detail.ok && detail.data && Array.isArray(detail.data.messages)) ? detail.data.messages : []
      });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      count: items.length,
      items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    chrome.downloads.download({ url, filename: `webclipper-export-${stamp}.json`, saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  function conversationToMarkdown({ conversation, messages }) {
    const lines = [];
    lines.push(`# ${conversation.title || "(untitled)"}`);
    lines.push("");
    lines.push(`- Source: ${conversation.source || ""}`);
    if (conversation.url) lines.push(`- URL: ${conversation.url}`);
    if (conversation.lastCapturedAt) lines.push(`- CapturedAt: ${new Date(conversation.lastCapturedAt).toISOString()}`);
    if (hasWarningFlags(conversation)) lines.push(`- Warnings: ${(conversation.warningFlags || []).join(", ")}`);
    lines.push("");
    for (const m of messages || []) {
      const role = m.role || "assistant";
      lines.push(`## ${role}`);
      lines.push("");
      lines.push(String(m.contentText || ""));
      lines.push("");
    }
    return lines.join("\n");
  }

  async function exportMd() {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const selected = state.conversations.filter((c) => state.selectedIds.has(c.id));
    const docs = [];
    for (const c of selected) {
      const detail = await send("getConversationDetail", { conversationId: c.id });
      const messages = (detail && detail.ok && detail.data && Array.isArray(detail.data.messages)) ? detail.data.messages : [];
      docs.push(conversationToMarkdown({ conversation: c, messages }));
    }

    const text = docs.join("\n---\n\n");
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    chrome.downloads.download({ url, filename: `webclipper-export-${stamp}.md`, saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  els.btnRefresh.addEventListener("click", refresh);
  els.btnClearAll.addEventListener("click", async () => {
    const confirmed = confirm("Clear ALL conversations and messages?\n\nThis cannot be undone.");
    if (!confirmed) return;
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

  async function loadNotionConfig() {
    const res = await storageGet(["notion_oauth_client_id", "notion_oauth_client_secret"]);
    els.notionClientId.value = res.notion_oauth_client_id || "";
    els.notionClientSecret.value = res.notion_oauth_client_secret || "";
  }

  async function saveNotionConfig() {
    await storageSet({
      notion_oauth_client_id: els.notionClientId.value || "",
      notion_oauth_client_secret: els.notionClientSecret.value || ""
    });
  }

  function buildNotionAuthorizeUrl({ clientId, state }) {
    const redirectUri = "https://chiimagnus.github.io/syncnos-oauth/callback";
    const url = new URL("https://api.notion.com/v1/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  els.btnNotionSaveConfig.addEventListener("click", async () => {
    await saveNotionConfig();
    alert("Saved Notion OAuth client config.");
  });

  els.btnNotionConnect.addEventListener("click", async () => {
    const clientId = (els.notionClientId.value || "").trim();
    if (!clientId) {
      alert("Please set Notion Client ID first.");
      return;
    }
    // Save config before starting auth.
    await saveNotionConfig();
    // Persist state so background can validate callback.
    const state = `webclipper_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    await storageSet({ notion_oauth_pending_state: state });
    const url = buildNotionAuthorizeUrl({ clientId, state });
    window.open(url, "_blank", "noopener,noreferrer");
    alert("Notion auth opened in a new tab. Complete authorization, then return here.");
  });

  loadNotionConfig();
})();
