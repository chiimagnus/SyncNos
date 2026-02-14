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
    hoverEnter: "popup:conversation-hover-enter",
    hoverLeave: "popup:conversation-hover-leave",
    focusEnter: "popup:conversation-focus-enter",
    focusLeave: "popup:conversation-focus-leave"
  };

  function dispatchPreviewEvent(type, detail) {
    if (!els.list) return;
    els.list.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function focusSiblingRow(row, delta) {
    if (!row || !els.list || !Number.isFinite(delta) || delta === 0) return;
    const rows = Array.from(els.list.querySelectorAll(".row[data-conversation-id]"));
    const currentIndex = rows.indexOf(row);
    if (currentIndex < 0) return;
    const nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
    const next = rows[nextIndex];
    if (next && typeof next.focus === "function") next.focus();
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

  function render() {
    if (!els.list) return;
    els.list.innerHTML = "";
    for (const conversation of state.conversations) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.conversationId = String(conversation.id);
      row.tabIndex = 0;
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

      let focusWithin = false;
      row.addEventListener("mouseenter", () => {
        dispatchPreviewEvent(previewEvents.hoverEnter, { conversationId: conversation.id, anchorEl: row });
      });
      row.addEventListener("mouseleave", () => {
        dispatchPreviewEvent(previewEvents.hoverLeave, { conversationId: conversation.id, anchorEl: row });
      });
      row.addEventListener("focusin", () => {
        if (focusWithin) return;
        focusWithin = true;
        dispatchPreviewEvent(previewEvents.focusEnter, { conversationId: conversation.id, anchorEl: row });
      });
      row.addEventListener("focusout", (e) => {
        const next = e && e.relatedTarget;
        if (next && row.contains(next)) return;
        if (!focusWithin) return;
        focusWithin = false;
        dispatchPreviewEvent(previewEvents.focusLeave, { conversationId: conversation.id, anchorEl: row });
      });
      row.addEventListener("keydown", (e) => {
        if (!e) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          focusSiblingRow(row, 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          focusSiblingRow(row, -1);
        }
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
  }

  NS.popupList = {
    init,
    render,
    refresh,
    getSelectedIds
  };
})();
