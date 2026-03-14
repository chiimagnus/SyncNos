import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import Settings from './routes/Settings';
import { CapturedListSidebar } from './conversations/CapturedListSidebar';
import { ConversationsProvider, useConversationsApp } from '../conversations/conversations-context';
import { ConversationsScene, type PopupHeaderState } from '../conversations/ConversationsScene';
import { ConversationDetailPane } from '../conversations/ConversationDetailPane';
import { DetailNavigationHeader } from '../conversations/DetailNavigationHeader';
import { navIconButtonClassName } from '../shared/nav-styles';
import { buttonIconCircleGhostClassName } from '../shared/button-styles';
import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';
import { useThemeMode } from '../shared/hooks/useThemeMode';
import { decodeConversationLoc } from '../../shared/conversation-loc';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';
const SIDEBAR_WIDTH_DEFAULT = 370;

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

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (v === '1') setSidebarCollapsed(true);
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

  function AppShellFrame() {
    useThemeMode();
    const [narrowHeaderState, setNarrowHeaderState] = useState<PopupHeaderState>({ mode: 'list' });
    const isNarrow = useIsNarrowScreen();
    const location = useLocation();
    const navigate = useNavigate();
    const { items, activeId, setActiveId } = useConversationsApp();

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

    useEffect(() => {
      if (location.pathname !== '/') return;

      const search = String(location.search || '');
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const loc = params.get('loc');
      const decoded = decodeConversationLoc(loc);
      if (!decoded) return;

      const found = items.find(
        (x) => String(x.source || '').trim().toLowerCase() === decoded.source && String(x.conversationKey || '').trim() === decoded.conversationKey,
      );
      if (!found) return;
      if (Number(found.id) === Number(activeId)) return;

      setActiveId(Number(found.id));
    }, [activeId, items, location.pathname, location.search, setActiveId]);

    const renderSidebar = !isNarrow && !sidebarCollapsed;

    return (
      <div className="tw-flex tw-h-[100dvh] tw-w-full tw-min-w-0 tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
        {renderSidebar ? (
          <aside
            className="tw-relative tw-flex tw-flex-col tw-bg-[var(--bg-sunken)] tw-p-0"
            style={{ width: `${SIDEBAR_WIDTH_DEFAULT}px`, minWidth: `${SIDEBAR_WIDTH_DEFAULT}px` }}
          >
            <CapturedListSidebar onCollapse={() => setCollapsed(true)} />
          </aside>
        ) : null}

        <main className="tw-relative tw-min-w-0 tw-flex-1 tw-overflow-hidden">
          {!isNarrow && sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className={['tw-absolute tw-left-3 tw-top-3 tw-z-10', navIconButtonClassName(false)].join(' ')}
              aria-label={t('expandSidebar')}
            >
              <ExpandIcon />
            </button>
          ) : null}

          {isNarrow ? (
            <div
              className={[
                'tw-flex tw-h-full tw-min-h-0 tw-flex-col',
                showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
              ].join(' ')}
              aria-hidden={showSettingsSheet}
            >
              {location.pathname === '/' && narrowHeaderState.mode === 'detail' ? (
                <header className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-3 tw-py-2">
                  <DetailNavigationHeader
                    title={narrowHeaderState.title}
                    subtitle={narrowHeaderState.subtitle}
                    actions={narrowHeaderState.actions}
                    onBack={narrowHeaderState.onBack}
                  />
                </header>
              ) : null}

              <div className="tw-min-h-0 tw-flex-1">
                <Routes location={routesLocation}>
                  <Route
                    path="/"
                    element={
                      <ConversationsScene
                        onPopupHeaderStateChange={setNarrowHeaderState}
                        onOpenInsightsSection={() => navigate('/settings?section=insight')}
                      />
                    }
                  />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/sync" element={<Navigate to="/settings" replace />} />
                  <Route path="/backup" element={<Navigate to="/settings" replace />} />
                </Routes>
              </div>
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
            <div className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4" role="dialog" aria-modal="true" aria-label={t('settingsDialogAria')}>
              <div
                className="tw-absolute tw-inset-0 tw-bg-[var(--bg-overlay)]"
                role="presentation"
                onMouseDown={(e) => {
                  e.preventDefault();
                  closeSettings();
                }}
              />
              <div
                className="tw-relative tw-z-10 tw-h-[min(760px,calc(100vh-40px))] tw-w-[min(1080px,calc(100vw-40px))] tw-overflow-hidden tw-rounded-3xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeSettings}
                  className={['tw-absolute tw-right-1 tw-top-1 tw-z-20', buttonIconCircleGhostClassName()].join(' ')}
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
