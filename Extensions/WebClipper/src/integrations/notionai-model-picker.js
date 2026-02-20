/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

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

    return fireClick(target);
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

