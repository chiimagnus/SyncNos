import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import Settings from './routes/Settings';
import { CapturedListSidebar } from './conversations/CapturedListSidebar';
import { ConversationsProvider, useConversationsApp } from '../conversations/conversations-context';
import { ConversationsScene, type PopupHeaderState } from '../conversations/ConversationsScene';
import { ConversationDetailPane } from '../conversations/ConversationDetailPane';
import { ArticleCommentsSidebar } from '../conversations/ArticleCommentsSidebar';
import { DetailNavigationHeader } from '../conversations/DetailNavigationHeader';
import { buttonIconCircleGhostClassName } from '../shared/button-styles';
import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';
import { useThemeMode } from '../shared/hooks/useThemeMode';
import { decodeConversationLoc, encodeConversationLoc } from '../../shared/conversation-loc';
import { createCommentSidebarSession } from '../../comments/sidebar/comment-sidebar-session';
import type { CommentSidebarSession } from '../../comments/sidebar/comment-sidebar-contract';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';
const SIDEBAR_WIDTH_DEFAULT = 370;

function normalizeHttpUrl(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
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
    const commentsSidebarSessionRef = useRef<CommentSidebarSession | null>(null);
    if (!commentsSidebarSessionRef.current) {
      commentsSidebarSessionRef.current = createCommentSidebarSession();
    }
    const commentsSidebarSession = commentsSidebarSessionRef.current;
    const commentsSidebarSnapshot = useSyncExternalStore(
      (listener) => commentsSidebarSession.subscribe(listener),
      () => commentsSidebarSession.getSnapshot(),
      () => commentsSidebarSession.getSnapshot(),
    );
    const isNarrow = useIsNarrowScreen();
    const location = useLocation();
    const navigate = useNavigate();
    const { items, openConversationExternalById, selectedConversation } = useConversationsApp();
    const lastInternalLocRef = useRef<string | null>(null);
    const processedLocRef = useRef<string | null>(null);
    const isArticleConversation = String((selectedConversation as any)?.sourceType || '').trim().toLowerCase() === 'article';
    const canonicalUrl = normalizeHttpUrl((selectedConversation as any)?.url);
    const canToggleCommentsSidebar = !isNarrow && isArticleConversation && Boolean(canonicalUrl);

    const showSettingsSheet = !isNarrow && location.pathname === '/settings';
    const state: any = (location as any)?.state ?? {};
    const backgroundLocation = showSettingsSheet ? state?.backgroundLocation ?? null : null;
    const showCommentsSidebar = canToggleCommentsSidebar && commentsSidebarSnapshot.openRequested && !showSettingsSheet;

    const routesLocation = backgroundLocation || (showSettingsSheet ? ({ ...location, pathname: '/' } as any) : location);

    const closeSettings = () => {
      const from = String(state?.from || '').trim();
      if (from) navigate(from, { replace: true });
      else navigate('/', { replace: true });
    };

    useEffect(() => {
      if (isArticleConversation && canonicalUrl) return;
      commentsSidebarSession.requestClose();
      commentsSidebarSession.setQuoteText('');
    }, [canonicalUrl, commentsSidebarSession, isArticleConversation]);

    const triggerCommentsSidebar = (quoteText: string) => {
      commentsSidebarSession.setQuoteText(String(quoteText || '').trim());
      commentsSidebarSession.requestOpen({ focusComposer: true, source: 'app' });
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
      if (loc && lastInternalLocRef.current && loc === lastInternalLocRef.current) {
        lastInternalLocRef.current = null;
        processedLocRef.current = loc;
        return;
      }
      if (!loc || processedLocRef.current === loc) return;

      const decoded = decodeConversationLoc(loc);
      if (!decoded) {
        processedLocRef.current = loc;
        return;
      }

      const found = items.find(
        (x) => String(x.source || '').trim().toLowerCase() === decoded.source && String(x.conversationKey || '').trim() === decoded.conversationKey,
      );
      if (!found) {
        if (items.length) processedLocRef.current = loc;
        return;
      }
      processedLocRef.current = loc;
      openConversationExternalById(Number(found.id));
    }, [items, location.pathname, location.search, openConversationExternalById]);

    useEffect(() => {
      if (location.pathname !== '/') return;
      if (!selectedConversation) return;

      const nextLoc = encodeConversationLoc({
        source: selectedConversation.source,
        conversationKey: selectedConversation.conversationKey,
      });

      const params = new URLSearchParams(String(location.search || ''));
      const currentLoc = params.get('loc');
      if (currentLoc === nextLoc) return;

      params.set('loc', nextLoc);
      lastInternalLocRef.current = nextLoc;
      navigate({ pathname: '/', search: `?${params.toString()}` }, { replace: true });
    }, [location.pathname, location.search, navigate, selectedConversation]);

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
            <div className="tw-flex tw-h-full tw-min-h-0 tw-min-w-0">
              <div
                className={[
                  'route-scroll tw-h-full tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden',
                  showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
                ].join(' ')}
                aria-hidden={showSettingsSheet}
              >
                <Routes location={routesLocation}>
                  <Route
                    path="/"
                    element={
                      <ConversationDetailPane
                        onExpandSidebar={sidebarCollapsed ? () => setCollapsed(false) : undefined}
                        onTriggerCommentsSidebar={canToggleCommentsSidebar ? triggerCommentsSidebar : undefined}
                        commentsSidebarOpen={showCommentsSidebar}
                      />
                    }
                  />
                  <Route path="/settings" element={<Navigate to="/" replace />} />
                  <Route path="/sync" element={<Navigate to="/settings" replace />} />
                  <Route path="/backup" element={<Navigate to="/settings" replace />} />
                </Routes>
              </div>

              {showCommentsSidebar ? (
                <div className="tw-h-full tw-min-h-0 tw-shrink-0 tw-w-[min(420px,36vw)] tw-min-w-[340px] tw-border-l tw-border-[var(--border)] tw-bg-[var(--bg-sunken)]">
                  <ArticleCommentsSidebar
                    conversationId={Number((selectedConversation as any)?.id || 0)}
                    canonicalUrl={canonicalUrl}
                    quoteText={commentsSidebarSnapshot.quoteText}
                    focusComposerSignal={commentsSidebarSnapshot.focusComposerSignal}
                    onClose={() => commentsSidebarSession.requestClose()}
                  />
                </div>
              ) : null}
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
