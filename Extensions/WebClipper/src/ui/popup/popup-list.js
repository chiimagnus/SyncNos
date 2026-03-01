(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const {
    els,
    state,
    send,
    storageGet,
    storageSet,
    PREVIEW_EVENTS,
    formatTime,
    getSourceMeta,
    hasWarningFlags,
    isSameLocalDay,
    copyTextToClipboard,
    conversationToMarkdown
  } = core;
  const previewEvents = PREVIEW_EVENTS || {
    click: "popup:conversation-click"
  };
  const syncStateApi = NS.popupNotionSyncState;
  const obsidianSyncStateApi = NS.popupObsidianSyncState;
  const contracts = NS.messageContracts || {};
  const obsidianTypes = contracts.OBSIDIAN_MESSAGE_TYPES || {
    SYNC_CONVERSATIONS: "obsidianSyncConversations"
  };

  const copyFeedbackTimers = new WeakMap();

  const FILTER_KEY = (core && core.STORAGE_KEYS && core.STORAGE_KEYS.popupSourceFilterKey)
    ? core.STORAGE_KEYS.popupSourceFilterKey
    : "popup_source_filter_key";
  let filterLoaded = false;

  function normalizeSourceKey(conversation) {
    const sourceRaw = conversation && (conversation.sourceName || conversation.source) ? (conversation.sourceName || conversation.source) : "";
    const meta = getSourceMeta(sourceRaw);
    return meta && meta.key ? String(meta.key) : "unknown";
  }

  function applySourceFilter(conversations, { sourceKey } = {}) {
    const list = Array.isArray(conversations) ? conversations : [];
    const key = (sourceKey != null ? String(sourceKey) : "").trim().toLowerCase();
    if (!key || key === "all") return list;
    return list.filter((c) => normalizeSourceKey(c) === key);
  }

  function getFilterLabelForKey(key) {
    const k = String(key || "all").toLowerCase();
    if (k === "all") return "All";
    try {
      const meta = getSourceMeta(k);
      if (meta && meta.label) return String(meta.label);
    } catch (_e) {
      // ignore
    }
    return k;
  }

  function getAvailableSourceOptions(conversations) {
    const items = Array.isArray(conversations) ? conversations : [];
    const map = new Map();
    for (const c of items) {
      const k = normalizeSourceKey(c);
      if (!k) continue;
      const label = getFilterLabelForKey(k);
      map.set(k, { key: k, label });
    }
    const opts = Array.from(map.values());
    opts.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return [{ key: "all", label: "All" }, ...opts];
  }

  function renderFilterOptions() {
    if (!els.sourceFilterSelect) return;
    els.sourceFilterSelect.replaceChildren();
    const options = getAvailableSourceOptions(state.allConversations);
    const current = String(state.sourceFilterKey || "all").toLowerCase();
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = String(opt.key);
      option.textContent = opt.label;
      if (String(opt.key).toLowerCase() === current) option.selected = true;
      els.sourceFilterSelect.appendChild(option);
    }
  }

  async function setSourceFilterKey(key) {
    const next = (key != null ? String(key) : "all").trim().toLowerCase() || "all";
    state.sourceFilterKey = next;
    state.selectedIds.clear();
    syncActionButtons();
    syncSelectAllCheckbox();
    try {
      if (typeof storageSet === "function") await storageSet({ [FILTER_KEY]: next });
    } catch (_e) {
      // ignore
    }
    state.conversations = applySourceFilter(state.allConversations, { sourceKey: state.sourceFilterKey });
    renderFilterOptions();
    if (els.sourceFilterSelect) els.sourceFilterSelect.value = state.sourceFilterKey;
    render();
  }

  function showCopiedFeedback(buttonEl, { baseText, baseTitle } = {}) {
    if (!buttonEl) return;
    const prevTimer = copyFeedbackTimers.get(buttonEl);
    if (prevTimer) clearTimeout(prevTimer);

    const restoreText = baseText != null ? String(baseText) : String(buttonEl.textContent || "");
    const restoreTitle = baseTitle != null ? String(baseTitle) : String(buttonEl.title || "");
    buttonEl.classList.add("is-copied");
    buttonEl.textContent = "✓";
    buttonEl.title = "Copied";

    const t = setTimeout(() => {
      buttonEl.classList.remove("is-copied");
      buttonEl.textContent = restoreText;
      buttonEl.title = restoreTitle;
      copyFeedbackTimers.delete(buttonEl);
    }, 1100);
    copyFeedbackTimers.set(buttonEl, t);
  }

  async function getMessagesForConversation(conversationId) {
    if (!(state.previewCache instanceof Map)) state.previewCache = new Map();
    const cached = state.previewCache.get(conversationId);
    if (cached && Array.isArray(cached.messages)) return cached.messages;

    const res = await send("getConversationDetail", { conversationId });
    if (!res || !res.ok) {
      throw new Error((res && res.error && res.error.message) || "Failed to load messages.");
    }
    const messages = (res && res.data && Array.isArray(res.data.messages)) ? res.data.messages : [];
    state.previewCache.set(conversationId, { messages, fetchedAt: Date.now() });
    return messages;
  }

  function dispatchPreviewEvent(type, detail) {
    if (!els.list) return;
    els.list.dispatchEvent(new CustomEvent(type, { detail }));
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
    divider.textContent = " · ";

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
    if (!els.chkSelectAll) return;
    const total = state.conversations.length;
    const selected = state.selectedIds.size;
    els.chkSelectAll.indeterminate = selected > 0 && selected < total;
    els.chkSelectAll.checked = total > 0 && selected === total;
  }

  function syncActionButtons() {
    const hasSelection = state.selectedIds.size > 0;
    if (els.chatBottomBar) els.chatBottomBar.classList.toggle("hasSelection", hasSelection);

    if (els.btnExport) els.btnExport.disabled = !hasSelection;
    if (els.btnSyncObsidian) els.btnSyncObsidian.disabled = !hasSelection || !!state.obsidianSyncInProgress;
    if (els.btnSyncNotion) els.btnSyncNotion.disabled = !hasSelection || !!state.notionSyncInProgress;
    if (els.btnDelete) els.btnDelete.disabled = !hasSelection;

    if (!hasSelection) {
      if (els.exportMenu) els.exportMenu.hidden = true;
      if (els.btnExport) els.btnExport.setAttribute("aria-expanded", "false");
      const deleteApi = NS.popupDelete;
      if (deleteApi && typeof deleteApi.reset === "function") deleteApi.reset();
    }
  }

  function render() {
    if (!els.list) return;
    els.list.replaceChildren();
    for (const conversation of state.conversations) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.conversationId = String(conversation.id);
      row.setAttribute("aria-label", conversation.title || "(untitled)");

      const left = document.createElement("label");
      left.className = "checkbox";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedIds.has(conversation.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedIds.add(conversation.id);
        else state.selectedIds.delete(conversation.id);
        syncSelectAllCheckbox();
        syncActionButtons();
      });
      left.appendChild(checkbox);

      const meta = document.createElement("div");
      meta.className = "meta";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = conversation.title || "(untitled)";
      if (hasWarningFlags(conversation)) {
        const pill = document.createElement("span");
        pill.className = "pill warn";
        pill.textContent = "warning";
        name.appendChild(pill);
      }

      try {
        const syncInfo = state && state.notionSyncById && typeof state.notionSyncById.get === "function"
          ? state.notionSyncById.get(conversation.id)
          : null;
        if (syncInfo && typeof syncInfo === "object") {
          const normalized = (syncStateApi && typeof syncStateApi.normalizeSyncRecord === "function")
            ? syncStateApi.normalizeSyncRecord({ ...syncInfo, conversationId: conversation.id })
            : syncInfo;
          const pill = document.createElement("span");
          const ok = !!normalized.ok;
          pill.className = ok ? "pill syncOk" : "pill syncFail";

          const mode = normalized.mode ? String(normalized.mode) : (ok ? "ok" : "fail");
          const appended = Number(normalized.appended);
          const at = Number(normalized.at) || 0;

          if (!ok) {
            pill.textContent = "failed";
            if (normalized.error) pill.title = String(normalized.error);
          } else if (mode === "no_changes") {
            pill.textContent = "no changed";
            pill.title = "No changes";
          } else {
            pill.textContent = "finished";
            const suffix = (mode === "appended" && Number.isFinite(appended) && appended > 0) ? ` (+${appended})` : "";
            const time = at ? ` @ ${new Date(at).toLocaleString()}` : "";
            pill.title = `${mode}${suffix}${time}`;
          }

          name.appendChild(pill);
        }
      } catch (_e) {
        // ignore
      }

      try {
        const syncInfo = state && state.obsidianSyncById && typeof state.obsidianSyncById.get === "function"
          ? state.obsidianSyncById.get(conversation.id)
          : null;
        if (syncInfo && typeof syncInfo === "object") {
          const normalized = (obsidianSyncStateApi && typeof obsidianSyncStateApi.normalizeSyncRecord === "function")
            ? obsidianSyncStateApi.normalizeSyncRecord({ ...syncInfo, conversationId: conversation.id })
            : syncInfo;
          const pill = document.createElement("span");
          const ok = !!normalized.ok;
          pill.className = ok ? "pill obsOk" : "pill obsFail";

          const mode = normalized.mode ? String(normalized.mode) : (ok ? "ok" : "fail");
          const appended = Number(normalized.appended);
          const at = Number(normalized.at) || 0;

          if (!ok) {
            pill.textContent = "obsidian failed";
            if (normalized.error) pill.title = String(normalized.error);
          } else if (mode === "no_changes") {
            pill.textContent = "obsidian no changes";
            pill.title = "No changes";
          } else {
            pill.textContent = `obsidian ${mode}`;
            const suffix = (Number.isFinite(appended) && appended > 0) ? ` (+${appended})` : "";
            const time = at ? ` @ ${new Date(at).toLocaleString()}` : "";
            pill.title = `${mode}${suffix}${time}`;
          }

          name.appendChild(pill);

          const forceBtn = document.createElement("button");
          forceBtn.type = "button";
          forceBtn.className = "syncForce";
          forceBtn.textContent = "↻";
          forceBtn.title = "Force full Obsidian sync for this conversation";
          forceBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (forceBtn.disabled) return;
            forceBtn.disabled = true;
            const prev = forceBtn.textContent;
            forceBtn.textContent = "…";
            try {
              const res = await send(obsidianTypes.SYNC_CONVERSATIONS, { conversationIds: [conversation.id], forceFullConversationIds: [conversation.id] });
              if (!res || !res.ok) throw new Error((res && res.error && res.error.message) || "sync failed");
            } catch (_e) {
              alert("Force full sync failed.");
            } finally {
              forceBtn.disabled = false;
              forceBtn.textContent = prev;
            }
          });
          name.appendChild(forceBtn);
        }
      } catch (_e) {
        // ignore
      }
      meta.appendChild(name);

      const sub = document.createElement("div");
      sub.className = "sub";
      const sourceRaw = conversation.sourceName || conversation.source || "";
      const { key: sourceKey, label: sourceLabel } = getSourceMeta(sourceRaw);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "sourceCopy";
      copyBtn.setAttribute("aria-label", "Copy full markdown");
      copyBtn.title = "Copy full markdown";
      copyBtn.textContent = "⧉";
      copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const baseText = copyBtn.textContent;
        const baseTitle = copyBtn.title;
        let copied = false;
        copyBtn.disabled = true;
        copyBtn.textContent = "…";
        try {
          const messages = await getMessagesForConversation(conversation.id);
          const md = conversationToMarkdown({ conversation, messages });
          await copyTextToClipboard(md);
          copied = true;
          showCopiedFeedback(copyBtn, { baseText, baseTitle });
        } catch (err) {
          alert((err && err.message) || "Copy failed.");
        } finally {
          copyBtn.disabled = false;
          if (!copied) {
            copyBtn.textContent = baseText;
            copyBtn.title = baseTitle;
          }
        }
      });
      sub.appendChild(copyBtn);

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "sourceOpen";
      openBtn.setAttribute("aria-label", "Open original chat");
      openBtn.title = "Open chat";
      const safeUrl = core.sanitizeHttpUrl(conversation.url || "");
      if (!safeUrl) {
        openBtn.disabled = true;
        openBtn.title = "No link available";
      }
      openBtn.textContent = "↗";
      openBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (openBtn.disabled) return;
        core.openHttpUrl(conversation.url || "");
      });
      sub.appendChild(openBtn);

      const sourceTag = document.createElement("span");
      sourceTag.className = `sourceTag sourceTag--${sourceKey}`;
      sourceTag.textContent = sourceLabel;
      sub.appendChild(sourceTag);

      const timeLabel = formatTime(conversation.lastCapturedAt);
      if (timeLabel) {
        const divider = document.createElement("span");
        divider.className = "metaDivider";
        divider.textContent = " · ";
        sub.appendChild(divider);

        const time = document.createElement("span");
        time.className = "timeLabel";
        time.textContent = timeLabel;
        sub.appendChild(time);
      }
      meta.appendChild(sub);

      row.addEventListener("click", (e) => {
        if (!e || e.button !== 0) return;
        const target = e.target;
        if (target && target.closest && target.closest("input[type='checkbox'], label.checkbox")) return;
        dispatchPreviewEvent(previewEvents.click, { conversationId: conversation.id, anchorEl: row });
      });

      row.appendChild(left);
      row.appendChild(meta);
      els.list.appendChild(row);
    }

    const total = state.conversations.length;
    const now = new Date();
    const today = state.conversations.filter((conversation) => {
      if (!conversation || !conversation.lastCapturedAt) return false;
      try {
        return isSameLocalDay(new Date(conversation.lastCapturedAt), now);
      } catch (_e) {
        return false;
      }
    }).length;
    renderStats({ today, total });
    syncSelectAllCheckbox();
    syncActionButtons();
  }

  async function ensureFilterLoaded() {
    if (filterLoaded) return true;
    filterLoaded = true;
    if (typeof storageGet !== "function") return false;
    try {
      const res = await storageGet([FILTER_KEY]);
      const raw = res && res[FILTER_KEY] != null ? res[FILTER_KEY] : "all";
      state.sourceFilterKey = String(raw || "all").trim().toLowerCase() || "all";
    } catch (_e) {
      state.sourceFilterKey = "all";
    }
    return true;
  }

  async function refresh() {
    await ensureFilterLoaded();
    const res = await send("getConversations");
    state.allConversations = (res && res.ok && Array.isArray(res.data)) ? res.data : [];
    state.conversations = applySourceFilter(state.allConversations, { sourceKey: state.sourceFilterKey });
    renderFilterOptions();
    if (els.sourceFilterSelect) {
      const exists = Array.from(els.sourceFilterSelect.options || []).some((o) => String(o && o.value).toLowerCase() === String(state.sourceFilterKey).toLowerCase());
      if (exists) {
        els.sourceFilterSelect.value = state.sourceFilterKey;
      } else {
        state.sourceFilterKey = "all";
        els.sourceFilterSelect.value = "all";
        try {
          if (typeof storageSet === "function") await storageSet({ [FILTER_KEY]: "all" });
        } catch (_e) {
          // ignore
        }
        state.conversations = applySourceFilter(state.allConversations, { sourceKey: state.sourceFilterKey });
      }
    }
    const ids = new Set(state.conversations.map((conversation) => conversation.id));
    state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => ids.has(id)));
    render();
  }

  function getSelectedIds() {
    return Array.from(state.selectedIds);
  }

  function init() {
    if (!els.chkSelectAll) return;
    els.chkSelectAll.addEventListener("change", () => {
      if (els.chkSelectAll.checked) {
        for (const conversation of state.conversations) state.selectedIds.add(conversation.id);
      } else {
        state.selectedIds.clear();
      }
      render();
    });
    if (els.sourceFilterSelect) {
      els.sourceFilterSelect.addEventListener("change", async () => {
        await ensureFilterLoaded();
        const next = els.sourceFilterSelect ? els.sourceFilterSelect.value : "all";
        await setSourceFilterKey(next);
      });
    }
    syncActionButtons();
  }

  NS.popupList = {
    init,
    render,
    refresh,
    getSelectedIds,
    __test: {
      applySourceFilter
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupList;
})();
