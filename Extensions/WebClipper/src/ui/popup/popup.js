/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const runtime = NS.runtimeClient && typeof NS.runtimeClient.createRuntimeClient === "function"
    ? NS.runtimeClient.createRuntimeClient()
    : null;

  function toErrorMessage(err, fallback) {
    if (!err) return fallback || "Unknown error";
    if (err instanceof Error) return err.message || fallback || "Unknown error";
    if (typeof err === "string") return err;
    return String(err);
  }

  function send(type, payload) {
    if (!runtime || typeof runtime.send !== "function") {
      return Promise.resolve({ ok: false, data: null, error: { message: "runtime client unavailable", extra: null } });
    }
    return runtime.send(type, payload).catch((e) => {
      return { ok: false, data: null, error: { message: toErrorMessage(e, "runtime.sendMessage failed"), extra: null } };
    });
  }

  function storageGet(keys) {
    const normalized = (() => {
      if (typeof keys === "string") return keys;
      if (Array.isArray(keys)) return keys.filter((k) => typeof k === "string" && k);
      if (keys && typeof keys === "object") return keys;
      return [];
    })();
    return new Promise((resolve) => chrome.storage.local.get(normalized, (res) => resolve(res || {})));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  const flashTimers = new WeakMap();

  function flashOk(el, durationMs) {
    if (!el) return;
    const ms = typeof durationMs === "number" ? durationMs : 1400;
    const prev = flashTimers.get(el);
    if (prev) clearTimeout(prev);
    el.classList.add("is-flash-ok");
    const t = setTimeout(() => {
      el.classList.remove("is-flash-ok");
      flashTimers.delete(el);
    }, ms);
    flashTimers.set(el, t);
  }

  const els = {
    list: document.getElementById("list"),
    stats: document.getElementById("stats"),
    tabChats: document.getElementById("tabChats"),
	    tabSettings: document.getElementById("tabSettings"),
	    viewChats: document.getElementById("viewChats"),
	    viewSettings: document.getElementById("viewSettings"),
	    chkSelectAll: document.getElementById("chkSelectAll"),
	    btnExport: document.getElementById("btnExport"),
	    exportMenu: document.getElementById("exportMenu"),
	    menuExportSingleMarkdown: document.getElementById("menuExportSingleMarkdown"),
	    menuExportMultiMarkdown: document.getElementById("menuExportMultiMarkdown"),
	    menuExportJsons: document.getElementById("menuExportJsons"),
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

	  const STORAGE_KEYS = {
	    popupActiveTab: "popup_active_tab"
	  };

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

	  function setActiveTab(tabId) {
	    const next = tabId === "settings" ? "settings" : "chats";

    if (els.tabChats) {
      const active = next === "chats";
      els.tabChats.classList.toggle("is-active", active);
      els.tabChats.setAttribute("aria-selected", active ? "true" : "false");
      els.tabChats.tabIndex = active ? 0 : -1;
    }

    if (els.tabSettings) {
      const active = next === "settings";
      els.tabSettings.classList.toggle("is-active", active);
      els.tabSettings.setAttribute("aria-selected", active ? "true" : "false");
      els.tabSettings.tabIndex = active ? 0 : -1;
    }

    if (els.viewChats) els.viewChats.classList.toggle("is-active", next === "chats");
    if (els.viewSettings) els.viewSettings.classList.toggle("is-active", next === "settings");

    storageSet({ [STORAGE_KEYS.popupActiveTab]: next }).catch(() => {});
  }

  function onTabKeyDown(e) {
    if (!e) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? "settings" : "chats";
    setActiveTab(next);
    const el = next === "settings" ? els.tabSettings : els.tabChats;
    if (el && typeof el.focus === "function") el.focus();
  }

  function formatTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch (_e) {
      return "";
    }
  }

  function isSameLocalDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
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
      sub.textContent = `${c.source || ""} · ${formatTime(c.lastCapturedAt)}`;
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

    const total = state.conversations.length;
    const now = new Date();
    const today = state.conversations.filter((c) => {
      if (!c || !c.lastCapturedAt) return false;
      try {
        return isSameLocalDay(new Date(c.lastCapturedAt), now);
      } catch (_e) {
        return false;
      }
    }).length;
    els.stats.textContent = `today:${today}\n total:${total}`;
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
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonFilename = `webclipper-export-${stamp}.json`;
    const zipBlob = await createZipBlob([
      { name: jsonFilename, data: JSON.stringify(payload, null, 2) }
    ]);
    downloadBlob({ blob: zipBlob, filename: `webclipper-export-${stamp}.zip`, saveAs: false });
    flashOk(els.btnExport);
  }

  function sanitizeFilenamePart(input, fallback) {
    const text = String(input || "").trim();
    if (!text) return fallback;
    const cleaned = text
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.slice(0, 80) || fallback;
  }

  function downloadBlob({ blob, filename, saveAs }) {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: typeof saveAs === "boolean" ? saveAs : false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  async function createZipBlob(files) {
    const api = (globalThis.WebClipper && globalThis.WebClipper.zipUtils) || null;
    if (!api || typeof api.createZipBlob !== "function") {
      throw new Error("ZIP module not available");
    }
    return api.createZipBlob(files);
  }

  function conversationToMarkdown({ conversation, messages }) {
    if (conversation && conversation.sourceType === "article") {
      const api = (globalThis.WebClipper && globalThis.WebClipper.articleMarkdown) || null;
      if (api && typeof api.formatArticleMarkdown === "function") {
        return api.formatArticleMarkdown({ conversation, messages });
      }
    }
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

  async function exportMd({ mergeSingle }) {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const selected = state.conversations.filter((c) => state.selectedIds.has(c.id));
    const docs = [];
    for (const c of selected) {
      const detail = await send("getConversationDetail", { conversationId: c.id });
      const messages = (detail && detail.ok && detail.data && Array.isArray(detail.data.messages)) ? detail.data.messages : [];
      docs.push({ conversation: c, markdown: conversationToMarkdown({ conversation: c, messages }) });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = [];

    if (mergeSingle) {
      const text = docs.map((d) => d.markdown).join("\n---\n\n");
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

  els.chkSelectAll.addEventListener("change", () => {
    if (els.chkSelectAll.checked) {
      for (const c of state.conversations) state.selectedIds.add(c.id);
    } else {
      state.selectedIds.clear();
    }
    render();
  });

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
    const t = e && e.target ? e.target : null;
    if (t && ((els.exportMenu && els.exportMenu.contains(t)) || (els.btnExport && els.btnExport.contains(t)))) return;
    closeExportMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (!isExportMenuOpen()) return;
    if (e && e.key === "Escape") closeExportMenu();
  });

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
      flashOk(els.btnSyncNotion);
      alert(`Sync finished.\n\nOK: ${okCount}\nFailed: 0`);
    }
    await refresh();
  });

  if (els.tabChats) {
    els.tabChats.addEventListener("click", () => setActiveTab("chats"));
    els.tabChats.addEventListener("keydown", onTabKeyDown);
  }
  if (els.tabSettings) {
    els.tabSettings.addEventListener("click", () => setActiveTab("settings"));
    els.tabSettings.addEventListener("keydown", onTabKeyDown);
  }

  (async () => {
    const saved = await storageGet([STORAGE_KEYS.popupActiveTab]);
    setActiveTab(saved[STORAGE_KEYS.popupActiveTab] || "chats");
  })();

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
    const url = runtime && typeof runtime.getURL === "function" ? runtime.getURL("src/sync/notion/notion-api.js") : "";
    if (!url) return null;
    s.src = url;
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
    flashOk(els.btnNotionSaveConfig);
  });

  els.btnNotionLoadPages.addEventListener("click", () => {
    loadParentPages()
      .then(() => flashOk(els.btnNotionLoadPages))
      .catch((e) => alert(e && e.message ? e.message : String(e)));
  });

  els.btnNotionSaveParent.addEventListener("click", () => {
    saveParentPage()
      .then(() => flashOk(els.btnNotionSaveParent))
      .catch((e) => alert(e && e.message ? e.message : String(e)));
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
