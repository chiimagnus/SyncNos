import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import Settings from './routes/Settings';
import { CapturedListSidebar } from './conversations/CapturedListSidebar';
import { ConversationsProvider } from '../conversations/conversations-context';
import { ConversationsScene } from '../conversations/ConversationsScene';
import { ConversationDetailPane } from '../conversations/ConversationDetailPane';
import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';
const SIDEBAR_WIDTH_KEY = 'webclipper_app_sidebar_width';
const SIDEBAR_WIDTH_DEFAULT = 370;
const SIDEBAR_WIDTH_MIN = 370;
const SIDEBAR_WIDTH_MAX = 520;

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.25 3.25L3 6.5L6.25 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.75 3.25L13 6.5L9.75 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 6.5H3.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_WIDTH_DEFAULT);
  const sidebarWidthRef = useRef<number>(SIDEBAR_WIDTH_DEFAULT);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (v === '1') setSidebarCollapsed(true);
    } catch (_e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(raw) && raw >= SIDEBAR_WIDTH_MIN && raw <= SIDEBAR_WIDTH_MAX) setSidebarWidth(raw);
    } catch (_e) {
      // ignore
    }
  }, []);

  const setCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_e) {
      // ignore
    }
  };

  const clampSidebarWidth = (next: number) => {
    const maxByViewport = typeof window !== 'undefined' && window.innerWidth ? Math.max(SIDEBAR_WIDTH_MIN, window.innerWidth - 320) : SIDEBAR_WIDTH_MAX;
    const max = Math.min(SIDEBAR_WIDTH_MAX, maxByViewport);
    return Math.max(SIDEBAR_WIDTH_MIN, Math.min(max, Math.round(next)));
  };

  const persistSidebarWidth = (next: number) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch (_e) {
      // ignore
    }
  };

  const onResizePointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (sidebarCollapsed) return;
    resizingRef.current = true;
    resizeStartRef.current = { x: e.clientX, width: sidebarWidth };

    try {
      (e.currentTarget as any)?.setPointerCapture?.(e.pointerId);
    } catch (_e) {
      // ignore
    }

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      const start = resizeStartRef.current;
      if (!start) return;
      const dx = ev.clientX - start.x;
      setSidebarWidth(clampSidebarWidth(start.width + dx));
    };

    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      resizeStartRef.current = null;
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      persistSidebarWidth(clampSidebarWidth(sidebarWidthRef.current));
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  function AppShellFrame() {
    const isNarrow = useIsNarrowScreen();
    const location = useLocation();
    const navigate = useNavigate();

    const showSettingsSheet = !isNarrow && location.pathname === '/settings';
    const state: any = (location as any)?.state ?? {};
    const backgroundLocation = showSettingsSheet ? state?.backgroundLocation ?? null : null;

    const routesLocation = backgroundLocation || (showSettingsSheet ? ({ ...location, pathname: '/' } as any) : location);

    const closeSettings = () => {
      const from = String(state?.from || '').trim();
      if (from) navigate(from, { replace: true });
      else navigate('/', { replace: true });
    };

    useEffect(() => {
      if (!showSettingsSheet) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeSettings();
        }
      };
      document.addEventListener('keydown', onKey, true);
      return () => document.removeEventListener('keydown', onKey, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showSettingsSheet]);

    const renderSidebar = !isNarrow && !sidebarCollapsed;

    return (
      <div className="tw-flex tw-h-[100dvh] tw-w-full tw-min-w-0 tw-bg-[var(--bg)]">
        {renderSidebar ? (
          <aside
            className="tw-relative tw-flex tw-flex-col tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/85 tw-p-0 tw-backdrop-blur-sm"
            style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
          >
            <CapturedListSidebar onCollapse={() => setCollapsed(true)} />

            <div
              role="separator"
              aria-label={t('resizeSidebar')}
              onPointerDown={onResizePointerDown}
              className="tw-absolute tw-right-0 tw-top-0 tw-h-full tw-w-2 tw-cursor-col-resize tw-touch-none"
            >
              <div className="tw-absolute tw-right-0 tw-top-0 tw-h-full tw-w-px tw-bg-[var(--border-strong)]/40 tw-opacity-0 tw-transition-opacity tw-duration-150 hover:tw-opacity-100" />
            </div>
          </aside>
        ) : null}

        <main className="tw-relative tw-min-w-0 tw-flex-1 tw-overflow-hidden">
          {!isNarrow && sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="tw-absolute tw-left-3 tw-top-3 tw-z-10 tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-text-[var(--muted)] tw-shadow-[var(--shadow)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
              aria-label={t('expandSidebar')}
            >
              <ExpandIcon />
            </button>
          ) : null}

          {isNarrow ? (
            <div
              className={[
                'tw-h-full tw-min-h-0',
                showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
              ].join(' ')}
              aria-hidden={showSettingsSheet}
            >
              <Routes location={routesLocation}>
                <Route path="/" element={<ConversationsScene />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/sync" element={<Navigate to="/settings" replace />} />
                <Route path="/backup" element={<Navigate to="/settings" replace />} />
              </Routes>
            </div>
          ) : (
            <div
              className={[
                'route-scroll tw-h-full tw-min-h-0 tw-overflow-y-auto tw-overflow-x-hidden tw-p-3 md:tw-p-4',
                showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
              ].join(' ')}
              aria-hidden={showSettingsSheet}
            >
              <Routes location={routesLocation}>
                <Route path="/" element={<ConversationDetailPane />} />
                <Route path="/settings" element={<Navigate to="/" replace />} />
                <Route path="/sync" element={<Navigate to="/settings" replace />} />
                <Route path="/backup" element={<Navigate to="/settings" replace />} />
              </Routes>
            </div>
          )}

          {showSettingsSheet ? (
            <div className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4" role="dialog" aria-modal="true" aria-label="Settings">
              <div
                className="tw-absolute tw-inset-0 tw-bg-transparent"
                role="presentation"
                onMouseDown={(e) => {
                  e.preventDefault();
                  closeSettings();
                }}
              />
              <div
                className="tw-relative tw-z-10 tw-h-[min(760px,calc(100vh-40px))] tw-w-[min(1080px,calc(100vw-40px))] tw-overflow-hidden tw-rounded-3xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg)]/90 tw-shadow-[0_20px_60px_rgba(0,0,0,0.18)] tw-backdrop-blur-lg"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeSettings}
                  className="tw-absolute tw-right-1 tw-top-1 tw-z-20 tw-inline-flex tw-size-6 tw-appearance-none tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent tw-p-0 tw-text-[var(--muted)] tw-shadow-none tw-outline-none tw-ring-0 tw-transition-colors tw-duration-200 hover:tw-bg-[var(--panel-strong)] hover:tw-text-[var(--text)]"
                  aria-label={t('closeSettings')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M4 4L12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>

                <div className="tw-h-full tw-overflow-hidden">
                  <Settings />
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <HashRouter>
      <ConversationsProvider>
        <AppShellFrame />
      </ConversationsProvider>
    </HashRouter>
  );
}
