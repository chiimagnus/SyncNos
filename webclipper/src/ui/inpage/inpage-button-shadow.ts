import inpageButtonCssRaw from '../styles/inpage-button.css?raw';
type InpageRuntime = { getURL?: (path: string) => string } | null;

const INPAGE_BTN_ID = 'webclipper-inpage-btn';
const INPAGE_BTN_STORAGE_KEY_V2 = 'webclipper_btn_pos_inpage_v2';
const INPAGE_BTN_STORAGE_KEY_V3 = 'webclipper_btn_pos_inpage_v3';
const EDGE_GAP = 0;
const INPAGE_BUTTON_LABEL = 'WebClipper: Save';
const COMBO_WINDOW_MS = 400;
const EASTER_CLASSES = Object.freeze({
  3: 'is-easter-3',
  5: 'is-easter-5',
  7: 'is-easter-7',
});
const EASTER_DURATION_MS = Object.freeze({
  3: 520,
  5: 760,
  7: 1100,
});

function toButtonHostCss(css: string) {
  return css
    .replaceAll('.webclipper-inpage-btn:hover', ':host(:hover)')
    .replaceAll('.webclipper-inpage-btn:focus-visible', ':host(:focus-visible)')
    .replaceAll('.webclipper-inpage-btn.is-easter-3', ':host(.is-easter-3)')
    .replaceAll('.webclipper-inpage-btn.is-easter-5', ':host(.is-easter-5)')
    .replaceAll('.webclipper-inpage-btn.is-easter-7', ':host(.is-easter-7)')
    .replace(/\.webclipper-inpage-btn(?!_)/g, ':host');
}

const BUTTON_SHADOW_CSS = toButtonHostCss(String(inpageButtonCssRaw || ''));

let runtime: InpageRuntime = null;

function initRuntime(nextRuntime: InpageRuntime) {
  runtime = nextRuntime || null;
}

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function applyButtonHostLayoutStyles(el: HTMLElement) {
  setImportantStyle(el, 'display', 'inline-flex');
  setImportantStyle(el, 'position', 'fixed');
  setImportantStyle(el, 'z-index', '2147483647');
  setImportantStyle(el, 'margin', '0');
  setImportantStyle(el, 'padding', '0');
  setImportantStyle(el, 'border', '0');
  setImportantStyle(el, 'background', 'transparent');
  setImportantStyle(el, 'cursor', 'pointer');
  setImportantStyle(el, 'user-select', 'none');
  setImportantStyle(el, 'box-shadow', 'none');
  setImportantStyle(el, 'isolation', 'isolate');
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number) {
  return clamp(v, 0, 1);
}

function getButtonSize(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.round((rect as any).width || (el as any).offsetWidth || 1));
  const height = Math.max(1, Math.round((rect as any).height || (el as any).offsetHeight || 1));
  return { width, height };
}

function getSnappedRange(edge: string, size: { width: number; height: number }) {
  const { width, height } = size;
  if (edge === 'left' || edge === 'right') {
    const min = EDGE_GAP;
    const max = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
    const range = Math.max(0, max - min);
    return { axis: 'y', min, max, range };
  }
  const min = EDGE_GAP;
  const max = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
  const range = Math.max(0, max - min);
  return { axis: 'x', min, max, range };
}

function resolveOffsetFromState(
  edge: string,
  size: { width: number; height: number },
  state: any,
) {
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

function applySnappedPosition(el: HTMLElement, state: any) {
  if (!state || !state.edge) return null;
  const size = getButtonSize(el);
  const { width, height } = size;
  const maxLeft = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
  const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
  const edge = state.edge;
  const resolved = resolveOffsetFromState(edge, size, state);

  (el.style as any).position = 'fixed';
  if (edge === 'left') {
    const top = clamp(resolved.offset, EDGE_GAP, maxTop);
    el.style.left = `${EDGE_GAP}px`;
    el.style.right = 'auto';
    el.style.top = `${top}px`;
    el.style.bottom = 'auto';
    return { edge, ratio: resolved.ratio };
  }
  if (edge === 'right') {
    const top = clamp(resolved.offset, EDGE_GAP, maxTop);
    el.style.left = 'auto';
    el.style.right = `${EDGE_GAP}px`;
    el.style.top = `${top}px`;
    el.style.bottom = 'auto';
    return { edge, ratio: resolved.ratio };
  }
  if (edge === 'top') {
    const left = clamp(resolved.offset, EDGE_GAP, maxLeft);
    el.style.left = `${left}px`;
    el.style.right = 'auto';
    el.style.top = `${EDGE_GAP}px`;
    el.style.bottom = 'auto';
    return { edge, ratio: resolved.ratio };
  }
  if (edge === 'bottom') {
    const left = clamp(resolved.offset, EDGE_GAP, maxLeft);
    el.style.left = `${left}px`;
    el.style.right = 'auto';
    el.style.top = 'auto';
    el.style.bottom = `${EDGE_GAP}px`;
    return { edge, ratio: resolved.ratio };
  }
  return null;
}

function snapToClosestEdge(el: HTMLElement, desiredLeft: number, desiredTop: number) {
  const size = getButtonSize(el);
  const { width, height } = size;
  const maxLeft = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
  const maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
  const left = clamp(desiredLeft, EDGE_GAP, maxLeft);
  const top = clamp(desiredTop, EDGE_GAP, maxTop);

  const distances = [
    { edge: 'left', distance: left - EDGE_GAP },
    { edge: 'right', distance: window.innerWidth - (left + width) - EDGE_GAP },
    { edge: 'top', distance: top - EDGE_GAP },
    { edge: 'bottom', distance: window.innerHeight - (top + height) - EDGE_GAP },
  ];
  distances.sort((a, b) => a.distance - b.distance);

  const closest = distances[0];
  const edge = closest.edge;
  const offset = edge === 'left' || edge === 'right' ? top : left;
  const range = getSnappedRange(edge, size);
  const ratio = range.range > 0 ? (offset - range.min) / range.range : 0;
  return applySnappedPosition(el, { edge, ratio: clamp01(ratio) });
}

function resolveComboLevel(count: number) {
  if (count >= 7) return 7;
  if (count >= 5) return 5;
  if (count >= 3) return 3;
  return 0;
}

function destroyButton(el: HTMLElement | null) {
  if (!el) return;
  const cleanup = (el as any).__webclipperCleanup;
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (_e) {
      // ignore
    }
  }
  el.remove();
}

function ensureButtonShadow(btn: HTMLElement) {
  const existing = (btn as any).__webclipperShadowReady === true;
  if (existing) return;

  const shadow = btn.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = BUTTON_SHADOW_CSS;
  shadow.appendChild(style);

  const icon = document.createElement('img');
  icon.className = 'webclipper-inpage-btn__icon';
  icon.alt = '';
  icon.decoding = 'async';
  icon.loading = 'eager';
  icon.draggable = false;
  icon.setAttribute('aria-hidden', 'true');

  const iconUrl =
    runtime && typeof runtime.getURL === 'function' ? runtime.getURL('icons/icon-128.png') : '';
  if (iconUrl) icon.src = iconUrl;

  icon.addEventListener('dragstart', (e) => e.preventDefault());
  icon.addEventListener('error', () => {
    try {
      // Fallback: show text label in host.
      btn.textContent = INPAGE_BUTTON_LABEL;
    } catch (_e) {
      // ignore
    }
  });

  if (iconUrl) {
    shadow.appendChild(icon);
  } else {
    btn.textContent = INPAGE_BUTTON_LABEL;
  }

  (btn as any).__webclipperShadowReady = true;
}

function ensureInpageButton({
  collectorId,
  onClick,
  onDoubleClick,
  onCombo,
}: {
  collectorId?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onCombo?: (payload: { level: number; count: number }) => void;
}) {
  if (!collectorId) return;

  const existing = document.getElementById(INPAGE_BTN_ID) as HTMLElement | null;
  if (existing) {
    if (existing.dataset.sourceId === collectorId) {
      // Ensure Shadow DOM is initialized even if legacy button existed.
      try {
        if (!existing.shadowRoot) ensureButtonShadow(existing);
      } catch (_e) {
        // ignore
      }
      return;
    }
    destroyButton(existing);
  }

  // Shadow DOM is disallowed on HTMLButtonElement by the spec; use a custom element as the host.
  const btn = document.createElement('webclipper-inpage-btn');
  btn.id = INPAGE_BTN_ID;
  btn.className = 'webclipper-inpage-btn';
  btn.dataset.sourceId = collectorId;
  btn.title = INPAGE_BUTTON_LABEL;
  btn.setAttribute('aria-label', INPAGE_BUTTON_LABEL);
  btn.setAttribute('role', 'button');
  (btn as any).tabIndex = 0;
  applyButtonHostLayoutStyles(btn);

  ensureButtonShadow(btn);

  let snappedState: any = null;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let comboCount = 0;
  let comboTimer: any = null;
  let easterTimer: any = null;

  function clearEasterAnimation() {
    if (easterTimer) {
      clearTimeout(easterTimer);
      easterTimer = null;
    }
    Object.values(EASTER_CLASSES).forEach((name) => btn.classList.remove(name));
  }

  function replayEasterAnimation(level: number) {
    const cls = (EASTER_CLASSES as any)[level];
    if (!cls) return;
    clearEasterAnimation();
    // Force reflow so same-class animation can replay on rapid combo repeats.
    void (btn as any).offsetWidth;
    btn.classList.add(cls);
    const duration = (EASTER_DURATION_MS as any)[level] || 800;
    easterTimer = setTimeout(() => {
      btn.classList.remove(cls);
      easterTimer = null;
    }, duration);
  }

  function resetComboState() {
    if (comboTimer) {
      clearTimeout(comboTimer);
      comboTimer = null;
    }
    comboCount = 0;
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
      onDoubleClick && onDoubleClick();
      return;
    }

    const level = resolveComboLevel(finalCount);
    if (!level) return;
    replayEasterAnimation(level);
    onCombo && onCombo({ level, count: finalCount });
  }

  function scheduleComboSettle() {
    if (comboTimer) clearTimeout(comboTimer);
    comboTimer = setTimeout(() => settleCombo(), COMBO_WINDOW_MS);
  }

  const onClickCapture = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragging) return;
    if (moved) return;
    comboCount += 1;
    scheduleComboSettle();
  };

  btn.addEventListener('click', onClickCapture, true);

  const onPointerDown = (e: PointerEvent) => {
    if ((e as any).button !== 0) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    try {
      (btn as any).setPointerCapture?.(e.pointerId);
    } catch (_e) {
      // ignore
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) >= 3) moved = true;
    const nextLeft = startLeft + dx;
    const nextTop = startTop + dy;
    snapToClosestEdge(btn, nextLeft, nextTop);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      (btn as any).releasePointerCapture?.(e.pointerId);
    } catch (_e) {
      // ignore
    }
    try {
      const rect = btn.getBoundingClientRect();
      snappedState = snapToClosestEdge(btn, rect.left, rect.top);
      if (snappedState) localStorage.setItem(INPAGE_BTN_STORAGE_KEY_V3, JSON.stringify(snappedState));
    } catch (_e) {
      // ignore
    }
  };

  btn.addEventListener('pointerdown', onPointerDown);
  btn.addEventListener('pointermove', onPointerMove);
  btn.addEventListener('pointerup', onPointerUp);
  btn.addEventListener('pointercancel', onPointerUp);

  document.documentElement.appendChild(btn);

  // Restore persisted position (v3 ratio preferred).
  try {
    const rawV3 = localStorage.getItem(INPAGE_BTN_STORAGE_KEY_V3);
    if (rawV3) {
      const parsed = JSON.parse(rawV3);
      const applied = applySnappedPosition(btn, parsed);
      if (applied) snappedState = applied;
    } else {
      const rawV2 = localStorage.getItem(INPAGE_BTN_STORAGE_KEY_V2);
      if (rawV2) {
        const parsed = JSON.parse(rawV2);
        if (parsed && parsed.edge) {
          snappedState = applySnappedPosition(btn, parsed);
        }
      }
    }
  } catch (_e) {
    // ignore and fallback
  }

  if (!snappedState) {
    const rect = btn.getBoundingClientRect();
    snappedState = snapToClosestEdge(btn, rect.left, rect.top);
  }

  if (snappedState) {
    try {
      localStorage.setItem(INPAGE_BTN_STORAGE_KEY_V3, JSON.stringify(snappedState));
    } catch (_e) {
      // ignore
    }
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
  window.addEventListener('resize', onResize);

  (btn as any).__webclipperCleanup = () => {
    resetComboState();
    clearEasterAnimation();
    window.removeEventListener('resize', onResize);
    btn.removeEventListener('click', onClickCapture, true);
    btn.removeEventListener('pointerdown', onPointerDown);
    btn.removeEventListener('pointermove', onPointerMove);
    btn.removeEventListener('pointerup', onPointerUp);
    btn.removeEventListener('pointercancel', onPointerUp);
  };
}

function cleanupButtons(activeCollectorId: string) {
  const active = activeCollectorId || '';
  if (!active) {
    const el = document.getElementById(INPAGE_BTN_ID) as HTMLElement | null;
    if (el) destroyButton(el);
  }
  // Cleanup legacy Notion button id from older versions.
  const legacyNotionBtn = document.getElementById('webclipper-notionai-btn');
  if (legacyNotionBtn) legacyNotionBtn.remove();
}

export const inpageButtonApi = {
  initRuntime,
  ensureInpageButton,
  cleanupButtons,
};
