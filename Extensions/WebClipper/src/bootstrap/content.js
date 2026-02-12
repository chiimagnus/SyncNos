/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const INPAGE_BTN_ID = "webclipper-inpage-btn";
  const NOTION_BTN_ID = "webclipper-notionai-btn";

  function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => resolve(res));
    });
  }

  function getCollector() {
    const reg = NS.collectorsRegistry;
    if (!reg || typeof reg.pickActive !== "function") return null;
    const picked = reg.pickActive();
    if (!picked || !picked.collector) return null;
    return { id: picked.id, ...picked.collector };
  }

  async function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.conversation) return;
    const convoRes = await send("upsertConversation", { payload: snapshot.conversation });
    if (!convoRes || !convoRes.ok) return;
    const convo = convoRes.data;
    await send("syncConversationMessages", {
      conversationId: convo.id,
      messages: snapshot.messages || []
    });
  }

  function ensureInpageStylesheetInjected() {
    const id = "webclipper-inpage-style";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/ui/inpage/inpage.css");
    document.documentElement.appendChild(link);
  }

  function ensureChatGPTButton({ onClick }) {
    if (!getCollector() || getCollector().id !== "chatgpt") return;
    ensureInpageStylesheetInjected();
    if (document.getElementById(INPAGE_BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = INPAGE_BTN_ID;
    btn.className = "webclipper-inpage-btn";
    btn.type = "button";
    btn.textContent = "WebClipper: Save";

    const storageKey = "webclipper_btn_pos_chatgpt_v1";
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
          btn.style.left = `${p.left}px`;
          btn.style.top = `${p.top}px`;
          btn.style.right = "auto";
          btn.style.bottom = "auto";
          btn.style.position = "fixed";
        }
      } catch (_e) {
        // ignore
      }
    }

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    btn.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      btn.setPointerCapture(e.pointerId);
      const rect = btn.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      btn.style.left = `${startLeft}px`;
      btn.style.top = `${startTop}px`;
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    });

    btn.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      const left = clamp(startLeft + dx, 6, window.innerWidth - 6);
      const top = clamp(startTop + dy, 6, window.innerHeight - 6);
      btn.style.left = `${left}px`;
      btn.style.top = `${top}px`;
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      const rect = btn.getBoundingClientRect();
      try {
        localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
      } catch (_e) {
        // ignore
      }
    }

    btn.addEventListener("pointerup", () => endDrag());
    btn.addEventListener("pointercancel", () => endDrag());
    btn.addEventListener("click", (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onClick && onClick();
    });

    document.documentElement.appendChild(btn);
  }

  function ensureNotionAttachedButton({ onClick, getAnchorRect }) {
    const c = getCollector();
    if (!c || c.id !== "notionai") return;
    ensureInpageStylesheetInjected();
    const id = NOTION_BTN_ID;
    if (document.getElementById(id)) return;
    if (typeof getAnchorRect !== "function") return;

    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "webclipper-inpage-btn";
    btn.type = "button";
    btn.textContent = "Save";
    btn.style.padding = "8px 10px";
    btn.style.borderRadius = "12px";

    function updatePos() {
      const r = getAnchorRect();
      if (!r) return;
      // Attach near the top-left of the NotionAI window area.
      btn.style.left = `${Math.max(6, r.left + 10)}px`;
      btn.style.top = `${Math.max(6, r.top + 10)}px`;
      btn.style.right = "auto";
      btn.style.bottom = "auto";
      btn.style.position = "fixed";
    }

    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, { passive: true });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick && onClick();
    });

    document.documentElement.appendChild(btn);
  }

  function cleanupButtons(activeCollectorId) {
    const active = activeCollectorId || "";
    if (active !== "chatgpt") {
      const el = document.getElementById(INPAGE_BTN_ID);
      if (el) el.remove();
    }
    if (active !== "notionai") {
      const el = document.getElementById(NOTION_BTN_ID);
      if (el) el.remove();
    }
  }

  function startAutoCapture() {
    // Manual button: trigger an immediate capture and save once.
    const clickSave = async () => {
      try {
        const collector = getCollector();
        if (!collector || typeof collector.capture !== "function") return;
        const snapshot = collector.capture();
        if (!snapshot) return;
        await saveSnapshot(snapshot);
      } catch (_e) {
        // ignore
      }
    };

    const observer = NS.runtimeObserver && NS.runtimeObserver.createObserver({
      debounceMs: 600,
      getRoot: () => {
        const c = getCollector();
        return c && typeof c.getRoot === "function" ? c.getRoot() : null;
      },
      onTick: async () => {
        try {
          const collector = getCollector();
          cleanupButtons(collector && collector.id);
          ensureChatGPTButton({ onClick: clickSave });
          ensureNotionAttachedButton({
            onClick: clickSave,
            getAnchorRect: () => {
              const c = getCollector();
              return c && typeof c.getAnchorRect === "function" ? c.getAnchorRect() : null;
            }
          });
          if (!collector || typeof collector.capture !== "function") return;
          const snapshot = collector.capture();
          if (!snapshot) return;
          const inc = NS.incrementalUpdater && NS.incrementalUpdater.computeIncremental(snapshot);
          if (!inc || !inc.changed) return;
          await saveSnapshot(inc.snapshot);
        } catch (_e) {
          // Swallow errors in content script; surface via popup in later tasks.
        }
      }
    });

    observer && observer.start && observer.start();
  }

  startAutoCapture();
})();
