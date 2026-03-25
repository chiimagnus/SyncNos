import inpageButtonCssRaw from '@ui/styles/inpage-button.css?raw';
type InpageRuntime = { getURL?: (path: string) => string } | null;

const INPAGE_BTN_ID = 'webclipper-inpage-btn';
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
    .replaceAll('.webclipper-inpage-btn.is-saving', ':host(.is-saving)')
    .replace(/\.webclipper-inpage-btn(?!_)/g, ':host');
}

const BUTTON_SHADOW_CSS = toButtonHostCss(String(inpageButtonCssRaw || ''));

let runtime: InpageRuntime = null;

type InpageButtonPositionEdge = 'left' | 'right' | 'top' | 'bottom';
type InpageButtonPositionState = {
  edge: InpageButtonPositionEdge;
  ratio: number;
};

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
  setImportantStyle(el, 'touch-action', 'none');
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

function resolveOffsetFromState(edge: string, size: { width: number; height: number }, state: any) {
  const range = getSnappedRange(edge, size);
  const ratio = state && Number.isFinite(state.ratio) ? clamp01(Number(state.ratio)) : 0;
  return { offset: range.min + ratio * range.range, ratio };
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

function readSnappedState(el: HTMLElement): any {
  return (el as any).__webclipperSnappedState || null;
}

function writeSnappedState(el: HTMLElement, state: any) {
  (el as any).__webclipperSnappedState = state || null;
}

function writeOnPositionChange(el: HTMLElement, onPositionChange?: (state: { edge: InpageButtonPositionEdge; ratio: number }) => void) {
  (el as any).__webclipperOnPositionChange = typeof onPositionChange === 'function' ? onPositionChange : null;
}

function readOnPositionChange(el: HTMLElement) {
  const fn = (el as any).__webclipperOnPositionChange;
  return typeof fn === 'function' ? fn : null;
}

function toExternalStateKey(state: { edge?: unknown; ratio?: unknown } | null | undefined) {
  const edge = state && state.edge ? String(state.edge) : '';
  const ratio = state && Number.isFinite((state as any).ratio) ? String((state as any).ratio) : '';
  return `${edge}:${ratio}`;
}

function readLastExternalStateKey(el: HTMLElement) {
  const value = (el as any).__webclipperExternalPositionStateKey;
  return typeof value === 'string' ? value : '';
}

function writeLastExternalStateKey(el: HTMLElement, key: string) {
  (el as any).__webclipperExternalPositionStateKey = String(key || '');
}

function applyExternalPositionState(el: HTMLElement, inputState: InpageButtonPositionState) {
  if (!inputState || !inputState.edge || !Number.isFinite(inputState.ratio)) return null;
  const nextKey = toExternalStateKey(inputState);
  if (nextKey && nextKey === readLastExternalStateKey(el)) return readSnappedState(el);
  const applied = applySnappedPosition(el, inputState);
  if (!applied) return null;
  writeSnappedState(el, applied);
  writeLastExternalStateKey(el, nextKey);
  return applied;
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

  const iconUrl = runtime && typeof runtime.getURL === 'function' ? runtime.getURL('icons/icon-128.png') : '';
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
  positionState,
  onPositionChange,
}: {
  collectorId?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onCombo?: (payload: { level: number; count: number }) => void;
  positionState?: InpageButtonPositionState | null;
  onPositionChange?: (state: { edge: InpageButtonPositionEdge; ratio: number }) => void;
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
      try {
        writeOnPositionChange(existing, onPositionChange);
        if (positionState && !existing.classList.contains('is-dragging')) {
          applyExternalPositionState(existing, positionState);
        }
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

  writeSnappedState(btn, null);
  writeOnPositionChange(btn, onPositionChange);

  let dragging = false;
  let moved = false;
  let activePointerId: number | null = null;
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

  const stopEvent = (event: Event) => {
    try {
      (event as any).preventDefault?.();
      (event as any).stopPropagation?.();
    } catch (_e) {
      // ignore
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if ((e as any).button != null && (e as any).button !== 0) return;
    stopEvent(e);
    dragging = true;
    moved = false;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    btn.classList.add('is-dragging');
    try {
      (btn as any).setPointerCapture?.(e.pointerId);
    } catch (_e) {
      // ignore
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    stopEvent(e);
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) >= 3) moved = true;
    const nextLeft = startLeft + dx;
    const nextTop = startTop + dy;
    snapToClosestEdge(btn, nextLeft, nextTop);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    stopEvent(e);
    dragging = false;
    activePointerId = null;
    btn.classList.remove('is-dragging');
    try {
      (btn as any).releasePointerCapture?.(e.pointerId);
    } catch (_e) {
      // ignore
    }
    try {
      const rect = btn.getBoundingClientRect();
      const nextState = snapToClosestEdge(btn, rect.left, rect.top);
      if (nextState) {
        writeSnappedState(btn, nextState);
        try {
          readOnPositionChange(btn)?.(nextState);
        } catch (_e) {
          // ignore
        }
      }
    } catch (_e) {
      // ignore
    }
  };

  btn.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  document.documentElement.appendChild(btn);

  let next = null as any;
  if (positionState) {
    try {
      next = applyExternalPositionState(btn, positionState);
    } catch (_e) {
      next = null;
    }
  }
  if (!next) {
    const rect = btn.getBoundingClientRect();
    next = snapToClosestEdge(btn, rect.left, rect.top);
    if (next) writeSnappedState(btn, next);
  }

  const onResize = () => {
    if (!btn.isConnected) return;
    const current = readSnappedState(btn);
    const nextState = applySnappedPosition(btn, current);
    if (!nextState) return;
    writeSnappedState(btn, nextState);
  };
  window.addEventListener('resize', onResize);

  (btn as any).__webclipperCleanup = () => {
    resetComboState();
    clearEasterAnimation();
    window.removeEventListener('resize', onResize);
    btn.removeEventListener('click', onClickCapture, true);
    btn.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
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

function setSaving(saving: boolean) {
  const el = document.getElementById(INPAGE_BTN_ID) as HTMLElement | null;
  if (!el) return;
  if (saving) el.classList.add('is-saving');
  else el.classList.remove('is-saving');
}

export const inpageButtonApi = {
  initRuntime,
  ensureInpageButton,
  cleanupButtons,
  setSaving,
};
