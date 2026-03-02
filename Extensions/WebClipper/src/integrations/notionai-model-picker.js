/* global chrome */

(function () {
  const NS = require("../runtime-context.js");

  const STORAGE_KEY = "notion_ai_preferred_model_index";
  // 1-based: menu order includes "自动" at #1.
  const DEFAULT_INDEX_1_BASED = 3;

  const APPLY_MIN_INTERVAL_MS = 2500;
  const STORAGE_CACHE_TTL_MS = 5000;

  let cachedIndex1Based = null;
  let cachedIndexAt = 0;
  let indexReadPromise = null;
  let lastAppliedAt = 0;
  let lastErrorAt = 0;

  function now() {
    return Date.now();
  }

  function isNotionHost() {
    return /(^|\.)notion\.so$/.test(String(location.hostname || ""));
  }

  function isAutoModelLabel(text) {
    const t = String(text || "").trim();
    return /^(自动|Auto)$/i.test(t);
  }

  function getModelButton() {
    return document.querySelector('div[role="button"][data-testid="unified-chat-model-button"]');
  }

  function getSendButton() {
    return document.querySelector('div[role="button"][data-testid="agent-send-message-button"]');
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    if (r.bottom < 0 || r.right < 0) return false;
    if (r.top > window.innerHeight || r.left > window.innerWidth) return false;
    return true;
  }

  function fireClick(el) {
    if (!el) return false;
    try {
      el.focus && el.focus();
    } catch (_e) {
      // ignore
    }
    try {
      if (typeof PointerEvent !== "undefined") {
        el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
        el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }));
      }
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    } catch (_e) {
      try {
        el.click && el.click();
        return true;
      } catch (_e2) {
        return false;
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findComposerRoot(startEl) {
    // Anchors on the composer controls (send/model) and finds the nearest
    // ancestor that also contains the editable textbox.
    let host = startEl;
    for (let depth = 0; depth < 25 && host; depth += 1) {
      if (host.querySelector) {
        const hasInput = !!host.querySelector('div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]');
        const hasSend = !!host.querySelector('div[role="button"][data-testid="agent-send-message-button"]');
        const hasModel = !!host.querySelector('div[role="button"][data-testid="unified-chat-model-button"]');
        if (hasInput && (hasSend || hasModel)) return host;
      }
      host = host.parentElement;
    }
    return null;
  }

  function getComposerInput() {
    const send = getSendButton();
    const model = getModelButton();
    const root = findComposerRoot(send || model);
    if (!root || !root.querySelectorAll) return null;
    const inputs = Array.from(
      root.querySelectorAll('div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]')
    );
    for (const input of inputs) {
      if (isVisible(input)) return input;
    }
    return null;
  }

  function setCaretToEnd(el) {
    if (!el) return false;
    try {
      const sel = globalThis.getSelection && getSelection();
      if (!sel || typeof sel.removeAllRanges !== "function") return false;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function restoreFocusToComposer() {
    const input = getComposerInput();
    if (!input) return false;

    // Notion editor sometimes ignores plain `focus()`; click tends to work better.
    const ok = fireClick(input);
    try {
      input.focus && input.focus();
    } catch (_e) {
      // ignore
    }
    // Keep cursor at the end, so user can continue typing immediately.
    setCaretToEnd(input);
    return ok;
  }

  function restoreFocusToComposerWithRetry() {
    const delays = [0, 80, 180, 320];
    for (const d of delays) {
      setTimeout(() => restoreFocusToComposer(), d);
    }
  }

  function findModelMenu() {
    const menus = Array.from(document.querySelectorAll('[role="menu"]'));
    for (const m of menus) {
      if (!isVisible(m)) continue;
      const txt = String(m.innerText || m.textContent || "");
      // Heuristic: this menu includes "自动" and at least one model name.
      if (!/自动|Auto/i.test(txt)) continue;
      if (!/Sonnet|Opus|Gemini|GPT/i.test(txt)) continue;
      const items = m.querySelectorAll('[role="menuitem"]');
      if (items && items.length >= 2) return m;
    }
    return null;
  }

  function getFromStorage(keys) {
    const api = globalThis.chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get
      ? chrome.storage.local
      : null;
    if (!api) return Promise.resolve({});
    return new Promise((resolve) => {
      try {
        api.get(keys, (res) => resolve(res || {}));
      } catch (_e) {
        resolve({});
      }
    });
  }

  async function loadPreferredIndex1Based() {
    const t = now();
    if (cachedIndex1Based !== null && t - cachedIndexAt < STORAGE_CACHE_TTL_MS) {
      return cachedIndex1Based;
    }
    if (indexReadPromise) return indexReadPromise;

    indexReadPromise = (async () => {
      const res = await getFromStorage([STORAGE_KEY]);
      const raw = res ? res[STORAGE_KEY] : null;
      const n = Number(raw);
      const idx = Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_INDEX_1_BASED;
      cachedIndex1Based = idx;
      cachedIndexAt = now();
      return idx;
    })();

    try {
      return await indexReadPromise;
    } finally {
      indexReadPromise = null;
    }
  }

  async function ensurePreferredModel({ index1Based }) {
    const btn = getModelButton();
    if (!btn || !isVisible(btn)) return false;

    const activeBefore = document.activeElement;

    const expanded = String(btn.getAttribute("aria-expanded") || "").toLowerCase() === "true";
    if (!expanded) {
      fireClick(btn);
      await sleep(120);
    }

    let menu = findModelMenu();
    for (let i = 0; i < 8 && !menu; i += 1) {
      await sleep(80);
      menu = findModelMenu();
    }
    if (!menu) return false;

    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!items.length) return false;

    const idx0 = Math.max(0, Math.min(items.length - 1, Number(index1Based) - 1));
    const target = items[idx0];
    if (!target) return false;

    const ok = fireClick(target);
    if (ok) {
      // After clicking a menu item, Notion may leave focus in the model menu/button.
      // Put focus back to the composer input to reduce extra clicks.
      const send = getSendButton();
      const root = findComposerRoot(send || btn);
      const shouldRestore =
        !activeBefore ||
        activeBefore === document.body ||
        activeBefore === document.documentElement ||
        (root && root.contains(activeBefore));
      if (shouldRestore) restoreFocusToComposerWithRetry();
    }
    return ok;
  }

  async function maybeApply() {
    if (!isNotionHost()) return;

    const t = now();
    if (t - lastAppliedAt < APPLY_MIN_INTERVAL_MS) return;

    const btn = getModelButton();
    if (!btn) return;

    // Only override NotionAI default "自动/Auto" to avoid fighting user manual selection.
    const label = String(btn.innerText || btn.textContent || "").trim();
    if (!isAutoModelLabel(label)) return;

    lastAppliedAt = t;
    try {
      const index1Based = await loadPreferredIndex1Based();
      await ensurePreferredModel({ index1Based });
    } catch (e) {
      // Non-critical enhancement: keep capture/sync flows unaffected.
      if (t - lastErrorAt > 15000) {
        lastErrorAt = t;
        // eslint-disable-next-line no-console
        console.warn("WebClipper NotionAI model picker failed:", e);
      }
    }
  }

  NS.notionAiModelPicker = { maybeApply, STORAGE_KEY, DEFAULT_INDEX_1_BASED };
})();
