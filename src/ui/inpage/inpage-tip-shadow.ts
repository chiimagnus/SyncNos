import inpageTipCssRaw from '@ui/styles/inpage-tip.css?raw';
import tokensCssRaw from '@ui/styles/tokens.css?raw';
import { CAPTURE_ACTIVITY_VISIBLE_MS } from '@services/shared/capture-tip';
const BUBBLE_ID = 'webclipper-inpage-bubble';
const INPAGE_BTN_ID = 'webclipper-inpage-btn';
const ANIM_CLASS = 'is-enter';
const VIEWPORT_PAD = 10;
const ANCHOR_GAP = 10;

function toHostTokensCss(css: string) {
  return css.replaceAll(':root', ':host');
}

const BUBBLE_SHADOW_CSS = `${toHostTokensCss(tokensCssRaw)}\n${inpageTipCssRaw}`;

type TipKind = 'default' | 'error';

const state = {
  hideTimer: null as ReturnType<typeof setTimeout> | null,
  animTimer: null as ReturnType<typeof setTimeout> | null,
  followTimer: null as ReturnType<typeof setTimeout> | null,
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function applyBubbleHostLayoutStyles(el: HTMLElement) {
  setImportantStyle(el, 'display', 'block');
  setImportantStyle(el, 'position', 'fixed');
  setImportantStyle(el, 'z-index', '2147483647');
  setImportantStyle(el, 'pointer-events', 'none');
  setImportantStyle(el, 'margin', '0');
  setImportantStyle(el, 'padding', '0');
  setImportantStyle(el, 'border', '0');
  setImportantStyle(el, 'background', 'transparent');
}

function getViewport() {
  return {
    width: Math.max(1, Number(window.innerWidth) || 1),
    height: Math.max(1, Number(window.innerHeight) || 1),
  };
}

function getAnchorRect() {
  return document.getElementById(INPAGE_BTN_ID)?.getBoundingClientRect() ?? null;
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
  const doc = document;
  if (!doc.documentElement) return null;

  const existing = doc.getElementById(BUBBLE_ID) as HTMLElement | null;
  if (existing) return existing;

  const bubble = document.createElement('webclipper-inpage-bubble');
  bubble.id = BUBBLE_ID;
  bubble.className = 'webclipper-inpage-bubble';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  applyBubbleHostLayoutStyles(bubble);

  const shadow = bubble.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = BUBBLE_SHADOW_CSS;
  shadow.appendChild(style);

  const surface = document.createElement('div');
  surface.className = 'webclipper-inpage-bubble__surface';
  shadow.appendChild(surface);

  const text = document.createElement('span');
  text.className = 'webclipper-inpage-bubble__text';
  surface.appendChild(text);

  const arrow = document.createElement('span');
  arrow.className = 'webclipper-inpage-bubble__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  surface.appendChild(arrow);

  doc.documentElement.appendChild(bubble);
  return bubble;
}

function setTextAndKind(el: HTMLElement, text: unknown, kind?: TipKind) {
  const textEl = el.shadowRoot?.querySelector<HTMLElement>('.webclipper-inpage-bubble__text');
  if (textEl) textEl.textContent = String(text || '');
  el.dataset.kind = kind === 'error' ? 'error' : 'default';
}

function positionBubble(el: HTMLElement) {
  if (!el.isConnected) return;
  const viewport = getViewport();
  const bubbleRect = el.getBoundingClientRect();
  const anchorRect = getAnchorRect();
  if (!anchorRect) {
    const width = Math.max(1, Math.round((bubbleRect as any).width || 1));
    const height = Math.max(1, Math.round((bubbleRect as any).height || 1));
    const maxLeft = Math.max(VIEWPORT_PAD, viewport.width - width - VIEWPORT_PAD);
    const maxTop = Math.max(VIEWPORT_PAD, viewport.height - height - VIEWPORT_PAD);

    (el as any).dataset.placement = 'none';
    setImportantStyle(
      el,
      'left',
      `${Math.round(clamp(viewport.width - width - VIEWPORT_PAD, VIEWPORT_PAD, maxLeft))}px`,
    );
    setImportantStyle(
      el,
      'top',
      `${Math.round(clamp(viewport.height - height - VIEWPORT_PAD, VIEWPORT_PAD, maxTop))}px`,
    );
    return;
  }
  const placement = inferPlacement(anchorRect, viewport);
  const pos = computeBubblePosition(anchorRect, bubbleRect, viewport, placement);

  (el as any).dataset.placement = pos.placement;
  setImportantStyle(el, 'left', `${Math.round(pos.left)}px`);
  setImportantStyle(el, 'top', `${Math.round(pos.top)}px`);
}

function startFollowLoop(el: HTMLElement) {
  const pageUrl = String(globalThis.location?.href || '');
  const tick = () => {
    state.followTimer = null;
    if (!el.isConnected) return;
    if (pageUrl !== String(globalThis.location?.href || '')) {
      removeBubble();
      return;
    }
    positionBubble(el);
    state.followTimer = setTimeout(tick, 100);
  };
  state.followTimer = setTimeout(tick, 100);
}

function resetTimers() {
  if (state.hideTimer !== null) clearTimeout(state.hideTimer);
  if (state.animTimer !== null) clearTimeout(state.animTimer);
  if (state.followTimer !== null) clearTimeout(state.followTimer);
  state.hideTimer = state.animTimer = state.followTimer = null;
}

function removeBubble() {
  resetTimers();
  const el = document.getElementById(BUBBLE_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function replayEnterAnimation(el: HTMLElement) {
  el.classList.remove(ANIM_CLASS);
  // Force reflow so class re-add reliably replays animation for rapid replacements.
  void (el as any).offsetWidth;
  el.classList.add(ANIM_CLASS);
  state.animTimer = setTimeout(() => {
    state.animTimer = null;
    if (el.isConnected) el.classList.remove(ANIM_CLASS);
  }, 340);
}

function showSaveTip(text: unknown, options?: { kind?: TipKind; expiresAt?: number }) {
  const el = ensureBubble();
  if (!el) return;
  resetTimers();
  setTextAndKind(el, text, options?.kind);
  positionBubble(el);
  replayEnterAnimation(el);

  const expiresAt = options?.expiresAt ?? Date.now() + CAPTURE_ACTIVITY_VISIBLE_MS;
  startFollowLoop(el);
  state.hideTimer = setTimeout(removeBubble, Math.max(0, expiresAt - Date.now()));
}

export const inpageTipApi = { showSaveTip, cleanup: removeBubble };
