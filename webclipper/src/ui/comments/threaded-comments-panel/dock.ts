const DOCK_STYLE_ID = 'webclipper-inpage-comments-panel__dock-style';
const DOCK_ROOT_ATTR = 'data-webclipper-comments-dock';
const DOCK_WIDTH_CSS_VAR = '--webclipper-comments-dock-width';

export type DockController = {
  readWidthPx: () => number;
  syncWidth: () => void;
  setOpen: (open: boolean) => void;
  cleanup: () => void;
};

type CreateDockControllerOptions = {
  enabled: boolean;
  panelEl: HTMLElement;
};

export function createDockController(options: CreateDockControllerOptions): DockController {
  const enabled = options.enabled === true;
  const panelEl = options.panelEl;
  let dockRaf: number | null = null;

  function ensureDockStyle() {
    if (!enabled) return;
    try {
      if (document.getElementById(DOCK_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = DOCK_STYLE_ID;
      style.textContent = [
        `html[${DOCK_ROOT_ATTR}='1'] {`,
        '  box-sizing: border-box !important;',
        `  padding-right: var(${DOCK_WIDTH_CSS_VAR}, 0px) !important;`,
        '  overflow-x: hidden !important;',
        '}',
        `html[${DOCK_ROOT_ATTR}='1'] body {`,
        '  box-sizing: border-box !important;',
        '}',
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
    } catch (_e) {
      // ignore
    }
  }

  function readWidthPx(): number {
    try {
      const rect = panelEl.getBoundingClientRect?.();
      const width = Number(rect?.width || 0);
      if (Number.isFinite(width) && width > 0) return width;
    } catch (_e) {
      // ignore
    }
    try {
      const computed = getComputedStyle(panelEl);
      const width = Number.parseFloat(String(computed.width || '').replace('px', '').trim());
      if (Number.isFinite(width) && width > 0) return width;
    } catch (_e) {
      // ignore
    }
    return 420;
  }

  const syncWidth = () => {
    try {
      if (!enabled) return;
      if (panelEl.getAttribute('data-open') !== '1') return;
      const width = Math.round(readWidthPx());
      document.documentElement.style.setProperty(DOCK_WIDTH_CSS_VAR, `${width}px`, 'important');
    } catch (_e) {
      // ignore
    }
  };

  const onViewportResize = () => {
    syncWidth();
  };

  const setOpen = (open: boolean) => {
    if (!enabled) return;
    const root = document.documentElement;
    if (!root) return;

    if (open) {
      ensureDockStyle();
      try {
        root.setAttribute(DOCK_ROOT_ATTR, '1');
      } catch (_e) {
        // ignore
      }
      syncWidth();
      try {
        if (dockRaf != null) cancelAnimationFrame(dockRaf);
        dockRaf = requestAnimationFrame(() => {
          dockRaf = null;
          syncWidth();
        });
      } catch (_e) {
        // ignore
      }
      try {
        globalThis.addEventListener('resize', onViewportResize, { passive: true });
      } catch (_e) {
        // ignore
      }
      return;
    }

    try {
      if (dockRaf != null) cancelAnimationFrame(dockRaf);
    } catch (_e) {
      // ignore
    }
    dockRaf = null;
    try {
      globalThis.removeEventListener('resize', onViewportResize);
    } catch (_e) {
      // ignore
    }
    try {
      root.removeAttribute(DOCK_ROOT_ATTR);
    } catch (_e) {
      // ignore
    }
    try {
      root.style.removeProperty(DOCK_WIDTH_CSS_VAR);
    } catch (_e) {
      // ignore
    }
  };

  const cleanup = () => {
    setOpen(false);
  };

  return {
    readWidthPx,
    syncWidth,
    setOpen,
    cleanup,
  };
}
