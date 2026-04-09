import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { t } from '@i18n';
import Settings from '@ui/app/Settings';
import { ConversationsProvider, useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { ConversationsScene } from '@ui/conversations/ConversationsScene';
import { ConversationDetailPane } from '@ui/conversations/ConversationDetailPane';
import { ArticleCommentsSection } from '@ui/conversations/ArticleCommentsSection';
import { buttonIconCircleGhostClassName, headerButtonClassName } from '@ui/shared/button-styles';
import { AppTooltipHost, tooltipAttrs } from '@ui/shared/AppTooltip';
import { useResponsiveTier } from '@ui/shared/hooks/useResponsiveTier';
import { useArticleCommentsSidebarRuntime } from '@viewmodels/comments/useArticleCommentsSidebarRuntime';
import { decodeConversationLoc, encodeConversationLoc } from '@services/shared/conversation-loc';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { createThreadedCommentChatWithConfig } from '@ui/comments';
import type { ThreadedCommentsPanelChatWithAction } from '@ui/comments';
import { defaultDetailHeaderActionPort, type DetailHeaderAction } from '@services/integrations/detail-header-actions';
import {
  resolveChatWithDetailHeaderActions,
  resolveSingleEnabledChatWithActionLabel,
} from '@services/integrations/chatwith/chatwith-detail-header-actions';
import type { ChatWithOpenPlatformPort } from '@services/integrations/chatwith/chatwith-open-port';
import { CHATWITH_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { createRuntimeClient } from '@services/shared/runtime-client';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';
const COMMENTS_SIDEBAR_COLLAPSED_KEY = 'webclipper_app_comments_sidebar_collapsed';

function isArticleConversationLike(conversation: any): boolean {
  const sourceType = String(conversation?.sourceType || '')
    .trim()
    .toLowerCase();
  if (sourceType === 'article') return true;

  const source = String(conversation?.source || '')
    .trim()
    .toLowerCase();
  if (source !== 'web') return false;
  return Boolean(canonicalizeArticleUrl(conversation?.url));
}

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function isHttpUrl(raw: unknown): boolean {
  return /^https?:\/\//i.test(safeString(raw));
}

function openUrlFallback(url: string): boolean {
  const target = safeString(url);
  if (!target || !isHttpUrl(target)) return false;
  try {
    globalThis.window?.open(target, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_e) {
    return false;
  }
}

export default function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [wideCommentsSidebarCollapsed, setWideCommentsSidebarCollapsed] = useState(false);
  const [mediumCommentsSidebarCollapsed, setMediumCommentsSidebarCollapsed] = useState(true);

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
      const v = localStorage.getItem(COMMENTS_SIDEBAR_COLLAPSED_KEY);
      if (v === '1') setWideCommentsSidebarCollapsed(true);
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

  const setWideCommentsCollapsed = (collapsed: boolean) => {
    setWideCommentsSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_e) {
      // ignore
    }
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
    const {
      sidebarSession: commentsSidebarSession,
      sidebarController: commentsSidebarController,
      sidebarSnapshot: commentsSidebarSnapshot,
      setLocatorRoot: setCommentsLocatorRoot,
      getLocatorRoot: getCommentsLocatorRoot,
      subscribeSidebarClose,
    } = useArticleCommentsSidebarRuntime({
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
    const runtimeClientRef = useRef<ReturnType<typeof createRuntimeClient> | null>(null);
    if (!runtimeClientRef.current) {
      runtimeClientRef.current = createRuntimeClient();
    }
    const location = useLocation();
    const navigate = useNavigate();
    const { openConversationExternalByLoc, selectedConversation, detail } = useConversationsApp();
    const lastInternalLocRef = useRef<string | null>(null);
    const processedLocRef = useRef<string | null>(null);
    const locMountedRef = useRef(false);
    const isArticleConversation = isArticleConversationLike(selectedConversation);
    const canonicalUrl = canonicalizeArticleUrl((selectedConversation as any)?.url);
    const canToggleCommentsSidebar = !isNarrow && isArticleConversation && Boolean(canonicalUrl);
    const commentsSidebarCollapsed = isMedium ? mediumCommentsSidebarCollapsed : wideCommentsSidebarCollapsed;
    const canAutoOpenCommentsSidebarInWide = isWide && canToggleCommentsSidebar;

    const appCommentChatWithOpenPort = useMemo<ChatWithOpenPlatformPort>(
      () => ({
        openPlatform: async (platformId, fallbackUrl, context) => {
          const normalizedPlatformId = safeString(platformId).toLowerCase();
          const normalizedFallbackUrl = safeString(fallbackUrl);
          const normalizedArticleKey = safeString(context?.articleKey);
          if (!normalizedPlatformId) return false;

          const rt = runtimeClientRef.current;
          if (!rt?.send) {
            return openUrlFallback(normalizedFallbackUrl);
          }

          let groupedErrorMessage = '';
          if (normalizedArticleKey) {
            try {
              const groupedResponse = (await rt.send(CHATWITH_MESSAGE_TYPES.OPEN_OR_FOCUS_GROUPED_CHAT_TAB, {
                platformId: normalizedPlatformId,
                articleKey: normalizedArticleKey,
                fallbackUrl: normalizedFallbackUrl,
              })) as any;
              if (groupedResponse?.ok) return true;
              groupedErrorMessage =
                safeString(groupedResponse?.error?.message) ||
                `Failed to open grouped platform tab: ${normalizedPlatformId}`;
            } catch (error) {
              groupedErrorMessage = safeString((error as any)?.message);
            }
          }

          try {
            const response = (await rt.send(CHATWITH_MESSAGE_TYPES.OPEN_PLATFORM_TAB, {
              platformId: normalizedPlatformId,
              fallbackUrl: normalizedFallbackUrl,
            })) as any;
            if (response?.ok) return true;

            const message =
              safeString(response?.error?.message) ||
              groupedErrorMessage ||
              `Failed to open platform: ${normalizedPlatformId}`;
            throw new Error(message);
          } catch (error) {
            if (openUrlFallback(normalizedFallbackUrl)) return true;
            throw error instanceof Error
              ? error
              : new Error(String(error || `Failed to open platform: ${normalizedPlatformId}`));
          }
        },
      }),
      [],
    );

    const showSettingsSheet = !isNarrow && location.pathname === '/settings';
    const state: any = (location as any)?.state ?? {};
    const backgroundLocation = showSettingsSheet ? (state?.backgroundLocation ?? null) : null;
    const settingsOpen = location.pathname === '/settings';
    const showCommentsSidebar =
      canToggleCommentsSidebar &&
      !showSettingsSheet &&
      !commentsSidebarCollapsed &&
      (isMedium || commentsSidebarSnapshot.openRequested || commentsSidebarSnapshot.isOpen);

    const commentsSidebarCommentChatWithRuntimeRef = useRef<{
      showCommentsSidebar: boolean;
      hasConversation: boolean;
      articleTitle: string;
      canonicalUrl: string;
      openPort: ChatWithOpenPlatformPort | null;
    }>({
      showCommentsSidebar: false,
      hasConversation: false,
      articleTitle: '',
      canonicalUrl: '',
      openPort: null,
    });

    commentsSidebarCommentChatWithRuntimeRef.current = {
      showCommentsSidebar,
      hasConversation: Boolean(selectedConversation),
      articleTitle: String((selectedConversation as any)?.title || '').trim(),
      canonicalUrl: canonicalUrl || '',
      openPort: appCommentChatWithOpenPort,
    };

    const commentsSidebarCommentChatWithConfig = useMemo(
      () =>
        createThreadedCommentChatWithConfig({
          resolveContext: () => ({
            articleTitle: commentsSidebarCommentChatWithRuntimeRef.current.articleTitle,
            canonicalUrl: commentsSidebarCommentChatWithRuntimeRef.current.canonicalUrl,
          }),
          isEnabled: () => commentsSidebarCommentChatWithRuntimeRef.current.showCommentsSidebar,
          hasConversation: () => commentsSidebarCommentChatWithRuntimeRef.current.hasConversation,
          resolveOpenPort: () => commentsSidebarCommentChatWithRuntimeRef.current.openPort,
        }),
      [],
    );

    const routesLocation =
      backgroundLocation || (showSettingsSheet ? ({ ...location, pathname: '/' } as any) : location);

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
      if (isArticleConversation && canonicalUrl) {
        commentsSidebarController.setContext({
          canonicalUrl,
          conversationId: Number((selectedConversation as any)?.id || 0) || null,
        });
        return;
      }

      commentsSidebarController.setContext(null);
      suppressCommentsSidebarCollapseRef.current = true;
      try {
        commentsSidebarSession.requestClose();
      } finally {
        suppressCommentsSidebarCollapseRef.current = false;
      }
      commentsSidebarSession.setQuoteText('');
    }, [canonicalUrl, commentsSidebarController, commentsSidebarSession, isArticleConversation, selectedConversation]);

    useEffect(() => {
      if (showSettingsSheet) return;
      if (!canAutoOpenCommentsSidebarInWide) return;
      if (commentsSidebarCollapsed) return;
      if (commentsSidebarSnapshot.openRequested || commentsSidebarSnapshot.isOpen) return;
      void commentsSidebarController.open({ source: 'app-default', focusComposer: false, ensureContext: false });
    }, [
      canAutoOpenCommentsSidebarInWide,
      commentsSidebarCollapsed,
      commentsSidebarController,
      commentsSidebarSession,
      commentsSidebarSnapshot.isOpen,
      commentsSidebarSnapshot.openRequested,
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

    const resolveCommentsSidebarChatWithActions = useCallback(async (): Promise<
      ThreadedCommentsPanelChatWithAction[]
    > => {
      if (!selectedConversation) return [];
      if (!showCommentsSidebar) return [];

      const conversationId = Number((selectedConversation as any)?.id || 0);
      if (!Number.isFinite(conversationId) || conversationId <= 0) return [];

      const currentDetail = detail && Number((detail as any)?.conversationId || 0) === conversationId ? detail : null;
      if (
        !currentDetail ||
        !Array.isArray((currentDetail as any)?.messages) ||
        !(currentDetail as any)?.messages.length
      ) {
        throw new Error('Conversation detail is not ready yet');
      }

      const actions: DetailHeaderAction[] = await resolveChatWithDetailHeaderActions({
        conversation: selectedConversation,
        detail: currentDetail,
        port: defaultDetailHeaderActionPort,
        openPort: appCommentChatWithOpenPort,
      });

      const mapped: ThreadedCommentsPanelChatWithAction[] = [];
      for (const action of actions) {
        const id = String((action as any)?.id || '').trim();
        const label = String((action as any)?.label || '').trim();
        const onTrigger = (action as any)?.onTrigger;
        if (!id || !label || typeof onTrigger !== 'function') continue;
        mapped.push({
          id,
          label,
          disabled: Boolean((action as any)?.disabled),
          onTrigger: () => onTrigger(),
        });
      }
      return mapped;
    }, [appCommentChatWithOpenPort, detail, selectedConversation, showCommentsSidebar]);

    const resolveCommentsSidebarSingleChatWithLabel = useCallback(async (): Promise<string | null> => {
      return resolveSingleEnabledChatWithActionLabel();
    }, []);

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
        processedLocRef.current = loc;
        return;
      }
      if (!loc || processedLocRef.current === loc) return;

      const decoded = decodeConversationLoc(loc);
      if (!decoded) {
        processedLocRef.current = loc;
        return;
      }

      processedLocRef.current = loc;
      void Promise.resolve(
        openConversationExternalByLoc({
          source: decoded.source,
          conversationKey: decoded.conversationKey,
        }),
      ).catch(() => {});
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
      if (currentLoc === nextLoc) return;

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
                        inlineNarrowDetailHeader
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
                          setLocatorRoot: setCommentsLocatorRoot,
                          getLocatorRoot: getCommentsLocatorRoot,
                          subscribeSidebarClose,
                        }}
                        narrowCommentsOpenSource="app"
                        resolveCommentsSidebarChatWithActions={resolveCommentsSidebarChatWithActions}
                        resolveCommentsSidebarSingleChatWithLabel={resolveCommentsSidebarSingleChatWithLabel}
                        commentsSidebarCommentChatWith={commentsSidebarCommentChatWithConfig}
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
                  'tw-h-full tw-min-w-0 tw-flex-1 tw-overflow-hidden',
                  showSettingsSheet ? 'tw-pointer-events-none tw-select-none tw-overflow-hidden' : '',
                ].join(' ')}
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
                            onCommentsLocatorRootChange={(root) => {
                              setCommentsLocatorRoot(root);
                            }}
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
                  <Route path="/sync" element={<Navigate to="/settings" replace />} />
                  <Route path="/backup" element={<Navigate to="/settings" replace />} />
                </Routes>
              </div>

              {showCommentsSidebar ? (
                <div className="tw-h-full tw-min-h-0 tw-shrink-0">
                  <ArticleCommentsSection
                    sidebarSession={commentsSidebarSession}
                    containerClassName="tw-h-full tw-min-h-0"
                    getLocatorRoot={getCommentsLocatorRoot}
                    resolveChatWithActions={resolveCommentsSidebarChatWithActions}
                    resolveChatWithSingleActionLabel={resolveCommentsSidebarSingleChatWithLabel}
                    commentChatWith={commentsSidebarCommentChatWithConfig}
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
