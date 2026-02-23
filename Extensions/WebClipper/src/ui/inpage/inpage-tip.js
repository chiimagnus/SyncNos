/* global clearTimeout, setTimeout */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const BUBBLE_ID = "webclipper-inpage-bubble";
  const INPAGE_BTN_ID = "webclipper-inpage-btn";
  const VISIBLE_MS = 1800;
  const VIEWPORT_PAD = 8;
  const ANCHOR_GAP = 10;
  const ANIM_CLASS = "is-enter";

  const state = {
    hideTimer: null,
    animTimer: null,
    rafId: null,
    visibleUntil: 0
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getViewport() {
    const w = Math.max(0, window.innerWidth || 0);
    const h = Math.max(0, window.innerHeight || 0);
    return { width: w, height: h };
  }

  function getAnchorRect() {
    const btn = document.getElementById(INPAGE_BTN_ID);
    if (btn && typeof btn.getBoundingClientRect === "function") {
      return btn.getBoundingClientRect();
    }
    const viewport = getViewport();
    const size = 40;
    const left = Math.max(VIEWPORT_PAD, viewport.width - size - 16);
    const top = Math.max(VIEWPORT_PAD, viewport.height - size - 16);
    return {
      left,
      top,
      right: left + size,
      bottom: top + size,
      width: size,
      height: size
    };
  }

  function inferPlacement(anchor, viewport) {
    const distances = [
      { edge: "left", value: anchor.left },
      { edge: "right", value: viewport.width - anchor.right },
      { edge: "top", value: anchor.top },
      { edge: "bottom", value: viewport.height - anchor.bottom }
    ].sort((a, b) => a.value - b.value);

    const closest = distances[0] && distances[0].edge;
    if (closest === "left") return "right";
    if (closest === "right") return "left";
    if (closest === "top") return "bottom";
    return "top";
  }

  function computeBubblePosition(anchorRect, bubbleRect, viewport, placement) {
    const width = Math.max(1, Math.round(bubbleRect.width || 1));
    const height = Math.max(1, Math.round(bubbleRect.height || 1));
    const anchorCx = anchorRect.left + Math.max(1, anchorRect.width || 1) / 2;
    const anchorCy = anchorRect.top + Math.max(1, anchorRect.height || 1) / 2;

    let left = VIEWPORT_PAD;
    let top = VIEWPORT_PAD;

    if (placement === "left") {
      left = anchorRect.left - width - ANCHOR_GAP;
      top = anchorCy - height / 2;
    } else if (placement === "right") {
      left = anchorRect.right + ANCHOR_GAP;
      top = anchorCy - height / 2;
    } else if (placement === "bottom") {
      left = anchorCx - width / 2;
      top = anchorRect.bottom + ANCHOR_GAP;
    } else {
      left = anchorCx - width / 2;
      top = anchorRect.top - height - ANCHOR_GAP;
    }

    const maxLeft = Math.max(VIEWPORT_PAD, viewport.width - width - VIEWPORT_PAD);
    const maxTop = Math.max(VIEWPORT_PAD, viewport.height - height - VIEWPORT_PAD);
    return {
      left: clamp(left, VIEWPORT_PAD, maxLeft),
      top: clamp(top, VIEWPORT_PAD, maxTop),
      placement
    };
  }

  function ensureBubble() {
    const existing = document.getElementById(BUBBLE_ID);
    if (existing) return existing;

    const bubble = document.createElement("div");
    bubble.id = BUBBLE_ID;
    bubble.className = "webclipper-inpage-bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");

    const text = document.createElement("span");
    text.className = "webclipper-inpage-bubble__text";
    bubble.appendChild(text);

    const arrow = document.createElement("span");
    arrow.className = "webclipper-inpage-bubble__arrow";
    arrow.setAttribute("aria-hidden", "true");
    bubble.appendChild(arrow);

    document.documentElement.appendChild(bubble);
    return bubble;
  }

  function setTextAndKind(el, text, kind) {
    const textEl = el.querySelector(".webclipper-inpage-bubble__text");
    if (textEl) textEl.textContent = String(text || "");
    const normalizedKind = kind === "error" || kind === "loading" ? kind : "default";
    el.dataset.kind = normalizedKind;
  }

  function positionBubble(el) {
    if (!el || !el.isConnected) return;
    const viewport = getViewport();
    const anchorRect = getAnchorRect();
    if (!anchorRect) return;
    const bubbleRect = el.getBoundingClientRect();
    const placement = inferPlacement(anchorRect, viewport);
    const pos = computeBubblePosition(anchorRect, bubbleRect, viewport, placement);

    el.dataset.placement = pos.placement;
    el.style.left = `${Math.round(pos.left)}px`;
    el.style.top = `${Math.round(pos.top)}px`;
  }

  function stopFollowLoop() {
    const caf =
      typeof globalThis.cancelAnimationFrame === "function"
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : clearTimeout;
    if (state.rafId != null) {
      caf(state.rafId);
      state.rafId = null;
    }
  }

  function startFollowLoop(el) {
    stopFollowLoop();
    const raf =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (cb) => setTimeout(cb, 16);
    const tick = () => {
      if (!el || !el.isConnected) {
        state.rafId = null;
        return;
      }
      positionBubble(el);
      if (Date.now() < state.visibleUntil) {
        state.rafId = raf(tick);
        return;
      }
      state.rafId = null;
    };
    state.rafId = raf(tick);
  }

  function resetTimers() {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
    if (state.animTimer) {
      clearTimeout(state.animTimer);
      state.animTimer = null;
    }
  }

  function removeBubble() {
    resetTimers();
    stopFollowLoop();
    const el = document.getElementById(BUBBLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function replayEnterAnimation(el) {
    if (!el) return;
    el.classList.remove(ANIM_CLASS);
    // Force reflow so class re-add reliably replays animation for rapid replacements.
    void el.offsetWidth;
    el.classList.add(ANIM_CLASS);
    if (state.animTimer) clearTimeout(state.animTimer);
    state.animTimer = setTimeout(() => {
      if (!el || !el.isConnected) return;
      el.classList.remove(ANIM_CLASS);
      state.animTimer = null;
    }, 340);
  }

  function showSaveTip(text, options) {
    const opts = options && typeof options === "object" ? options : {};
    const el = ensureBubble();
    setTextAndKind(el, text, opts.kind);
    positionBubble(el);
    replayEnterAnimation(el);

    state.visibleUntil = Date.now() + VISIBLE_MS;
    startFollowLoop(el);
    resetTimers();
    state.hideTimer = setTimeout(() => {
      removeBubble();
    }, VISIBLE_MS);
  }

  NS.inpageTip = { showSaveTip };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.inpageTip;
})();
