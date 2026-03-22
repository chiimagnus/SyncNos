// @ts-nocheck
import { storageGet } from '@platform/storage/local';

const STORAGE_KEY = 'notion_ai_preferred_model_index';
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
  return /(^|\.)notion\.so$/.test(String(location.hostname || ''));
}

function isAutoModelLabel(text) {
  const value = String(text || '').trim();
  return /^(自动|Auto)$/i.test(value);
}

function getModelButton() {
  return document.querySelector('div[role="button"][data-testid="unified-chat-model-button"]');
}

function getSendButton() {
  return document.querySelector('div[role="button"][data-testid="agent-send-message-button"]');
}

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return false;
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
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
    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    }
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
  let host = startEl;
  for (let depth = 0; depth < 25 && host; depth += 1) {
    if (host.querySelector) {
      const hasInput = !!host.querySelector(
        'div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]',
      );
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
    root.querySelectorAll('div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]'),
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
    if (!sel || typeof sel.removeAllRanges !== 'function') return false;
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

  const ok = fireClick(input);
  try {
    input.focus && input.focus();
  } catch (_e) {
    // ignore
  }

  setCaretToEnd(input);
  return ok;
}

function restoreFocusToComposerWithRetry() {
  const delays = [0, 80, 180, 320];
  for (const delay of delays) {
    setTimeout(() => restoreFocusToComposer(), delay);
  }
}

function findModelMenu() {
  const menus = Array.from(document.querySelectorAll('[role="menu"]'));
  for (const menu of menus) {
    if (!isVisible(menu)) continue;
    const text = String(menu.innerText || menu.textContent || '');
    if (!/自动|Auto/i.test(text)) continue;
    if (!/Sonnet|Opus|Gemini|GPT/i.test(text)) continue;
    const items = menu.querySelectorAll('[role="menuitem"]');
    if (items && items.length >= 2) return menu;
  }
  return null;
}

async function loadPreferredIndex1Based() {
  const t = now();
  if (cachedIndex1Based !== null && t - cachedIndexAt < STORAGE_CACHE_TTL_MS) {
    return cachedIndex1Based;
  }
  if (indexReadPromise) return indexReadPromise;

  indexReadPromise = (async () => {
    const res = await storageGet([STORAGE_KEY]).catch(() => ({}));
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
  const expanded = String(btn.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
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

  const label = String(btn.innerText || btn.textContent || '').trim();
  if (!isAutoModelLabel(label)) return;

  lastAppliedAt = t;
  try {
    const index1Based = await loadPreferredIndex1Based();
    await ensurePreferredModel({ index1Based });
  } catch (e) {
    if (t - lastErrorAt > 15000) {
      lastErrorAt = t;
      // eslint-disable-next-line no-console
      console.warn('WebClipper NotionAI model picker failed:', e);
    }
  }
}

export { maybeApply, STORAGE_KEY, DEFAULT_INDEX_1_BASED };
const notionAiModelPicker = { maybeApply, STORAGE_KEY, DEFAULT_INDEX_1_BASED };
export default notionAiModelPicker;
