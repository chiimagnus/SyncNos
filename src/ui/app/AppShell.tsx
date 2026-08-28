import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { t } from '@i18n';
import Settings from '@ui/app/Settings';
import { ConversationsProvider, useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { ConversationsScene } from '@ui/conversations/ConversationsScene';
import { ConversationDetailPane } from '@ui/conversations/ConversationDetailPane';
import { ArticleCommentsSection } from '@ui/conversations/ArticleCommentsSection';
import type { CommentLocatorSurfaceRoots } from '@ui/comments';
import { createAppCommentSelectionSource } from '@ui/comments/app-comment-selection-source';
import { buttonIconCircleGhostClassName, headerButtonClassName } from '@ui/shared/button-styles';
import { AppTooltipHost, tooltipAttrs } from '@ui/shared/AppTooltip';
import { useResponsiveTier } from '@ui/shared/hooks/useResponsiveTier';
import { useArticleCommentsSidebarRuntime } from '@viewmodels/comments/useArticleCommentsSidebarRuntime';
import { useAppThemeMode } from '@viewmodels/theme/useAppThemeMode';
import { decodeConversationLoc, encodeConversationLoc } from '@services/shared/conversation-loc';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { conversationKinds } from '@services/protocols/conversation-kinds';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';
const COMMENTS_SIDEBAR_COLLAPSED_KEY = 'webclipper_app_comments_sidebar_collapsed';

function readBrowserLocalStorageValue(key: string): string {
  try {
    return String(globalThis.window?.localStorage?.getItem(key) || '');
  } catch (_e) {
    return '';
  }
}

function writeBrowserLocalStorageValue(key: string, value: string) {
  try {
    globalThis.window?.localStorage?.setItem(key, value);
  } catch (_e) {
    // ignore
  }
}

export default function AppShell() {
  useAppThemeMode();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [wideCommentsSidebarCollapsed, setWideCommentsSidebarCollapsed] = useState(false);
  const [mediumCommentsSidebarCollapsed, setMediumCommentsSidebarCollapsed] = useState(true);

  useEffect(() => {
    if (readBrowserLocalStorageValue(SIDEBAR_COLLAPSED_KEY) === '1') setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    if (readBrowserLocalStorageValue(COMMENTS_SIDEBAR_COLLAPSED_KEY) === '1') setWideCommentsSidebarCollapsed(true);
  }, []);

  const setCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    writeBrowserLocalStorageValue(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  };

  const setWideCommentsCollapsed = (collapsed: boolean) => {
    setWideCommentsSidebarCollapsed(collapsed);
    writeBrowserLocalStorageValue(COMMENTS_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  };

  const AppShellRouterProviders = useMemo(
    () =>
      function AppShellRouterProviders({
        sidebarCollapsed,
        wideCommentsSidebarCollapsed,
        mediumCommentsSidebarCollapsed,
        setCollapsed,
        setWideCommentsCollapsed,
        setMediumCommentsCollapsed,
      }: {
        sidebarCollapsed: boolean;
        wideCommentsSidebarCollapsed: boolean;
        mediumCommentsSidebarCollapsed: boolean;
        setCollapsed: (collapsed: boolean) => void;
        setWideCommentsCollapsed: (collapsed: boolean) => void;
        setMediumCommentsCollapsed: (collapsed: boolean) => void;
      }) {
        const location = useLocation();
        const initialOpenLocRef = useRef<{ source: string; conversationKey: string } | null | undefined>(undefined);
        if (initialOpenLocRef.current === undefined) {
          const search = String(location.search || '');
          const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
          const loc = params.get('loc');
          initialOpenLocRef.current = loc ? decodeConversationLoc(loc) : null;
        }

        return (
          <ConversationsProvider initialOpenLoc={initialOpenLocRef.current ?? null}>
            <AppShellFrame
              sidebarCollapsed={sidebarCollapsed}
              wideCommentsSidebarCollapsed={wideCommentsSidebarCollapsed}
              mediumCommentsSidebarCollapsed={mediumCommentsSidebarCollapsed}
              setCollapsed={setCollapsed}
              setWideCommentsCollapsed={setWideCommentsCollapsed}
              setMediumCommentsCollapsed={setMediumCommentsCollapsed}
            />
            <AppTooltipHost />
          </ConversationsProvider>
        );
      },
    [],
  );

  function AppShellFrame({
    sidebarCollapsed,
    wideCommentsSidebarCollapsed,
    mediumCommentsSidebarCollapsed,
    setCollapsed,
    setWideCommentsCollapsed,
    setMediumCommentsCollapsed,
  }: {
    sidebarCollapsed: boolean;
    wideCommentsSidebarCollapsed: boolean;
    mediumCommentsSidebarCollapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
    setWideCommentsCollapsed: (collapsed: boolean) => void;
    setMediumCommentsCollapsed: (collapsed: boolean) => void;
  }) {
    const tier = useResponsiveTier();
    const isNarrow = tier === 'narrow';
    const isMedium = tier === 'medium';
    const isWide = tier === 'wide';
    const previousTierRef = useRef<typeof tier | null>(null);
    const suppressCommentsSidebarCollapseRef = useRef(false);
    const commentsLocatorSurfaceRootsRef = useRef<CommentLocatorSurfaceRoots | null>(null);
    const commentsLocatorSurfaceRootsListenersRef = useRef(new Set<() => void>());
    const resolveAppComposerSelection = useMemo(
      () => createAppCommentSelectionSource({ getSurfaceRoots: () => commentsLocatorSurfaceRootsRef.current }),
      [],
    );
    const {
      sidebarSession: commentsSidebarSession,
      sidebarController: commentsSidebarController,
      sidebarSnapshot: commentsSidebarSnapshot,
      subscribeSidebarClose,
    } = useArticleCommentsSidebarRuntime({
      resolveComposerSelection: resolveAppComposerSelection,
      onClose: () => {
        if (suppressCommentsSidebarCollapseRef.current) return;
        if (isMedium) {
          setMediumCommentsCollapsed(true);
          return;
        }
        if (isWide) {
          setWideCommentsCollapsed(true);
        }
      },
    });
    const commentsSidebarDisposeEpochRef = useRef(0);
    useEffect(() => {
      commentsSidebarDisposeEpochRef.current += 1;
      return () => {
        const disposeEpoch = ++commentsSidebarDisposeEpochRef.current;
        const dispose = () => {
          if (commentsSidebarDisposeEpochRef.current !== disposeEpoch) return;
          commentsSidebarController.dispose();
          commentsSidebarSession.dispose();
        };
        if (typeof globalThis.queueMicrotask === 'function') {
          globalThis.queueMicrotask(dispose);
        } else {
          void Promise.resolve().then(dispose);
        }
      };
    }, [commentsSidebarController, commentsSidebarSession]);
    const pendingExternalLocRef = useRef<string | null>(null);
    const setCommentsLocatorSurfaceRoots = useCallback((roots: CommentLocatorSurfaceRoots | null) => {
      commentsLocatorSurfaceRootsRef.current = roots;
      if (roots && pendingExternalLocRef.current) pendingExternalLocRef.current = null;
      for (const listener of commentsLocatorSurfaceRootsListenersRef.current) listener();
    }, []);
    const getCommentsLocatorSurfaceRoots = useCallback(() => commentsLocatorSurfaceRootsRef.current, []);
    const subscribeCommentsLocatorSurfaceRoots = useCallback((listener: () => void) => {
      commentsLocatorSurfaceRootsListenersRef.current.add(listener);
      return () => commentsLocatorSurfaceRootsListenersRef.current.delete(listener);
    }, []);
    const location = useLocation();
    const navigate = useNavigate();
    const { openConversationExternalByLoc, selectedConversation } = useConversationsApp();
    const lastInternalLocRef = useRef<string | null>(null);
    const processedLocRef = useRef<string | null>(null);
    const locMountedRef = useRef(false);
    const selectedConversationView = conversationKinds.pick(selectedConversation as any)?.view ?? null;
    const commentsSidebarEnabled = Boolean(selectedConversationView?.commentsSidebar);
    const canonicalUrl = canonicalizeArticleUrl((selectedConversation as any)?.url);
    const selectedConversationId = Number((selectedConversation as any)?.id || 0) || null;
    const commentsSidebarContext = useMemo(
      () =>
        commentsSidebarEnabled && canonicalUrl
          ? {
              canonicalUrl,
              conversationId: selectedConversationId,
            }
          : null,
      [canonicalUrl, commentsSidebarEnabled, selectedConversationId],
    );
    const canToggleCommentsSidebar = !isNarrow && commentsSidebarEnabled && Boolean(canonicalUrl);
    const commentsSidebarCollapsed = isMedium ? mediumCommentsSidebarCollapsed : wideCommentsSidebarCollapsed;
    const canAutoOpenCommentsSidebarInWide = isWide && canToggleCommentsSidebar;

    const showSettingsSheet = !isNarrow && location.pathname === '/settings';
    const state: any = (location as any)?.state ?? {};
    const backgroundLocation = showSettingsSheet ? (state?.backgroundLocation ?? null) : null;
    const settingsOpen = location.pathname === '/settings';
    const showCommentsSidebar =
      canToggleCommentsSidebar &&
      !showSettingsSheet &&
      !commentsSidebarCollapsed &&
      (isMedium || commentsSidebarSnapshot.open);

    const routesLocation =
      backgroundLocation || (showSettingsSheet ? ({ ...location, pathname: '/' } as any) : location);

    const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
    const settingsLastActiveElementRef = useRef<HTMLElement | null>(null);

    const closeSettings = () => {
      const from = String(state?.from || '').trim();
      if (from) navigate(from, { replace: true });
      else navigate('/', { replace: true });
    };

    const openSettings = () => {
      if (settingsOpen) {
        closeSettings();
        return;
      }

      const active = document.activeElement;
      settingsLastActiveElementRef.current = active instanceof HTMLElement ? active : null;
      settingsLastActiveElementRef.current?.blur();

      navigate('/settings', {
        state: {
          backgroundLocation: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
          from: `${location.pathname || '/'}${location.search || ''}`,
        },
      });
    };

    const openInsightSettings = () => {
      if (settingsOpen) {
        navigate('/settings?section=aboutyou', { replace: true, state: location.state });
        return;
      }

      const active = document.activeElement;
      settingsLastActiveElementRef.current = active instanceof HTMLElement ? active : null;
      settingsLastActiveElementRef.current?.blur();

      navigate('/settings?section=aboutyou', {
        state: {
          backgroundLocation: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
          from: `${location.pathname || '/'}${location.search || ''}`,
        },
      });
    };

    const openProviderSettings = (section: string) => {
      const safeSection =
        String(section || '')
          .trim()
          .toLowerCase() || 'notion';
      const route = `/settings?section=${encodeURIComponent(safeSection)}`;
      if (settingsOpen) {
        navigate(route, { replace: true, state: location.state });
        return;
      }

      const active = document.activeElement;
      settingsLastActiveElementRef.current = active instanceof HTMLElement ? active : null;
      settingsLastActiveElementRef.current?.blur();

      navigate(route, {
        state: {
          backgroundLocation: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
          from: `${location.pathname || '/'}${location.search || ''}`,
        },
      });
    };

    useEffect(() => {
      const previousTier = previousTierRef.current;
      previousTierRef.current = tier;
      if (tier !== 'medium') return;
      if (previousTier == null || previousTier === 'medium') return;
      setMediumCommentsCollapsed(true);
      suppressCommentsSidebarCollapseRef.current = true;
      try {
        commentsSidebarSession.requestClose();
      } finally {
        suppressCommentsSidebarCollapseRef.current = false;
      }
    }, [commentsSidebarSession, setMediumCommentsCollapsed, tier]);

    useEffect(() => {
      if (commentsSidebarContext) {
        commentsSidebarController.setContext(commentsSidebarContext);
        return;
      }

      commentsSidebarController.setContext(null);
      suppressCommentsSidebarCollapseRef.current = true;
      try {
        commentsSidebarSession.requestClose();
      } finally {
        suppressCommentsSidebarCollapseRef.current = false;
      }
      commentsSidebarSession.clearComposerAttachment();
    }, [commentsSidebarContext, commentsSidebarController, commentsSidebarSession]);

    useEffect(() => {
      if (showSettingsSheet) return;
      if (!canAutoOpenCommentsSidebarInWide) return;
      if (commentsSidebarCollapsed) return;
      if (commentsSidebarSnapshot.open) return;
      void commentsSidebarController.open({ source: 'app-default', focusComposer: false, ensureContext: false });
    }, [
      canAutoOpenCommentsSidebarInWide,
      commentsSidebarCollapsed,
      commentsSidebarController,
      commentsSidebarSession,
      commentsSidebarSnapshot.open,
      showSettingsSheet,
    ]);

    const triggerCommentsSidebar = () => {
      if (isMedium) {
        setMediumCommentsCollapsed(false);
      } else if (isWide) {
        setWideCommentsCollapsed(false);
      }
      void commentsSidebarController.open({
        focusComposer: true,
        source: 'app',
        ensureContext: false,
      });
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
      if (showSettingsSheet) {
        const active = document.activeElement;
        if (!settingsLastActiveElementRef.current) {
          settingsLastActiveElementRef.current = active instanceof HTMLElement ? active : null;
        }

        const timer = window.setTimeout(() => {
          settingsCloseButtonRef.current?.focus({ preventScroll: true });
        }, 0);

        return () => window.clearTimeout(timer);
      }

      const lastActive = settingsLastActiveElementRef.current;
      settingsLastActiveElementRef.current = null;
      if (!lastActive) return;
      if (!document.contains(lastActive)) return;
      try {
        lastActive.focus({ preventScroll: true });
      } catch (e) {
        void e;
      }
    }, [showSettingsSheet]);

    useEffect(() => {
      if (!locMountedRef.current) {
        locMountedRef.current = true;
        return;
      }
      if (location.pathname !== '/') return;

      const search = String(location.search || '');
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const loc = params.get('loc');
      if (loc && lastInternalLocRef.current && loc === lastInternalLocRef.current) {
        lastInternalLocRef.current = null;
        if (pendingExternalLocRef.current === loc) pendingExternalLocRef.current = null;
        processedLocRef.current = loc;
        return;
      }
      if (!loc || processedLocRef.current === loc) return;

      const decoded = decodeConversationLoc(loc);
      if (!decoded) {
        if (pendingExternalLocRef.current === loc) pendingExternalLocRef.current = null;
        processedLocRef.current = loc;
        return;
      }

      processedLocRef.current = loc;
      pendingExternalLocRef.current = loc;
      void Promise.resolve(
        openConversationExternalByLoc({
          source: decoded.source,
          conversationKey: decoded.conversationKey,
        }),
      ).catch(() => {
        if (pendingExternalLocRef.current === loc) pendingExternalLocRef.current = null;
      });
    }, [location.pathname, location.search, openConversationExternalByLoc]);

    useEffect(() => {
      if (location.pathname !== '/') return;
      if (!selectedConversation) return;

      const nextLoc = encodeConversationLoc({
        source: selectedConversation.source,
        conversationKey: selectedConversation.conversationKey,
      });

      const params = new URLSearchParams(String(location.search || ''));
      const currentLoc = params.get('loc');
      if (currentLoc === nextLoc) {
        if (pendingExternalLocRef.current === nextLoc) pendingExternalLocRef.current = null;
        return;
      }
      if (pendingExternalLocRef.current && currentLoc === pendingExternalLocRef.current) return;

      params.set('loc', nextLoc);
      lastInternalLocRef.current = nextLoc;
      navigate({ pathname: '/', search: `?${params.toString()}` }, { replace: true });
    }, [location.pathname, location.search, navigate, selectedConversation]);

    const hideSidebarInMedium = isMedium && showCommentsSidebar;
    const wideHideList = !isNarrow && (sidebarCollapsed || hideSidebarInMedium);

    return (
      <div className="tw-flex tw-h-[100dvh] tw-w-full tw-min-w-0 tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
        <main className="tw-relative tw-min-w-0 tw-flex-1 tw-overflow-hidden">
          {isNarrow ? (
            <div
              className={[
                'tw-flex tw-h-full tw-min-h-0 tw-flex-col',
                showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
              ].join(' ')}
              aria-hidden={showSettingsSheet}
            >
              <div className="tw-min-h-0 tw-flex-1">
                <Routes location={routesLocation}>
                  <Route
                    path="/"
                    element={
                      <ConversationsScene
                        listShell={{
                          rightSlot: (
                            <button
                              type="button"
                              onClick={openSettings}
                              className={headerButtonClassName()}
                              aria-label={t('openSettingsAria')}
                              {...tooltipAttrs(t('openSettings'))}
                            >
                              <span className="tw-sr-only">{t('settingsLabel')}</span>
                              <SettingsIcon size={16} strokeWidth={1.6} aria-hidden="true" />
                            </button>
                          ),
                        }}
                        onOpenInsightsSection={openInsightSettings}
                        onOpenSettingsSection={openProviderSettings}
                        commentsSidebarRuntime={{
                          sidebarSession: commentsSidebarSession,
                          sidebarController: commentsSidebarController,
                          sidebarSnapshot: commentsSidebarSnapshot,
                          subscribeSidebarClose,
                        }}
                        getCommentsLocatorSurfaceRoots={getCommentsLocatorSurfaceRoots}
                        subscribeCommentsLocatorSurfaceRoots={subscribeCommentsLocatorSurfaceRoots}
                        onCommentsLocatorSurfaceRootsChange={setCommentsLocatorSurfaceRoots}
                        narrowCommentsOpenSource="app"
                      />
                    }
                  />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
          ) : (
            <div className="tw-flex tw-h-full tw-min-h-0 tw-min-w-0">
              <div
                className={[
                  'tw-h-full tw-min-w-0 tw-flex-1 tw-overflow-hidden',
                  showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
                ].join(' ')}
                {...(showSettingsSheet ? ({ inert: '' } as any) : {})}
                aria-hidden={showSettingsSheet}
              >
                <Routes location={routesLocation}>
                  <Route
                    path="/"
                    element={
                      <ConversationsScene
                        wideChrome="none"
                        wideHideList={wideHideList}
                        wideDetail={
                          <ConversationDetailPane
                            onExpandSidebar={sidebarCollapsed ? () => setCollapsed(false) : undefined}
                            onTriggerCommentsSidebar={canToggleCommentsSidebar ? triggerCommentsSidebar : undefined}
                            onCommentsLocatorRootsChange={setCommentsLocatorSurfaceRoots}
                            commentsSidebarOpen={showCommentsSidebar}
                          />
                        }
                        listShell={{
                          rightSlot: (
                            <>
                              <button
                                type="button"
                                onClick={openSettings}
                                className={headerButtonClassName()}
                                aria-label={t('openSettingsAria')}
                                {...tooltipAttrs(t('openSettings'))}
                              >
                                <span className="tw-sr-only">{t('settingsLabel')}</span>
                                <SettingsIcon size={16} strokeWidth={1.6} aria-hidden="true" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setCollapsed(true)}
                                className={headerButtonClassName()}
                                aria-label={t('collapseSidebar')}
                              >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                  <path
                                    d="M6.25 3.25L3 6.5L6.25 9.75"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M3.2 6.5H12.75"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </button>
                            </>
                          ),
                        }}
                        onOpenInsightsSection={openInsightSettings}
                        onOpenSettingsSection={openProviderSettings}
                      />
                    }
                  />
                  <Route path="/settings" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>

              {showCommentsSidebar ? (
                <div className="tw-h-full tw-min-h-0 tw-shrink-0">
                  <ArticleCommentsSection
                    sidebarSession={commentsSidebarSession}
                    containerClassName="tw-h-full tw-min-h-0"
                    getLocatorSurfaceRoots={getCommentsLocatorSurfaceRoots}
                    subscribeLocatorSurfaceRoots={subscribeCommentsLocatorSurfaceRoots}
                  />
                </div>
              ) : null}
            </div>
          )}

          {showSettingsSheet ? (
            <div
              className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4"
              role="dialog"
              aria-modal="true"
              aria-label={t('settingsDialogAria')}
            >
              <div
                className="tw-absolute tw-inset-0 tw-bg-[var(--bg-overlay)]"
                role="presentation"
                onMouseDown={(e) => {
                  e.preventDefault();
                  closeSettings();
                }}
              />
              <div
                className="tw-relative tw-z-10 tw-h-[min(760px,calc(100vh-40px))] tw-w-[min(1080px,calc(100vw-40px))] tw-overflow-hidden tw-rounded-[var(--radius-outer)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeSettings}
                  ref={settingsCloseButtonRef}
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
      <AppShellRouterProviders
        sidebarCollapsed={sidebarCollapsed}
        wideCommentsSidebarCollapsed={wideCommentsSidebarCollapsed}
        mediumCommentsSidebarCollapsed={mediumCommentsSidebarCollapsed}
        setCollapsed={setCollapsed}
        setWideCommentsCollapsed={setWideCommentsCollapsed}
        setMediumCommentsCollapsed={setMediumCommentsSidebarCollapsed}
      />
    </HashRouter>
  );
}
