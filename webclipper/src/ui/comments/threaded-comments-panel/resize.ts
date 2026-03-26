const COMMENTS_SIDEBAR_WIDTH_STORAGE_KEY = 'webclipper_comments_sidebar_width_v1';
const COMMENTS_SIDEBAR_WIDTH_MIN_PX = 320;
const COMMENTS_SIDEBAR_WIDTH_MAX_PX = 720;
const COMMENTS_SIDEBAR_MIN_MAIN_WIDTH_PX = 360;
const SIDEBAR_WIDTH_CSS_VAR = '--webclipper-comments-panel-width';

type InstallSidebarResizeOptions = {
  panelEl: HTMLElement;
  handleEl: HTMLElement;
  isOverlay: boolean;
  readPanelWidthPx: () => number;
  onWidthApplied?: () => void;
};

type SidebarWidthState = {
  widthPx: number | null;
  dragging: boolean;
  pointerId: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampSidebarWidthPxForViewport(widthPx: number, input: { isOverlay: boolean; viewportWidth: number }): number {
  const viewport = Math.max(1, Math.round(Number(input.viewportWidth || 0) || 0));
  const maxCap = Math.max(
    COMMENTS_SIDEBAR_WIDTH_MIN_PX,
    input.isOverlay ? Math.floor(viewport * 0.92) : viewport - COMMENTS_SIDEBAR_MIN_MAIN_WIDTH_PX,
  );
  const max = Math.max(COMMENTS_SIDEBAR_WIDTH_MIN_PX, Math.min(COMMENTS_SIDEBAR_WIDTH_MAX_PX, maxCap));
  return Math.round(clamp(widthPx, COMMENTS_SIDEBAR_WIDTH_MIN_PX, max));
}

function stopEvent(event: Event) {
  try {
    event.preventDefault();
  } catch (_e) {
    // ignore
  }
  try {
    event.stopPropagation();
  } catch (_e) {
    // ignore
  }
}

function readPersistedSidebarWidthPx(): number | null {
  try {
    const raw = localStorage.getItem(COMMENTS_SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = Number.parseFloat(String(raw || '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed);
  } catch (_e) {
    return null;
  }
}

function persistSidebarWidthPx(widthPx: number) {
  try {
    localStorage.setItem(COMMENTS_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
  } catch (_e) {
    // ignore
  }
}

function clampSidebarWidthPx(widthPx: number, isOverlay: boolean): number {
  const viewportWidth = Number(globalThis.innerWidth || document.documentElement?.clientWidth || 0) || 0;
  return clampSidebarWidthPxForViewport(widthPx, { isOverlay, viewportWidth });
}

export function installSidebarResize(options: InstallSidebarResizeOptions): { cleanup: () => void } {
  const panelEl = options.panelEl;
  const handleEl = options.handleEl;
  const isOverlay = options.isOverlay === true;
  const onWidthApplied = options.onWidthApplied;
  const readPanelWidthPx = options.readPanelWidthPx;

  const widthState: SidebarWidthState = {
    widthPx: null,
    dragging: false,
    pointerId: null,
  };

  const applyWidthSync = () => {
    try {
      onWidthApplied?.();
    } catch (_e) {
      // ignore
    }
  };

  const setSidebarWidthPx = (widthPx: number | null, input?: { persist?: boolean }) => {
    if (widthPx == null) {
      widthState.widthPx = null;
      try {
        panelEl.style.removeProperty(SIDEBAR_WIDTH_CSS_VAR);
      } catch (_e) {
        // ignore
      }
      applyWidthSync();
      return;
    }

    const clamped = clampSidebarWidthPx(widthPx, isOverlay);
    widthState.widthPx = clamped;
    try {
      panelEl.style.setProperty(SIDEBAR_WIDTH_CSS_VAR, `${clamped}px`, 'important');
    } catch (_e) {
      // ignore
    }
    if (input?.persist !== false) persistSidebarWidthPx(clamped);
    applyWidthSync();
  };

  const persistedWidth = readPersistedSidebarWidthPx();
  if (persistedWidth != null) {
    widthState.widthPx = clampSidebarWidthPx(persistedWidth, isOverlay);
    setSidebarWidthPx(widthState.widthPx, { persist: false });
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!widthState.dragging) return;
    if (widthState.pointerId != null && event.pointerId !== widthState.pointerId) return;
    stopEvent(event);
    const viewport = Math.max(1, Math.round(Number(globalThis.innerWidth || document.documentElement?.clientWidth || 0) || 0));
    const nextWidth = viewport - event.clientX;
    setSidebarWidthPx(nextWidth, { persist: false });
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!widthState.dragging) return;
    if (widthState.pointerId != null && event.pointerId !== widthState.pointerId) return;
    stopEvent(event);
    widthState.dragging = false;
    widthState.pointerId = null;
    try {
      panelEl.removeAttribute('data-resizing');
    } catch (_e) {
      // ignore
    }
    try {
      handleEl.releasePointerCapture(event.pointerId);
    } catch (_e) {
      // ignore
    }
    if (widthState.widthPx != null) persistSidebarWidthPx(widthState.widthPx);
    try {
      globalThis.removeEventListener('pointermove', onPointerMove, true);
      globalThis.removeEventListener('pointerup', onPointerUp, true);
      globalThis.removeEventListener('pointercancel', onPointerUp, true);
    } catch (_e) {
      // ignore
    }
    applyWidthSync();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    stopEvent(event);
    widthState.dragging = true;
    widthState.pointerId = event.pointerId;
    try {
      panelEl.setAttribute('data-resizing', '1');
    } catch (_e) {
      // ignore
    }
    if (widthState.widthPx == null) {
      const measured = readPanelWidthPx();
      setSidebarWidthPx(measured, { persist: false });
    }
    try {
      handleEl.setPointerCapture(event.pointerId);
    } catch (_e) {
      // ignore
    }
    try {
      globalThis.addEventListener('pointermove', onPointerMove, true);
      globalThis.addEventListener('pointerup', onPointerUp, true);
      globalThis.addEventListener('pointercancel', onPointerUp, true);
    } catch (_e) {
      // ignore
    }
  };

  const onViewportResize = () => {
    if (widthState.widthPx == null) return;
    const clamped = clampSidebarWidthPx(widthState.widthPx, isOverlay);
    if (clamped === widthState.widthPx) return;
    setSidebarWidthPx(clamped, { persist: true });
  };

  handleEl.addEventListener('pointerdown', onPointerDown);

  try {
    globalThis.addEventListener('resize', onViewportResize, { passive: true });
  } catch (_e) {
    // ignore
  }

  const cleanup = () => {
    try {
      handleEl.removeEventListener('pointerdown', onPointerDown);
    } catch (_e) {
      // ignore
    }
    try {
      globalThis.removeEventListener('pointermove', onPointerMove, true);
      globalThis.removeEventListener('pointerup', onPointerUp, true);
      globalThis.removeEventListener('pointercancel', onPointerUp, true);
    } catch (_e) {
      // ignore
    }
    try {
      globalThis.removeEventListener('resize', onViewportResize);
    } catch (_e) {
      // ignore
    }
  };

  return { cleanup };
}
