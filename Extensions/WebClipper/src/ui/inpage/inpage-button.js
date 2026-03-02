/* global localStorage, clearTimeout, setTimeout */

(function () {
  const NS = require("../../runtime-context.js");

  const INPAGE_BTN_ID = "webclipper-inpage-btn";
  const INPAGE_BTN_STORAGE_KEY_V2 = "webclipper_btn_pos_inpage_v2";
  const INPAGE_BTN_STORAGE_KEY_V3 = "webclipper_btn_pos_inpage_v3";
  const EDGE_GAP = 0;
  const INPAGE_BUTTON_LABEL = "WebClipper: Save";
  const COMBO_WINDOW_MS = 400;
  const EASTER_CLASSES = Object.freeze({
    3: "is-easter-3",
    5: "is-easter-5",
    7: "is-easter-7"
  });
  const EASTER_DURATION_MS = Object.freeze({
    3: 520,
    5: 760,
    7: 1100
  });

  let runtime = null;

  function initRuntime(nextRuntime) {
    runtime = nextRuntime || null;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getButtonSize(el) {
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || el.offsetWidth || 1));
    const height = Math.max(1, Math.round(rect.height || el.offsetHeight || 1));
    return { width, height };
  }

  function clamp01(v) {
    return clamp(v, 0, 1);
  }

  function getSnappedRange(edge, size) {
    const { width, height } = size;
    if (edge === "left" || edge === "right") {
      const min = EDGE_GAP;
      const max = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
      const range = Math.max(0, max - min);
      return { axis: "y", min, max, range };
    }
    const min = EDGE_GAP;
    const max = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
    const range = Math.max(0, max - min);
    return { axis: "x", min, max, range };
  }

  function resolveOffsetFromState(edge, size, state) {
    const range = getSnappedRange(edge, size);
    const ratio = state && Number.isFinite(state.ratio) ? clamp01(Number(state.ratio)) : null;
    if (ratio != null) {
      return { offset: range.min + ratio * range.range, ratio };
    }
    const fallbackOffset = state && Number.isFinite(state.offset) ? Number(state.offset) : EDGE_GAP;
    const clampedOffset = clamp(fallbackOffset, range.min, range.max);
    const nextRatio = range.range > 0 ? (clampedOffset - range.min) / range.range : 0;
    return { offset: clampedOffset, ratio: clamp01(nextRatio) };
  }

  function applySnappedPosition(el, state) {
    if (!state || !state.edge) return null;
    const size = getButtonSize(el);
    const { width, height } = size;
    const maxLeft = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
    const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
    const edge = state.edge;
    const resolved = resolveOffsetFromState(edge, size, state);

    el.style.position = "fixed";
    if (edge === "left") {
      const top = clamp(resolved.offset, EDGE_GAP, maxTop);
      el.style.left = `${EDGE_GAP}px`;
      el.style.right = "auto";
      el.style.top = `${top}px`;
      el.style.bottom = "auto";
      return { edge, ratio: resolved.ratio };
    }
    if (edge === "right") {
      const top = clamp(resolved.offset, EDGE_GAP, maxTop);
      el.style.left = "auto";
      el.style.right = `${EDGE_GAP}px`;
      el.style.top = `${top}px`;
      el.style.bottom = "auto";
      return { edge, ratio: resolved.ratio };
    }
    if (edge === "top") {
      const left = clamp(resolved.offset, EDGE_GAP, maxLeft);
      el.style.left = `${left}px`;
      el.style.right = "auto";
      el.style.top = `${EDGE_GAP}px`;
      el.style.bottom = "auto";
      return { edge, ratio: resolved.ratio };
    }
    if (edge === "bottom") {
      const left = clamp(resolved.offset, EDGE_GAP, maxLeft);
      el.style.left = `${left}px`;
      el.style.right = "auto";
      el.style.top = "auto";
      el.style.bottom = `${EDGE_GAP}px`;
      return { edge, ratio: resolved.ratio };
    }
    return null;
  }

  function snapToClosestEdge(el, desiredLeft, desiredTop) {
    const size = getButtonSize(el);
    const { width, height } = size;
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
    const edge = closest.edge;
    const offset = edge === "left" || edge === "right" ? top : left;
    const range = getSnappedRange(edge, size);
    const ratio = range.range > 0 ? (offset - range.min) / range.range : 0;
    return applySnappedPosition(el, { edge, ratio: clamp01(ratio) });
  }

  function resolveComboLevel(count) {
    if (count >= 7) return 7;
    if (count >= 5) return 5;
    if (count >= 3) return 3;
    return 0;
  }

  function destroyButton(el) {
    if (!el) return;
    const cleanup = el.__webclipperCleanup;
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch (_e) {
        // ignore
      }
    }
    el.remove();
  }

  function ensureInpageButton({ collectorId, onClick, onDoubleClick, onCombo }) {
    if (!collectorId) return;

    const existing = document.getElementById(INPAGE_BTN_ID);
    if (existing) {
      if (existing.dataset.sourceId === collectorId) {
        return;
      }
      destroyButton(existing);
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

    let snappedState = null;

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let comboCount = 0;
    let comboTimer = null;
    let easterTimer = null;

    function clearEasterAnimation() {
      if (easterTimer) {
        clearTimeout(easterTimer);
        easterTimer = null;
      }
      Object.values(EASTER_CLASSES).forEach((name) => btn.classList.remove(name));
    }

    function replayEasterAnimation(level) {
      const cls = EASTER_CLASSES[level];
      if (!cls) return;
      clearEasterAnimation();
      // Force reflow so same-class animation can replay on rapid combo repeats.
      void btn.offsetWidth;
      btn.classList.add(cls);
      const duration = EASTER_DURATION_MS[level] || 800;
      easterTimer = setTimeout(() => {
        btn.classList.remove(cls);
        easterTimer = null;
      }, duration);
    }

    function settleCombo() {
      const finalCount = comboCount;
      comboCount = 0;
      comboTimer = null;

      if (finalCount === 1) {
        onClick && onClick();
        return;
      }

      if (finalCount === 2) {
        onDoubleClick && onDoubleClick({ count: finalCount, windowMs: COMBO_WINDOW_MS });
        return;
      }

      const level = resolveComboLevel(finalCount);
      if (!level) return;
      replayEasterAnimation(level);
      onCombo && onCombo({ level, count: finalCount, windowMs: COMBO_WINDOW_MS });
    }

    function registerClick() {
      comboCount += 1;
      if (comboTimer) {
        clearTimeout(comboTimer);
      }
      comboTimer = setTimeout(settleCombo, COMBO_WINDOW_MS);
    }

    function resetComboState() {
      comboCount = 0;
      if (!comboTimer) return;
      clearTimeout(comboTimer);
      comboTimer = null;
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
      if (!moved) {
        // Click (no actual drag): restore the previous snapped position.
        // Otherwise, hover transforms (e.g. translateY) would slightly change
        // getBoundingClientRect() and make the button "creep" over repeated clicks.
        applySnappedPosition(btn, snappedState);
        return;
      }

      const rect = btn.getBoundingClientRect();
      snappedState = snapToClosestEdge(btn, rect.left, rect.top);
      try {
        if (snappedState) localStorage.setItem(INPAGE_BTN_STORAGE_KEY_V3, JSON.stringify(snappedState));
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
      registerClick();
    });

    document.documentElement.appendChild(btn);

    try {
      const savedV3 = localStorage.getItem(INPAGE_BTN_STORAGE_KEY_V3);
      if (savedV3) {
        const parsed = JSON.parse(savedV3);
        if (parsed && typeof parsed.edge === "string" && (Number.isFinite(parsed.ratio) || Number.isFinite(parsed.offset))) {
          snappedState = applySnappedPosition(btn, parsed);
        }
      } else {
        const savedV2 = localStorage.getItem(INPAGE_BTN_STORAGE_KEY_V2);
        if (savedV2) {
          const parsed = JSON.parse(savedV2);
          if (parsed && typeof parsed.edge === "string" && (Number.isFinite(parsed.ratio) || Number.isFinite(parsed.offset))) {
            snappedState = applySnappedPosition(btn, parsed);
          }
        }
      }

      if (!snappedState) {
        const rect = btn.getBoundingClientRect();
        snappedState = snapToClosestEdge(btn, rect.left, rect.top);
      }

      if (snappedState) localStorage.setItem(INPAGE_BTN_STORAGE_KEY_V3, JSON.stringify(snappedState));
    } catch (_e) {
      const rect = btn.getBoundingClientRect();
      snappedState = snapToClosestEdge(btn, rect.left, rect.top);
    }

    const onResize = () => {
      if (!btn.isConnected) return;
      const nextState = applySnappedPosition(btn, snappedState);
      if (!nextState) return;
      snappedState = nextState;
      try {
        localStorage.setItem(INPAGE_BTN_STORAGE_KEY_V3, JSON.stringify(snappedState));
      } catch (_e) {
        // ignore
      }
    };
    window.addEventListener("resize", onResize);

    btn.__webclipperCleanup = () => {
      resetComboState();
      clearEasterAnimation();
      window.removeEventListener("resize", onResize);
    };
  }

  function cleanupButtons(activeCollectorId) {
    const active = activeCollectorId || "";
    if (!active) {
      const el = document.getElementById(INPAGE_BTN_ID);
      if (el) destroyButton(el);
    }
    // Cleanup legacy Notion button id from older versions.
    const legacyNotionBtn = document.getElementById("webclipper-notionai-btn");
    if (legacyNotionBtn) legacyNotionBtn.remove();
  }

  NS.inpageButton = {
    initRuntime,
    ensureInpageButton,
    cleanupButtons
  };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.inpageButton;
})();
