/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const runtime = NS.runtimeClient && typeof NS.runtimeClient.createRuntimeClient === "function"
    ? NS.runtimeClient.createRuntimeClient()
    : null;

  const INPAGE_BTN_ID = "webclipper-inpage-btn";
  const INPAGE_BTN_STORAGE_KEY = "webclipper_btn_pos_inpage_v2";
  const EDGE_GAP = 8;
  const INPAGE_BUTTON_LABEL = "WebClipper: Save";
  const INPAGE_OK_FLASH_COOLDOWN_MS = 2500;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getButtonSize(el) {
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || el.offsetWidth || 1));
    const height = Math.max(1, Math.round(rect.height || el.offsetHeight || 1));
    return { width, height };
  }

  function applySnappedPosition(el, state) {
    if (!state || !state.edge) return null;
    const { width, height } = getButtonSize(el);
    const maxLeft = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
    const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
    const offset = Number.isFinite(state.offset) ? state.offset : EDGE_GAP;
    const edge = state.edge;

    el.style.position = "fixed";
    if (edge === "left") {
      const top = clamp(offset, EDGE_GAP, maxTop);
      el.style.left = `${EDGE_GAP}px`;
      el.style.right = "auto";
      el.style.top = `${top}px`;
      el.style.bottom = "auto";
      return { edge, offset: top };
    }
    if (edge === "right") {
      const top = clamp(offset, EDGE_GAP, maxTop);
      el.style.left = "auto";
      el.style.right = `${EDGE_GAP}px`;
      el.style.top = `${top}px`;
      el.style.bottom = "auto";
      return { edge, offset: top };
    }
    if (edge === "top") {
      const left = clamp(offset, EDGE_GAP, maxLeft);
      el.style.left = `${left}px`;
      el.style.right = "auto";
      el.style.top = `${EDGE_GAP}px`;
      el.style.bottom = "auto";
      return { edge, offset: left };
    }
    if (edge === "bottom") {
      const left = clamp(offset, EDGE_GAP, maxLeft);
      el.style.left = `${left}px`;
      el.style.right = "auto";
      el.style.top = "auto";
      el.style.bottom = `${EDGE_GAP}px`;
      return { edge, offset: left };
    }
    return null;
  }

  function snapToClosestEdge(el, desiredLeft, desiredTop) {
    const { width, height } = getButtonSize(el);
    const maxLeft = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
    const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
    const left = clamp(desiredLeft, EDGE_GAP, maxLeft);
    const top = clamp(desiredTop, EDGE_GAP, maxTop);

    const distances = [
      { edge: "left", distance: left - EDGE_GAP },
      { edge: "right", distance: window.innerWidth - (left + width) - EDGE_GAP },
      { edge: "top", distance: top - EDGE_GAP },
      { edge: "bottom", distance: window.innerHeight - (top + height) - EDGE_GAP }
    ];
    distances.sort((a, b) => a.distance - b.distance);

    const closest = distances[0];
    const offset = closest.edge === "left" || closest.edge === "right" ? top : left;
    return applySnappedPosition(el, { edge: closest.edge, offset });
  }

  function send(type, payload) {
    if (!runtime || typeof runtime.send !== "function") {
      return Promise.reject(new Error("runtime client unavailable"));
    }
    return runtime.send(type, payload);
  }

  function getCollector() {
    const reg = NS.collectorsRegistry;
    if (!reg || typeof reg.pickActive !== "function") return null;
    const picked = reg.pickActive();
    if (!picked || !picked.collector) return null;
    return { id: picked.id, ...picked.collector };
  }

  function showSaveTip(text) {
    const id = "webclipper-save-tip";
    const old = document.getElementById(id);
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = id;
    el.textContent = text;
    el.style.position = "fixed";
    el.style.right = "16px";
    el.style.bottom = "76px";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "10px";
    el.style.fontSize = "12px";
    el.style.color = "#fff";
    el.style.background = "rgba(0,0,0,0.78)";
    el.style.zIndex = "2147483647";
    document.documentElement.appendChild(el);
    setTimeout(() => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 1800);
  }

  async function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.conversation) return;
    const convoRes = await send("upsertConversation", { payload: snapshot.conversation });
    if (!convoRes || !convoRes.ok) {
      throw new Error((convoRes && convoRes.error && convoRes.error.message) || "upsertConversation failed");
    }
    const convo = convoRes.data;
    const msgRes = await send("syncConversationMessages", {
      conversationId: convo.id,
      messages: snapshot.messages || []
    });
    if (!msgRes || !msgRes.ok) {
      throw new Error((msgRes && msgRes.error && msgRes.error.message) || "syncConversationMessages failed");
    }
    return { conversationId: convo.id };
  }

  const inpageOkState = {
    lastAt: 0,
    timer: null
  };

  function ensureInpageOkDecor(btn) {
    if (!btn || !btn.appendChild) return;
    if (btn.querySelector(".webclipper-inpage-btn__ring")) return;

    const ring = document.createElement("span");
    ring.className = "webclipper-inpage-btn__ring";
    ring.setAttribute("aria-hidden", "true");

    const check = document.createElement("span");
    check.className = "webclipper-inpage-btn__check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";

    btn.appendChild(ring);
    btn.appendChild(check);
  }

  function flashInpageOk() {
    const btn = document.getElementById(INPAGE_BTN_ID);
    if (!btn) return;
    ensureInpageOkDecor(btn);
    const now = Date.now();
    if (now - inpageOkState.lastAt < INPAGE_OK_FLASH_COOLDOWN_MS) return;
    inpageOkState.lastAt = now;

    if (inpageOkState.timer) {
      clearTimeout(inpageOkState.timer);
      inpageOkState.timer = null;
    }

    btn.classList.remove("is-ok");
    // Force reflow so re-adding the class re-triggers the animation reliably.
    void btn.offsetWidth;
    btn.classList.add("is-ok");
    inpageOkState.timer = setTimeout(() => {
      btn.classList.remove("is-ok");
      inpageOkState.timer = null;
    }, 1400);
  }

  function ensureInpageButton({ collectorId, onClick }) {
    if (!collectorId) return;

    const existing = document.getElementById(INPAGE_BTN_ID);
    if (existing) {
      if (existing.dataset.sourceId === collectorId) {
        ensureInpageOkDecor(existing);
        return;
      }
      existing.remove();
    }
    const btn = document.createElement("button");
    btn.id = INPAGE_BTN_ID;
    btn.className = "webclipper-inpage-btn";
    btn.type = "button";
    btn.dataset.sourceId = collectorId;
    btn.title = INPAGE_BUTTON_LABEL;
    btn.setAttribute("aria-label", INPAGE_BUTTON_LABEL);

    const icon = document.createElement("img");
    icon.className = "webclipper-inpage-btn__icon";
    icon.alt = "";
    icon.decoding = "async";
    icon.loading = "eager";
    icon.draggable = false;
    icon.setAttribute("aria-hidden", "true");
    const iconUrl = runtime && typeof runtime.getURL === "function" ? runtime.getURL("icons/icon-128.png") : "";
    if (iconUrl) icon.src = iconUrl;
    icon.addEventListener("dragstart", (e) => e.preventDefault());
    icon.addEventListener("error", () => {
      btn.textContent = INPAGE_BUTTON_LABEL;
    });
    if (iconUrl) {
      btn.appendChild(icon);
    } else {
      btn.textContent = INPAGE_BUTTON_LABEL;
    }

    ensureInpageOkDecor(btn);

    const storageKey = INPAGE_BTN_STORAGE_KEY;
    let snappedState = null;

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

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
      const { width, height } = getButtonSize(btn);
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      const left = clamp(startLeft + dx, EDGE_GAP, Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP));
      const top = clamp(startTop + dy, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP));
      btn.style.left = `${left}px`;
      btn.style.top = `${top}px`;
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      const rect = btn.getBoundingClientRect();
      snappedState = snapToClosestEdge(btn, rect.left, rect.top);
      try {
        if (snappedState) localStorage.setItem(storageKey, JSON.stringify(snappedState));
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
      e.preventDefault();
      e.stopPropagation();
      onClick && onClick();
    });

    document.documentElement.appendChild(btn);

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.edge === "string" && Number.isFinite(parsed.offset)) {
          snappedState = applySnappedPosition(btn, parsed);
        }
      }

      if (!snappedState) {
        const rect = btn.getBoundingClientRect();
        snappedState = snapToClosestEdge(btn, rect.left, rect.top);
      }

      if (snappedState) localStorage.setItem(storageKey, JSON.stringify(snappedState));
    } catch (_e) {
      const rect = btn.getBoundingClientRect();
      snappedState = snapToClosestEdge(btn, rect.left, rect.top);
    }

    window.addEventListener("resize", () => {
      if (!btn.isConnected) return;
      const nextState = applySnappedPosition(btn, snappedState);
      if (!nextState) return;
      snappedState = nextState;
      try {
        localStorage.setItem(storageKey, JSON.stringify(snappedState));
      } catch (_e) {
        // ignore
      }
    });
  }

  function cleanupButtons(activeCollectorId) {
    const active = activeCollectorId || "";
    if (!active) {
      const el = document.getElementById(INPAGE_BTN_ID);
      if (el) el.remove();
    }
    // Cleanup legacy Notion button id from older versions.
    const legacyNotionBtn = document.getElementById("webclipper-notionai-btn");
    if (legacyNotionBtn) legacyNotionBtn.remove();
  }

  function createAutoCaptureController() {
    let stopped = false;
    let observer = null;

    function stop() {
      if (stopped) return;
      stopped = true;
      cleanupButtons("");
      observer && observer.stop && observer.stop();
    }

    if (runtime && typeof runtime.onInvalidated === "function") {
      runtime.onInvalidated(() => stop());
    }

    // Manual button: trigger an immediate capture and save once.
    const clickSave = async () => {
      if (stopped) return;
      try {
        const collector = getCollector();
        if (!collector || typeof collector.capture !== "function") return;
        const snapshot = collector.capture({ manual: true });
        if (!snapshot) {
          showSaveTip("No visible conversation found");
          return;
        }
        await saveSnapshot(snapshot);
        flashInpageOk();
      } catch (_e) {
        showSaveTip("Save failed");
      }
    };

    observer = NS.runtimeObserver && NS.runtimeObserver.createObserver({
      debounceMs: 600,
      getRoot: () => {
        if (stopped) return null;
        const c = getCollector();
        return c && typeof c.getRoot === "function" ? c.getRoot() : null;
      },
      onTick: async () => {
        if (stopped) return;
        try {
          const collector = getCollector();
          cleanupButtons(collector && collector.id);
          ensureInpageButton({
            collectorId: collector && collector.id,
            onClick: clickSave
          });
          if (!collector || typeof collector.capture !== "function") return;
          const snapshot = collector.capture();
          if (!snapshot) return;
          const inc = NS.incrementalUpdater && NS.incrementalUpdater.computeIncremental(snapshot);
          if (!inc || !inc.changed) return;
          await saveSnapshot(inc.snapshot);
          flashInpageOk();
        } catch (_e) {
          if (runtime && typeof runtime.isInvalidContextError === "function" && runtime.isInvalidContextError(_e)) {
            stop();
            return;
          }
          // Keep auto-save non-blocking, but leave a debug trail for DevTools.
          console.error("WebClipper auto-save failed:", _e);
        }
      }
    });

    return {
      start() {
        if (stopped) return;
        observer && observer.start && observer.start();
      },
      stop
    };
  }

  const controller = createAutoCaptureController();
  controller.start();
})();
