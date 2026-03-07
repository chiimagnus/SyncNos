import inpageCssRaw from '../styles/inpage.css?raw';
const BUBBLE_ID = 'webclipper-inpage-bubble';
const INPAGE_BTN_ID = 'webclipper-inpage-btn';
const VISIBLE_MS = 1800;
const ANIM_CLASS = 'is-enter';
const VIEWPORT_PAD = 10;
const ANCHOR_GAP = 10;
const BUBBLE_FONT = '12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

const BASE_BUBBLE_HOST_STYLES = Object.freeze([
  ['display', 'block'],
  ['position', 'fixed'],
  ['z-index', '2147483647'],
  ['box-sizing', 'border-box'],
  ['max-width', 'min(300px, 100vw)'],
  ['padding', '7px 11px'],
  ['border-radius', '12px'],
  ['color', '#ffffff'],
  ['font', BUBBLE_FONT],
  ['letter-spacing', '0.01em'],
  ['box-shadow', '0 12px 28px rgba(0, 0, 0, 0.28)'],
  ['pointer-events', 'none'],
  ['user-select', 'none'],
  ['word-break', 'break-word'],
  ['white-space', 'normal'],
]);

const KIND_BUBBLE_HOST_STYLES = Object.freeze({
  default: {
    background:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0)), rgba(24, 24, 26, 0.92)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
  },
  loading: {
    background:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0)), rgba(184, 88, 26, 0.92)',
    border: '1px solid rgba(255, 196, 138, 0.72)',
  },
  error: {
    background:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0)), rgba(156, 33, 33, 0.94)',
    border: '1px solid rgba(255, 157, 157, 0.78)',
  },
} as const);

function toBubbleHostCss(css: string) {
  return css
    .replaceAll(
      '.webclipper-inpage-bubble[data-placement="left"] .webclipper-inpage-bubble__arrow',
      ':host([data-placement="left"]) .webclipper-inpage-bubble__arrow',
    )
    .replaceAll(
      '.webclipper-inpage-bubble[data-placement="right"] .webclipper-inpage-bubble__arrow',
      ':host([data-placement="right"]) .webclipper-inpage-bubble__arrow',
    )
    .replaceAll(
      '.webclipper-inpage-bubble[data-placement="top"] .webclipper-inpage-bubble__arrow',
      ':host([data-placement="top"]) .webclipper-inpage-bubble__arrow',
    )
    .replaceAll(
      '.webclipper-inpage-bubble[data-placement="bottom"] .webclipper-inpage-bubble__arrow',
      ':host([data-placement="bottom"]) .webclipper-inpage-bubble__arrow',
    )
    .replaceAll('.webclipper-inpage-bubble.is-enter', ':host(.is-enter)')
    .replaceAll('.webclipper-inpage-bubble[data-kind="loading"]', ':host([data-kind="loading"])')
    .replaceAll('.webclipper-inpage-bubble[data-kind="error"]', ':host([data-kind="error"])')
    .replaceAll('.webclipper-inpage-bubble[data-placement="left"]', ':host([data-placement="left"])')
    .replaceAll('.webclipper-inpage-bubble[data-placement="right"]', ':host([data-placement="right"])')
    .replaceAll('.webclipper-inpage-bubble[data-placement="top"]', ':host([data-placement="top"])')
    .replaceAll('.webclipper-inpage-bubble[data-placement="bottom"]', ':host([data-placement="bottom"])')
    .replace(/\.webclipper-inpage-bubble(?!_)/g, ':host');
}

const BUBBLE_SHADOW_CSS = toBubbleHostCss(String(inpageCssRaw || ''));

type TipKind = 'default' | 'loading' | 'error';

const state = {
  hideTimer: null as any,
  animTimer: null as any,
  rafId: null as any,
  visibleUntil: 0,
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function getDoc() {
  return document;
}

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function applyBaseBubbleHostStyles(el: HTMLElement) {
  for (const [name, value] of BASE_BUBBLE_HOST_STYLES) {
    setImportantStyle(el, name, value);
  }
}

function applyKindBubbleHostStyles(el: HTMLElement, kind: TipKind) {
  const styles = KIND_BUBBLE_HOST_STYLES[kind] || KIND_BUBBLE_HOST_STYLES.default;
  setImportantStyle(el, 'background', styles.background);
  setImportantStyle(el, 'border', styles.border);
}

function getViewport() {
  return {
    width: Math.max(1, Number(window.innerWidth) || 1),
    height: Math.max(1, Number(window.innerHeight) || 1),
  };
}

function getAnchorRect() {
  const doc = getDoc();
  const btn = doc.getElementById(INPAGE_BTN_ID);
  if (!btn) return null;
  try {
    return btn.getBoundingClientRect();
  } catch (_e) {
    return null;
  }
}

function inferPlacement(anchor: any, viewport: { width: number; height: number }) {
  const distances = [
    { edge: 'left', value: anchor.left },
    { edge: 'right', value: viewport.width - anchor.right },
    { edge: 'top', value: anchor.top },
    { edge: 'bottom', value: viewport.height - anchor.bottom },
  ].sort((a, b) => a.value - b.value);

  const closest = distances[0] && distances[0].edge;
  if (closest === 'left') return 'right';
  if (closest === 'right') return 'left';
  if (closest === 'top') return 'bottom';
  return 'top';
}

function computeBubblePosition(
  anchorRect: any,
  bubbleRect: any,
  viewport: { width: number; height: number },
  placement: string,
) {
  const width = Math.max(1, Math.round((bubbleRect as any).width || 1));
  const height = Math.max(1, Math.round((bubbleRect as any).height || 1));
  const anchorCx = anchorRect.left + Math.max(1, anchorRect.width || 1) / 2;
  const anchorCy = anchorRect.top + Math.max(1, anchorRect.height || 1) / 2;

  let left = VIEWPORT_PAD;
  let top = VIEWPORT_PAD;

  if (placement === 'left') {
    left = anchorRect.left - width - ANCHOR_GAP;
    top = anchorCy - height / 2;
  } else if (placement === 'right') {
    left = anchorRect.right + ANCHOR_GAP;
    top = anchorCy - height / 2;
  } else if (placement === 'bottom') {
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
    placement,
  };
}

function ensureBubble() {
  const doc = getDoc();
  if (!doc || !doc.documentElement) return null;

  const existing = doc.getElementById(BUBBLE_ID) as HTMLElement | null;
  if (existing) return existing;

  const bubble = document.createElement('webclipper-inpage-bubble');
  bubble.id = BUBBLE_ID;
  bubble.className = 'webclipper-inpage-bubble';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  applyBaseBubbleHostStyles(bubble);
  applyKindBubbleHostStyles(bubble, 'default');

  const shadow = bubble.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = BUBBLE_SHADOW_CSS;
  shadow.appendChild(style);

  const text = document.createElement('span');
  text.className = 'webclipper-inpage-bubble__text';
  shadow.appendChild(text);

  const arrow = document.createElement('span');
  arrow.className = 'webclipper-inpage-bubble__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  shadow.appendChild(arrow);

  doc.documentElement.appendChild(bubble);
  return bubble;
}

function setTextAndKind(el: HTMLElement, text: unknown, kind?: TipKind) {
  const shadow = (el as any).shadowRoot as ShadowRoot | null;
  const textEl = shadow?.querySelector?.('.webclipper-inpage-bubble__text') as HTMLElement | null;
  if (textEl) textEl.textContent = String(text || '');
  const normalizedKind: TipKind = kind === 'error' || kind === 'loading' ? kind : 'default';
  applyKindBubbleHostStyles(el, normalizedKind);
  (el as any).dataset.kind = normalizedKind;
}

function positionBubble(el: HTMLElement) {
  if (!el || !(el as any).isConnected) return;
  const viewport = getViewport();
  const anchorRect = getAnchorRect();
  if (!anchorRect) return;
  const bubbleRect = el.getBoundingClientRect();
  const placement = inferPlacement(anchorRect, viewport);
  const pos = computeBubblePosition(anchorRect, bubbleRect, viewport, placement);

  (el as any).dataset.placement = pos.placement;
  setImportantStyle(el, 'left', `${Math.round(pos.left)}px`);
  setImportantStyle(el, 'top', `${Math.round(pos.top)}px`);
}

function stopFollowLoop() {
  const caf =
    typeof (globalThis as any).cancelAnimationFrame === 'function'
      ? (globalThis as any).cancelAnimationFrame.bind(globalThis)
      : clearTimeout;
  if (state.rafId != null) {
    caf(state.rafId);
    state.rafId = null;
  }
}

function startFollowLoop(el: HTMLElement) {
  stopFollowLoop();
  const raf =
    typeof (globalThis as any).requestAnimationFrame === 'function'
      ? (globalThis as any).requestAnimationFrame.bind(globalThis)
      : (cb: any) => setTimeout(cb, 16);
  const tick = () => {
    if (!el || !(el as any).isConnected) {
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
  const doc = getDoc();
  if (!doc) return;
  const el = doc.getElementById(BUBBLE_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function replayEnterAnimation(el: HTMLElement) {
  if (!el) return;
  el.classList.remove(ANIM_CLASS);
  // Force reflow so class re-add reliably replays animation for rapid replacements.
  void (el as any).offsetWidth;
  el.classList.add(ANIM_CLASS);
  if (state.animTimer) clearTimeout(state.animTimer);
  state.animTimer = setTimeout(() => {
    if (!el || !(el as any).isConnected) return;
    el.classList.remove(ANIM_CLASS);
    state.animTimer = null;
  }, 340);
}

function showSaveTip(text: unknown, options?: { kind?: TipKind }) {
  const opts = options && typeof options === 'object' ? options : {};
  const el = ensureBubble();
  if (!el) return;
  resetTimers();
  setTextAndKind(el, text, (opts as any).kind);
  positionBubble(el);
  replayEnterAnimation(el);

  state.visibleUntil = Date.now() + VISIBLE_MS;
  startFollowLoop(el);
  state.hideTimer = setTimeout(() => {
    removeBubble();
  }, VISIBLE_MS);
}

export const inpageTipApi = { showSaveTip };
