(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, storageGet, storageSet, STORAGE_KEYS } = core;
  const TAB_IDS = ["chats", "settings", "about"];

  function normalizeTabId(tabId) {
    return TAB_IDS.includes(tabId) ? tabId : "chats";
  }

  function setTabButtonState({ el, active }) {
    if (!el) return;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
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
    const raw = (x - segPad) / segWidth - 0.5;
    return clamp(raw, 0, segCount - 1);
  }

  function setIndicatorValue(tabsEl, value) {
    tabsEl.style.setProperty("--tab-i", String(value));
  }

  function initTabsDrag() {
    const tabsEl = (els.tabChats && els.tabChats.closest) ? els.tabChats.closest(".tabs") : null;
    if (!tabsEl) return;

    const drag = { pending: false, dragging: false, pointerId: null, startX: 0 };

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
      const value = indicatorValueForClientX({ tabsEl, clientX: e.clientX });
      setIndicatorValue(tabsEl, value);
    });

    tabsEl.addEventListener("pointerup", (e) => {
      if (!drag.pending || drag.pointerId !== e.pointerId) return;
      if (drag.dragging) {
        e.preventDefault();
        stopDragging({ snap: true });
      } else {
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

  async function init() {
    if (els.tabChats) {
      els.tabChats.addEventListener("click", () => setActiveTab("chats"));
    }
    if (els.tabSettings) {
      els.tabSettings.addEventListener("click", () => setActiveTab("settings"));
    }
    if (els.tabAbout) {
      els.tabAbout.addEventListener("click", () => setActiveTab("about"));
    }

    const saved = await storageGet([STORAGE_KEYS.popupActiveTab]);
    setActiveTab(normalizeTabId(saved[STORAGE_KEYS.popupActiveTab] || "chats"));
    initTabsDrag();
  }

  NS.popupTabs = {
    init,
    setActiveTab,
    normalizeTabId
  };
})();
