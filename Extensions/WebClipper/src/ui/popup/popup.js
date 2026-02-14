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
    tabAbout: document.getElementById("tabAbout"),
    tabIndicator: document.querySelector(".tabs .tabIndicator"),
    viewChats: document.getElementById("viewChats"),
    viewSettings: document.getElementById("viewSettings"),
    viewAbout: document.getElementById("viewAbout"),
    chkSelectAll: document.getElementById("chkSelectAll"),
    btnExport: document.getElementById("btnExport"),
    exportMenu: document.getElementById("exportMenu"),
    menuExportSingleMarkdown: document.getElementById("menuExportSingleMarkdown"),
    menuExportMultiMarkdown: document.getElementById("menuExportMultiMarkdown"),
    menuExportJsons: document.getElementById("menuExportJsons"),
    btnSyncNotion: document.getElementById("btnSyncNotion"),
    btnNotionConnect: document.getElementById("btnNotionConnect"),
    notionAuthCard: document.getElementById("notionAuthCard"),
    notionStatusTitle: document.getElementById("notionStatusTitle"),
    btnNotionLoadPages: document.getElementById("btnNotionLoadPages"),
    notionPages: document.getElementById("notionPages"),
    aboutVersion: document.getElementById("aboutVersion"),
    btnAboutMacApp: document.getElementById("btnAboutMacApp"),
    btnAboutSource: document.getElementById("btnAboutSource"),
    btnAboutChangelog: document.getElementById("btnAboutChangelog"),
    btnAboutMail: document.getElementById("btnAboutMail"),
    btnAboutGitHub: document.getElementById("btnAboutGitHub")
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

  const TAB_IDS = ["chats", "settings", "about"];

  function normalizeTabId(tabId) {
    return TAB_IDS.includes(tabId) ? tabId : "chats";
  }

  function setTabButtonState({ el, active }) {
    if (!el) return;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
    el.tabIndex = active ? 0 : -1;
  }

  function updateTabIndicator(tabId) {
    const tabsEl = (els.tabChats && els.tabChats.closest) ? els.tabChats.closest(".tabs") : null;
    if (!tabsEl) return;
    const normalized = normalizeTabId(tabId);
    const idx = Math.max(0, TAB_IDS.indexOf(normalized));
    tabsEl.style.setProperty("--tab-i", String(idx));
  }

  function setActiveTab(tabId) {
    const next = normalizeTabId(tabId);

    setTabButtonState({ el: els.tabChats, active: next === "chats" });
    setTabButtonState({ el: els.tabSettings, active: next === "settings" });
    setTabButtonState({ el: els.tabAbout, active: next === "about" });
    updateTabIndicator(next);

    if (els.viewChats) els.viewChats.classList.toggle("is-active", next === "chats");
    if (els.viewSettings) els.viewSettings.classList.toggle("is-active", next === "settings");
    if (els.viewAbout) els.viewAbout.classList.toggle("is-active", next === "about");

    storageSet({ [STORAGE_KEYS.popupActiveTab]: next }).catch(() => {});
  }

  function activeTabIdFromDom() {
    const tabsEl = (els.tabChats && els.tabChats.closest) ? els.tabChats.closest(".tabs") : null;
    if (!tabsEl) return "chats";
    const active = tabsEl.querySelector(".tab.is-active");
    if (!active) return "chats";
    if (active.id === "tabSettings") return "settings";
    if (active.id === "tabAbout") return "about";
    return "chats";
  }

  function clamp(num, min, max) {
    return Math.min(max, Math.max(min, num));
  }

  function indicatorValueForClientX({ tabsEl, clientX }) {
    const rect = tabsEl.getBoundingClientRect();
    const styles = getComputedStyle(tabsEl);
    const segPad = parseFloat(styles.getPropertyValue("--seg-pad")) || 0;
    const segCount = TAB_IDS.length || 3;
    const innerWidth = Math.max(1, rect.width - segPad * 2);
    const segWidth = innerWidth / segCount;
    const x = clientX - rect.left;
    // Align thumb to pointer center: middle of first segment => 0, middle of second => 1, etc.
    const raw = (x - segPad) / segWidth - 0.5;
    return clamp(raw, 0, segCount - 1);
  }

  function setIndicatorValue(tabsEl, value) {
    tabsEl.style.setProperty("--tab-i", String(value));
  }

  function initTabsDrag() {
    const tabsEl = (els.tabChats && els.tabChats.closest) ? els.tabChats.closest(".tabs") : null;
    if (!tabsEl) return;

    const drag = {
      pending: false,
      dragging: false,
      pointerId: null,
      startX: 0
    };

    function stopDragging({ snap }) {
      if (!drag.pending && !drag.dragging) return;
      if (drag.pointerId != null) {
        try { tabsEl.releasePointerCapture(drag.pointerId); } catch (_e) {}
      }
      tabsEl.classList.remove("is-dragging");
      const currentValue = parseFloat(getComputedStyle(tabsEl).getPropertyValue("--tab-i")) || 0;
      drag.pending = false;
      drag.dragging = false;
      drag.pointerId = null;

      if (snap) {
        const idx = clamp(Math.round(currentValue), 0, TAB_IDS.length - 1);
        setActiveTab(TAB_IDS[idx]);
      } else {
        updateTabIndicator(activeTabIdFromDom());
      }
    }

    tabsEl.addEventListener("pointerdown", (e) => {
      if (!e || e.button !== 0) return;
      drag.pending = true;
      drag.dragging = false;
      drag.pointerId = e.pointerId;
      drag.startX = e.clientX;
    });

    tabsEl.addEventListener("pointermove", (e) => {
      if (!drag.pending || drag.pointerId !== e.pointerId) return;
      const dx = Math.abs(e.clientX - drag.startX);
      if (!drag.dragging && dx < 4) return;

      if (!drag.dragging) {
        drag.dragging = true;
        tabsEl.classList.add("is-dragging");
        try { tabsEl.setPointerCapture(e.pointerId); } catch (_err) {}
      }

      e.preventDefault();
      const v = indicatorValueForClientX({ tabsEl, clientX: e.clientX });
      setIndicatorValue(tabsEl, v);
    });

    tabsEl.addEventListener("pointerup", (e) => {
      if (!drag.pending || drag.pointerId !== e.pointerId) return;
      if (drag.dragging) {
        e.preventDefault();
        stopDragging({ snap: true });
      } else {
        // Let normal click handlers run.
        stopDragging({ snap: false });
      }
    });

    tabsEl.addEventListener("pointercancel", (e) => {
      if (!drag.pending || drag.pointerId !== e.pointerId) return;
      stopDragging({ snap: false });
    });

    tabsEl.addEventListener("lostpointercapture", () => {
      if (!drag.pending && !drag.dragging) return;
      stopDragging({ snap: true });
    });
  }

  function onTabKeyDown(e) {
    if (!e) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = normalizeTabId((document.activeElement && document.activeElement.id === "tabSettings")
      ? "settings"
      : (document.activeElement && document.activeElement.id === "tabAbout")
        ? "about"
        : "chats");
    const idx = TAB_IDS.indexOf(current);
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = TAB_IDS[(idx + dir + TAB_IDS.length) % TAB_IDS.length];
    setActiveTab(next);
    const el = next === "settings" ? els.tabSettings : next === "about" ? els.tabAbout : els.tabChats;
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

  function getSourceMeta(raw) {
    const text = String(raw || "").trim();
    if (!text) return { key: "unknown", label: "" };
    const normalized = text.toLowerCase().replace(/[\s_-]+/g, "");
    const map = {
      chatgpt: { key: "chatgpt", label: "ChatGPT" },
      claude: { key: "claude", label: "Claude" },
      deepseek: { key: "deepseek", label: "DeepSeek" },
      notionai: { key: "notionai", label: "Notion AI" },
      gemini: { key: "gemini", label: "Gemini" },
      kimi: { key: "kimi", label: "Kimi" },
      doubao: { key: "doubao", label: "Doubao" },
      yuanbao: { key: "yuanbao", label: "Yuanbao" }
    };
    return map[normalized] || { key: "unknown", label: text };
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
      const sourceRaw = c.sourceName || c.source || "";
      const { key: sourceKey, label: sourceLabel } = getSourceMeta(sourceRaw);

      const sourceTag = document.createElement("span");
      sourceTag.className = `sourceTag sourceTag--${sourceKey}`;
      sourceTag.textContent = sourceLabel;
      sub.appendChild(sourceTag);

      const timeLabel = formatTime(c.lastCapturedAt);
      if (timeLabel) {
        const divider = document.createElement("span");
        divider.className = "metaDivider";
        divider.textContent = " \u00b7 ";
        sub.appendChild(divider);

        const time = document.createElement("span");
        time.className = "timeLabel";
        time.textContent = timeLabel;
        sub.appendChild(time);
      }
      meta.appendChild(sub);

      row.appendChild(left);
      row.appendChild(meta);

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
    renderStats({ today, total });
    syncSelectAllCheckbox();
  }

  function renderStats({ today, total }) {
    if (!els.stats) return;
    els.stats.textContent = "";

    const todayLabel = document.createElement("span");
    todayLabel.className = "statsLabel";
    todayLabel.textContent = "Today:";

    const todayValue = document.createElement("span");
    todayValue.className = "todayCount";
    todayValue.textContent = String(today);

    const divider = document.createElement("span");
    divider.className = "statsDivider";
    divider.textContent = " \u00b7 ";

    const totalLabel = document.createElement("span");
    totalLabel.className = "statsLabel";
    totalLabel.textContent = "Total:";

    const totalValue = document.createElement("span");
    totalValue.className = "totalCount";
    totalValue.textContent = String(total);

    els.stats.appendChild(todayLabel);
    els.stats.appendChild(todayValue);
    els.stats.appendChild(divider);
    els.stats.appendChild(totalLabel);
    els.stats.appendChild(totalValue);
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
    lines.push(`- Source: ${getSourceMeta(conversation.sourceName || conversation.source || "").label}`);
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
  if (els.tabAbout) {
    els.tabAbout.addEventListener("click", () => setActiveTab("about"));
    els.tabAbout.addEventListener("keydown", onTabKeyDown);
  }

  (async () => {
    const saved = await storageGet([STORAGE_KEYS.popupActiveTab]);
    setActiveTab(normalizeTabId(saved[STORAGE_KEYS.popupActiveTab] || "chats"));
  })();

  initTabsDrag();
  refresh();

  function openUrl(url) {
    if (!url) return;
    try {
      chrome.tabs.create({ url: String(url) });
    } catch (_e) {
      // ignore
    }
  }

  function initAbout() {
    const m = chrome && chrome.runtime && typeof chrome.runtime.getManifest === "function" ? chrome.runtime.getManifest() : null;
    const version = m && m.version ? m.version : "";
    const name = m && m.name ? m.name : "SyncNos WebClipper";
    if (els.aboutVersion) {
      els.aboutVersion.textContent = version ? `Version ${version}` : "Version";
      els.aboutVersion.title = name;
    }

    if (els.btnAboutSource) els.btnAboutSource.addEventListener("click", () => openUrl("https://github.com/chiimagnus/SyncNos"));
    if (els.btnAboutChangelog) els.btnAboutChangelog.addEventListener("click", () => openUrl("https://chiimagnus.notion.site/syncnos-changelog"));
    if (els.btnAboutMacApp) els.btnAboutMacApp.addEventListener("click", () => openUrl("https://apps.apple.com/app/syncnos/id6755133888"));
    if (els.btnAboutGitHub) els.btnAboutGitHub.addEventListener("click", () => openUrl("https://github.com/chiimagnus"));
    if (els.btnAboutMail) els.btnAboutMail.addEventListener("click", () => openUrl("mailto:chii_magnus@outlook.com?subject=%5BSyncNos%20WebClipper%5D%20Feedback"));
  }

  initAbout();

  async function getNotionOAuthMeta() {
    const res = await storageGet(["notion_oauth_last_error", "notion_oauth_pending_state"]);
    return {
      lastError: (res && res.notion_oauth_last_error) ? String(res.notion_oauth_last_error) : "",
      pendingState: (res && res.notion_oauth_pending_state) ? String(res.notion_oauth_pending_state) : ""
    };
  }

  async function getNotionOAuthClientId() {
    const res = await storageGet(["notion_oauth_client_id"]);
    return (res && res.notion_oauth_client_id) ? String(res.notion_oauth_client_id).trim() : "";
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
    const result = await api.searchPages({ accessToken, query: "", pageSize: 50 });
    const pagesRaw = Array.isArray(result.results) ? result.results : [];
    const withoutDatabaseEntries = pagesRaw.filter((p) => !(p && p.parent && p.parent.type === "database_id"));
    const rootPages = withoutDatabaseEntries.filter((p) => p && p.parent && p.parent.type === "workspace");
    const pages = rootPages.length ? rootPages : withoutDatabaseEntries;

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

  if (els.btnNotionLoadPages) {
    els.btnNotionLoadPages.addEventListener("click", () => {
      loadParentPages()
        .then(() => flashOk(els.btnNotionLoadPages))
        .catch((e) => alert(e && e.message ? e.message : String(e)));
    });
  }

  if (els.notionPages) {
    els.notionPages.addEventListener("change", () => {
      saveParentPage().catch(() => {});
    });
  }

  let notionConnectPollTimer = null;
  let notionParentPagesLoaded = false;

  function setNotionConnectBusy(busy) {
    if (!els.btnNotionConnect) return;
    els.btnNotionConnect.disabled = !!busy;
    els.btnNotionConnect.dataset.busy = busy ? "1" : "0";
  }

  async function openNotionAuthorizeTab(url) {
    if (!url) return false;
    try {
      if (chrome && chrome.tabs && typeof chrome.tabs.create === "function") {
        await new Promise((resolve) => chrome.tabs.create({ url: String(url) }, () => resolve(true)));
        return true;
      }
    } catch (_e) {
      // ignore
    }
    try {
      window.open(String(url), "_blank", "noopener,noreferrer");
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function saveNotionReturnTarget() {
    try {
      if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== "function") return;
      const tab = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(Array.isArray(tabs) ? tabs[0] : null));
      });
      const tabId = tab && Number.isFinite(tab.id) ? tab.id : null;
      const windowId = tab && Number.isFinite(tab.windowId) ? tab.windowId : null;
      const payload = {};
      if (tabId != null) payload.notion_oauth_return_tab_id = tabId;
      if (windowId != null) payload.notion_oauth_return_window_id = windowId;
      if (Object.keys(payload).length) await storageSet(payload);
    } catch (_e) {
      // ignore
    }
  }

  function startNotionConnectPolling() {
    if (notionConnectPollTimer) clearInterval(notionConnectPollTimer);
    const startedAt = Date.now();
    notionConnectPollTimer = setInterval(() => {
      if (Date.now() - startedAt > 60_000) {
        stopNotionConnectPolling();
        return;
      }
      refreshNotionStatus().catch(() => {});
    }, 750);
  }

  function stopNotionConnectPolling() {
    if (!notionConnectPollTimer) return;
    clearInterval(notionConnectPollTimer);
    notionConnectPollTimer = null;
  }

  function setNotionParentControlsEnabled(enabled) {
    const on = !!enabled;
    if (els.btnNotionLoadPages) els.btnNotionLoadPages.disabled = !on;
    if (els.notionPages) els.notionPages.disabled = !on;
  }

  if (els.btnNotionConnect) {
    els.btnNotionConnect.addEventListener("click", async () => {
    // If connected, allow disconnect.
    const status = await send("getNotionAuthStatus");
    if (status && status.ok && status.data && status.data.connected) {
      await send("notionDisconnect");
      await refreshNotionStatus();
      return;
    }

    const clientId = await getNotionOAuthClientId();
    if (!clientId) {
      alert("Notion OAuth client is not configured.");
      await refreshNotionStatus();
      return;
    }
    // Persist state so background can validate callback.
    const state = `webclipper_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    await storageSet({ notion_oauth_pending_state: state });
    await saveNotionReturnTarget();
    const url = buildNotionAuthorizeUrl({ clientId, state });
    setNotionConnectBusy(true);
    if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Connecting…";
    const opened = await openNotionAuthorizeTab(url);
    if (!opened) {
      setNotionConnectBusy(false);
      alert("Failed to open Notion OAuth tab. Please check your browser popup settings.");
      await refreshNotionStatus();
      return;
    }
    if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Authorize in Notion";
    startNotionConnectPolling();
  });
  }

  // Optional: attempt to refresh page list after connect, but don't auto prompt.

  async function refreshNotionStatus() {
    const res = await send("getNotionAuthStatus");
    const meta = await getNotionOAuthMeta();
    if (!res || !res.ok || !res.data) {
      if (els.notionAuthCard) els.notionAuthCard.classList.remove("is-connected");
      if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Not connected";
      els.btnNotionConnect.textContent = "Connect";
      setNotionParentControlsEnabled(false);
      setNotionConnectBusy(false);
      stopNotionConnectPolling();
      notionParentPagesLoaded = false;
      if (els.notionPages) els.notionPages.innerHTML = "";
      return;
    }
    if (res.data.connected) {
      const workspaceName = (res.data.token && res.data.token.workspaceName) ? String(res.data.token.workspaceName).trim() : "";
      if (els.notionAuthCard) els.notionAuthCard.classList.add("is-connected");
      const showWorkspace = workspaceName && workspaceName.toLowerCase() !== "connected";
      if (els.notionStatusTitle) els.notionStatusTitle.textContent = showWorkspace ? `Connected ✅ (${workspaceName})` : "Connected ✅";
      els.btnNotionConnect.textContent = "Disconnect";
      setNotionParentControlsEnabled(true);
      setNotionConnectBusy(false);
      stopNotionConnectPolling();

      if (!notionParentPagesLoaded) {
        notionParentPagesLoaded = true;
        loadParentPages().catch(() => {});
      }
    } else {
      if (meta && meta.lastError) {
        if (els.notionAuthCard) els.notionAuthCard.classList.remove("is-connected");
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Error";
        // Keep UI compact: show "Error" in header and notify once.
        if (!refreshNotionStatus.__lastAlert || refreshNotionStatus.__lastAlert !== meta.lastError) {
          refreshNotionStatus.__lastAlert = meta.lastError;
          alert(`Notion OAuth error: ${meta.lastError}`);
        }
      } else if (meta && meta.pendingState) {
        if (els.notionAuthCard) els.notionAuthCard.classList.remove("is-connected");
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Waiting…";
      } else {
        if (els.notionAuthCard) els.notionAuthCard.classList.remove("is-connected");
        if (els.notionStatusTitle) els.notionStatusTitle.textContent = "Not connected";
      }
      els.btnNotionConnect.textContent = "Connect";
      setNotionParentControlsEnabled(false);
      setNotionConnectBusy(false);
      notionParentPagesLoaded = false;
    }
  }

  refreshNotionStatus();
})();
