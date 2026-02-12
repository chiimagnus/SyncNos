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
    btnSyncNotion: document.getElementById("btnSyncNotion"),
    btnNotionConnect: document.getElementById("btnNotionConnect"),
    notionStatus: document.getElementById("notionStatus"),
    notionClientId: document.getElementById("notionClientId"),
    notionClientSecret: document.getElementById("notionClientSecret"),
    btnNotionSaveConfig: document.getElementById("btnNotionSaveConfig"),
    notionPageQuery: document.getElementById("notionPageQuery"),
    btnNotionLoadPages: document.getElementById("btnNotionLoadPages"),
    notionPages: document.getElementById("notionPages"),
    btnNotionSaveParent: document.getElementById("btnNotionSaveParent")
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
  els.btnSyncNotion.addEventListener("click", async () => {
    const ids = getSelectedIds();
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
      alert(`Sync finished.\n\nOK: ${okCount}\nFailed: 0`);
    }
    await refresh();
  });

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

  async function getNotionAccessToken() {
    const status = await send("getNotionAuthStatus");
    if (!status || !status.ok || !status.data || !status.data.connected) return "";
    return status.data.token && status.data.token.accessToken ? status.data.token.accessToken : "";
  }

  async function ensureNotionApiLoaded() {
    if (globalThis.WebClipper && globalThis.WebClipper.notionApi) return globalThis.WebClipper.notionApi;
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("src/sync/notion/notion-api.js");
    document.documentElement.appendChild(s);
    await new Promise((r) => setTimeout(r, 80));
    return globalThis.WebClipper && globalThis.WebClipper.notionApi ? globalThis.WebClipper.notionApi : null;
  }

  async function loadParentPages() {
    const accessToken = await getNotionAccessToken();
    if (!accessToken) {
      alert("Notion not connected.");
      return;
    }
    const api = await ensureNotionApiLoaded();
    if (!api) {
      alert("Notion API module not available.");
      return;
    }
    const query = (els.notionPageQuery.value || "").trim();
    const result = await api.searchPages({ accessToken, query, pageSize: 20 });
    const pages = Array.isArray(result.results) ? result.results : [];

    els.notionPages.innerHTML = "";
    for (const p of pages) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = api.getPageTitle(p);
      els.notionPages.appendChild(opt);
    }

    // Preselect saved parent if present.
    const saved = await storageGet(["notion_parent_page_id"]);
    if (saved && saved.notion_parent_page_id) {
      els.notionPages.value = saved.notion_parent_page_id;
    }
  }

  async function saveParentPage() {
    const id = els.notionPages.value;
    const title = els.notionPages.selectedOptions && els.notionPages.selectedOptions[0] ? els.notionPages.selectedOptions[0].textContent : "";
    if (!id) return;
    await storageSet({ notion_parent_page_id: id, notion_parent_page_title: title || "" });
    alert(`Parent page selected: ${title || id}`);
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

  els.btnNotionLoadPages.addEventListener("click", () => {
    loadParentPages().catch((e) => alert(e && e.message ? e.message : String(e)));
  });

  els.btnNotionSaveParent.addEventListener("click", () => {
    saveParentPage().catch((e) => alert(e && e.message ? e.message : String(e)));
  });

  els.btnNotionConnect.addEventListener("click", async () => {
    // If connected, allow disconnect.
    const status = await send("getNotionAuthStatus");
    if (status && status.ok && status.data && status.data.connected) {
      await send("notionDisconnect");
      await refreshNotionStatus();
      return;
    }

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
  // Optional: attempt to refresh page list after connect, but don't auto prompt.

  async function refreshNotionStatus() {
    const res = await send("getNotionAuthStatus");
    if (!res || !res.ok || !res.data) {
      els.notionStatus.textContent = "";
      els.btnNotionConnect.textContent = "Connect";
      return;
    }
    if (res.data.connected) {
      const name = res.data.token && res.data.token.workspaceName ? res.data.token.workspaceName : "Connected";
      els.notionStatus.textContent = name;
      els.btnNotionConnect.textContent = "Disconnect";
    } else {
      els.notionStatus.textContent = "Not connected";
      els.btnNotionConnect.textContent = "Connect";
    }
  }

  refreshNotionStatus();
})();
