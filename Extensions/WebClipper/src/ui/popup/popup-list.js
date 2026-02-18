(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const {
    els,
    state,
    send,
    PREVIEW_EVENTS,
    formatTime,
    getSourceMeta,
    hasWarningFlags,
    isSameLocalDay
  } = core;
  const previewEvents = PREVIEW_EVENTS || {
    click: "popup:conversation-click"
  };

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
    if (els.chatActionButtons) els.chatActionButtons.hidden = !hasSelection;
    if (els.chatBottomSpacer) els.chatBottomSpacer.hidden = hasSelection;
    if (els.stats) els.stats.hidden = hasSelection;

    if (els.btnExport) els.btnExport.disabled = !hasSelection;
    if (els.btnSyncNotion) els.btnSyncNotion.disabled = !hasSelection;
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
      meta.appendChild(name);

      const sub = document.createElement("div");
      sub.className = "sub";
      const sourceRaw = conversation.sourceName || conversation.source || "";
      const { key: sourceKey, label: sourceLabel } = getSourceMeta(sourceRaw);

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

  async function refresh() {
    const res = await send("getConversations");
    state.conversations = (res && res.ok && Array.isArray(res.data)) ? res.data : [];
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
    syncActionButtons();
  }

  NS.popupList = {
    init,
    render,
    refresh,
    getSelectedIds
  };
})();
