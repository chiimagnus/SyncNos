import { ChevronLeft, MoreHorizontal } from 'lucide-react';

import { ChatDetailView } from '@ui/conversations/views/ChatDetailView';
import { ArticleReaderView } from '@ui/conversations/views/ArticleReaderView';
import { ChatOutlinePanel } from '@ui/conversations/chat-outline/ChatOutlinePanel';
import { buildChatOutlineEntries, type ChatOutlineEntry } from '@ui/conversations/chat-outline/outline-entries';
import { useChatOutlineActiveIndex } from '@ui/conversations/chat-outline/useChatOutlineActiveIndex';

import { t, formatConversationTitle } from '@i18n';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { DetailHeaderActionBar } from '@ui/conversations/DetailHeaderActionBar';
import {
  buttonFilledClassName,
  buttonMenuItemClassName,
  buttonTintClassName,
  headerButtonClassName,
} from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { tooltipAttrs } from '@ui/shared/AppTooltip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countWordsFromMessages } from '@services/shared/word-count';
import { conversationKinds } from '@services/protocols/conversation-kinds';
import type { CommentLocatorSurfaceRoots } from '@ui/comments';

function findRouteScrollRoot(messagesRoot: Element | null): Element | null {
  if (!messagesRoot || typeof messagesRoot.closest !== 'function') return null;
  return messagesRoot.closest('.route-scroll');
}

const DEFAULT_VIEW = {
  renderer: 'chat' as const,
  readerFeatures: {
    textLayout: false,
    theme: false,
    narration: false,
  },
  commentsSidebar: false,
};

export type ConversationDetailPaneProps = {
  onBack?: () => void;
  onExpandSidebar?: () => void;
  onTriggerCommentsSidebar?: () => void;
  onCommentsLocatorRootsChange?: (roots: CommentLocatorSurfaceRoots | null) => void;
  commentsSidebarOpen?: boolean;
};

export function ConversationDetailPane({
  onBack,
  onExpandSidebar,
  onTriggerCommentsSidebar,
  onCommentsLocatorRootsChange,
  commentsSidebarOpen = false,
}: ConversationDetailPaneProps) {
  const {
    activeId,
    listError,
    selectedConversation: selected,
    loadingDetail,
    detailError,
    detail,
    detailHeaderActions,
    updateSelectedConversationUrl,
  } = useConversationsApp();

  const safeActions = Array.isArray(detailHeaderActions) ? detailHeaderActions : [];
  const openActions = safeActions.filter((action) => action.slot === 'open');
  const copyActions = safeActions.filter((action) => action.slot === 'copy');
  const toolActions = safeActions.filter((action) => action.slot === 'tools');
  const moreActions = [...openActions, ...toolActions];
  const copyActionScopeKey = JSON.stringify([
    Number((selected as any)?.id ?? activeId) || 0,
    copyActions.map((action) => [action.id, String(action.href || '')]),
  ]);

  const headerIconButtonClass = headerButtonClassName();
  const kindView = conversationKinds.pick(selected as any)?.view ?? DEFAULT_VIEW;
  const isArticleRenderer = kindView.renderer === 'article';
  const isChatRenderer = kindView.renderer === 'chat';
  const readerFeatures = kindView.readerFeatures;
  const canOpenCommentsSidebar = kindView.commentsSidebar && typeof onTriggerCommentsSidebar === 'function';
  const containerPaddingClassName = 'tw-px-3 md:tw-px-4';
  const expandSidebarLabel = t('expandSidebar');
  const commentsSidebarLabel = t('openCommentsSidebar');
  const messagesRootRef = useRef<HTMLDivElement | null>(null);
  const userMessageElByIdRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const userMessageRefSetterByIdRef = useRef<Map<number, (node: HTMLDivElement | null) => void>>(new Map());
  const optimisticActiveClearTimerRef = useRef<number | null>(null);
  const [userMessageRefsVersion, setUserMessageRefsVersion] = useState(0);
  const [outlineScrollRoot, setOutlineScrollRoot] = useState<Element | null>(null);
  const [optimisticActiveIndex, setOptimisticActiveIndex] = useState<number | null>(null);
  const [readerToolbarPortalTarget, setReaderToolbarPortalTarget] = useState<HTMLDivElement | null>(null);
  const [readerOutlinePortalTarget, setReaderOutlinePortalTarget] = useState<HTMLDivElement | null>(null);
  const outlineEntries = useMemo(
    () => (isChatRenderer && Array.isArray(detail?.messages) ? buildChatOutlineEntries(detail.messages) : []),
    [isChatRenderer, detail?.messages],
  );
  const outlineIndexByMessageId = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of outlineEntries) map.set(entry.messageId, entry.index);
    return map;
  }, [outlineEntries]);
  const setMessagesRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      messagesRootRef.current = node;
      setOutlineScrollRoot(findRouteScrollRoot(node));
      try {
        onCommentsLocatorRootsChange?.(
          node ? { sourceRoot: node, scrollRoot: findRouteScrollRoot(node) || node } : null,
        );
      } catch (_e) {
        // ignore
      }
    },
    [onCommentsLocatorRootsChange],
  );
  const setUserMessageEl = useCallback((messageId: number, node: HTMLDivElement | null) => {
    const map = userMessageElByIdRef.current;
    const current = map.get(messageId) || null;
    if (node) {
      if (current === node) return;
      map.set(messageId, node);
      setUserMessageRefsVersion((value) => value + 1);
      return;
    }
    if (!current) return;
    map.delete(messageId);
    setUserMessageRefsVersion((value) => value + 1);
  }, []);
  const getUserMessageRefSetter = useCallback(
    (messageId: number) => {
      const existing = userMessageRefSetterByIdRef.current.get(messageId);
      if (existing) return existing;
      const setter = (node: HTMLDivElement | null) => {
        setUserMessageEl(messageId, node);
      };
      userMessageRefSetterByIdRef.current.set(messageId, setter);
      return setter;
    },
    [setUserMessageEl],
  );
  const userMessageEls = useMemo(() => {
    void userMessageRefsVersion;
    return outlineEntries
      .map((entry) => userMessageElByIdRef.current.get(entry.messageId))
      .filter((el): el is HTMLDivElement => Boolean(el));
  }, [outlineEntries, userMessageRefsVersion]);
  const observedActiveIndex = useChatOutlineActiveIndex({
    root: outlineScrollRoot,
    userMessageEls,
    messagesRootEl: messagesRootRef.current,
  });
  const activeOutlineIndex = optimisticActiveIndex ?? observedActiveIndex;
  const pickOutlineEntry = useCallback((entry: ChatOutlineEntry) => {
    setOptimisticActiveIndex(entry.index);
    if (optimisticActiveClearTimerRef.current != null) {
      globalThis.window?.clearTimeout(optimisticActiveClearTimerRef.current);
      optimisticActiveClearTimerRef.current = null;
    }
    optimisticActiveClearTimerRef.current = globalThis.window?.setTimeout(() => {
      setOptimisticActiveIndex(null);
      optimisticActiveClearTimerRef.current = null;
    }, 520);

    const target = userMessageElByIdRef.current.get(entry.messageId);
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (_e) {
      target.scrollIntoView();
    }
  }, []);

  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const displayedUrl = String((selected as any)?.url || '').trim();
  const wordCount = useMemo(() => {
    if (!selected) return null;
    if (!Array.isArray(detail?.messages) || !detail.messages.length) return null;
    return countWordsFromMessages(detail.messages);
  }, [detail?.messages, selected]);
  const wordCountLabel = t('detailWordCountLabel');
  const wordCountText =
    wordCount != null && Number.isFinite(wordCount)
      ? `${wordCountLabel} ${Math.max(0, Math.floor(wordCount)).toLocaleString()}`
      : '';
  const hasReaderMoreMenuContent = readerFeatures.textLayout || readerFeatures.theme || readerFeatures.narration;
  const hasMoreMenuContent = Boolean(wordCountText) || moreActions.length > 0 || hasReaderMoreMenuContent;
  const moreMenuPanelClassName = 'tw-w-[214px] tw-max-w-[min(214px,calc(100vw-28px))] tw-text-[var(--text-primary)]';
  const closeMoreMenu = useCallback(() => {
    setMoreMenuOpen(false);
    setReaderToolbarPortalTarget(null);
  }, []);
  const handleMoreMenuOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setMoreMenuOpen(true);
        return;
      }
      closeMoreMenu();
    },
    [closeMoreMenu],
  );

  useEffect(() => {
    setUrlEditing(false);
    setUrlDraft('');
    closeMoreMenu();
  }, [activeId, selected?.id, closeMoreMenu]);

  useEffect(() => {
    userMessageElByIdRef.current.clear();
    userMessageRefSetterByIdRef.current.clear();
    setUserMessageRefsVersion((value) => value + 1);
    setOptimisticActiveIndex(null);
    if (optimisticActiveClearTimerRef.current != null) {
      globalThis.window?.clearTimeout(optimisticActiveClearTimerRef.current);
      optimisticActiveClearTimerRef.current = null;
    }
  }, [activeId]);

  useEffect(() => {
    if (!messagesRootRef.current) {
      setOutlineScrollRoot(null);
      return;
    }
    setOutlineScrollRoot(findRouteScrollRoot(messagesRootRef.current));
  }, [activeId]);

  useEffect(() => {
    if (optimisticActiveIndex == null) return;
    if (observedActiveIndex !== optimisticActiveIndex) return;
    setOptimisticActiveIndex(null);
    if (optimisticActiveClearTimerRef.current != null) {
      globalThis.window?.clearTimeout(optimisticActiveClearTimerRef.current);
      optimisticActiveClearTimerRef.current = null;
    }
  }, [optimisticActiveIndex, observedActiveIndex]);

  useEffect(() => {
    return () => {
      if (optimisticActiveClearTimerRef.current == null) return;
      globalThis.window?.clearTimeout(optimisticActiveClearTimerRef.current);
      optimisticActiveClearTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!urlEditing) return;
    const timer = setTimeout(() => {
      try {
        urlInputRef.current?.focus?.();
      } catch (_e) {
        // ignore
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [urlEditing]);

  const saveUrlDraft = async () => {
    await updateSelectedConversationUrl(String(urlDraft || ''));
    setUrlEditing(false);
  };

  const cancelUrlEditing = () => {
    setUrlEditing(false);
    setUrlDraft('');
  };

  const submitUrlDraft = () => {
    void saveUrlDraft().catch((error) => {
      const message =
        error instanceof Error && error.message ? error.message : String(error || t('actionFailedFallback'));
      if (message === 'SYNCNOS_URL_EDIT_CANCELLED') return;
      if (typeof globalThis.window?.alert === 'function') globalThis.window.alert(message);
      else console.error(message);
    });
  };

  return (
    <section className="tw-min-h-full tw-bg-[var(--bg-card)]">
      <section className="tw-flex tw-flex-col tw-bg-[var(--bg-card)]" aria-label={t('conversationDetailAria')}>
        <header
          className={[
            'tw-sticky tw-top-0 tw-z-20 tw-relative tw-flex tw-items-start tw-justify-between tw-gap-2 tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-pt-3 tw-pb-2 md:tw-gap-3 md:tw-pt-4',
            containerPaddingClassName,
          ].join(' ')}
        >
          <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-start tw-gap-2">
            {onExpandSidebar ? (
              <button
                type="button"
                onClick={onExpandSidebar}
                className={headerIconButtonClass}
                aria-label={expandSidebarLabel}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M9.75 3.25L13 6.5L9.75 9.75"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M12.8 6.5H3.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span className="tw-sr-only">{expandSidebarLabel}</span>
              </button>
            ) : null}

            {onBack ? (
              <button type="button" onClick={onBack} className={headerIconButtonClass} aria-label={t('backButton')}>
                <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
                <span className="tw-sr-only">{t('backButton')}</span>
              </button>
            ) : null}

            <div className="tw-min-w-0 tw-flex-1">
              <h2 className="tw-m-0 tw-block tw-min-w-0 tw-truncate tw-text-[20px] tw-font-extrabold tw-leading-[1.18] tw-tracking-[-0.01em] tw-text-[var(--text-primary)]">
                {selected ? formatConversationTitle(selected.title) : t('detailTitle')}
              </h2>
              {selected ? (
                <div className="tw-mt-1 tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                  {urlEditing ? (
                    <>
                      <input
                        ref={urlInputRef}
                        className="tw-min-w-0 tw-w-56 tw-max-w-full tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-primary)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        placeholder="https://"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelUrlEditing();
                            return;
                          }
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitUrlDraft();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={`${buttonFilledClassName()} tw-h-6 tw-min-h-0 tw-shrink-0 tw-px-2 tw-text-[11px]`}
                        onClick={submitUrlDraft}
                      >
                        {t('saveButton')}
                      </button>
                      <button
                        type="button"
                        className={`${buttonTintClassName()} tw-h-6 tw-min-h-0 tw-shrink-0 tw-px-2 tw-text-[11px]`}
                        onClick={cancelUrlEditing}
                      >
                        {t('cancelButton')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="tw-min-w-0 tw-flex-1 tw-truncate tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0 tw-text-left tw-shadow-none tw-cursor-text focus:tw-outline-none focus-visible:tw-outline-none"
                        onClick={() => {
                          setUrlDraft(displayedUrl);
                          setUrlEditing(true);
                        }}
                        aria-label={displayedUrl ? 'Edit URL' : 'Set URL'}
                        title={displayedUrl || t('noLinkAvailable')}
                      >
                        {displayedUrl || t('noLinkAvailable')}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="tw-mt-1 tw-min-w-0 tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                  {t('selectConversationHint')}
                </div>
              )}
            </div>
          </div>
          <div className="tw-flex tw-shrink-0 tw-items-center tw-justify-end tw-gap-2 tw-whitespace-nowrap">
            <DetailHeaderActionBar
              key={copyActionScopeKey}
              actions={copyActions}
              buttonClassName={headerIconButtonClass}
              menuTriggerLabel={t('detailHeaderCopyLinkMenuLabel')}
              menuTriggerAriaLabel={t('detailHeaderCopyLinkMenuAria')}
              menuAriaLabel={t('detailHeaderCopyLinkMenuAria')}
              className="tw-order-1"
            />

            {canOpenCommentsSidebar ? (
              <button
                type="button"
                onClick={() => {
                  onTriggerCommentsSidebar?.();
                }}
                className={[headerButtonClassName(), 'tw-order-2'].join(' ')}
                aria-label={commentsSidebarLabel}
                {...tooltipAttrs(commentsSidebarLabel)}
                aria-pressed={commentsSidebarOpen ? 'true' : 'false'}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4 3.5H11.5C12.3284 3.5 13 4.17157 13 5V9.25C13 10.0784 12.3284 10.75 11.5 10.75H7.5L4.75 13V10.75H4C3.17157 10.75 2.5 10.0784 2.5 9.25V5C2.5 4.17157 3.17157 3.5 4 3.5Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M5.25 6H10.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M5.25 8.25H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <span className="tw-sr-only">{commentsSidebarLabel}</span>
              </button>
            ) : null}
            {hasMoreMenuContent ? (
              <MenuPopover
                open={moreMenuOpen}
                onOpenChange={handleMoreMenuOpenChange}
                ariaLabel={t('moreButton')}
                side="bottom"
                align="end"
                panelMinWidth={214}
                panelClassName={moreMenuPanelClassName}
                className="tw-order-3"
                trigger={(triggerProps) => (
                  <button
                    {...triggerProps}
                    data-detail-header-more-trigger="true"
                    aria-label={t('moreButton')}
                    className={headerIconButtonClass}
                  >
                    <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
                    <span className="tw-sr-only">{t('moreButton')}</span>
                  </button>
                )}
              >
                {moreMenuOpen ? (
                  <div className="tw-flex tw-flex-col tw-gap-1">
                    {hasReaderMoreMenuContent ? (
                      <div
                        ref={setReaderToolbarPortalTarget}
                        className="tw-flex tw-flex-col tw-gap-1"
                        data-reader-header-toolbar-slot="true"
                      />
                    ) : null}

                    {moreActions.length ? (
                      <div
                        className={[
                          hasReaderMoreMenuContent ? 'tw-border-t tw-border-[var(--border)] tw-pt-1' : '',
                          'tw-flex tw-flex-col tw-gap-1',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <DetailHeaderActionBar
                          actions={moreActions}
                          buttonClassName={buttonMenuItemClassName()}
                          inlineMenuItems
                          closeMenuOnActionTrigger={closeMoreMenu}
                          className="tw-w-full"
                        />
                      </div>
                    ) : null}

                    {wordCountText ? (
                      <div
                        className={[
                          hasReaderMoreMenuContent || moreActions.length
                            ? 'tw-border-t tw-border-[var(--border)] tw-pt-1'
                            : '',
                          'tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-detail-word-count-row="true"
                        {...tooltipAttrs(wordCountText)}
                      >
                        {wordCountText}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </MenuPopover>
            ) : null}
          </div>

          {isChatRenderer ? (
            <div
              className="tw-absolute tw-right-0 tw-top-full tw-z-30"
              data-chat-outline-root={outlineScrollRoot ? 'route-scroll' : 'viewport'}
            >
              <ChatOutlinePanel
                entries={outlineEntries}
                activeIndex={activeOutlineIndex}
                onPickEntry={pickOutlineEntry}
              />
            </div>
          ) : null}

          {isArticleRenderer ? (
            <div
              ref={setReaderOutlinePortalTarget}
              className="tw-absolute tw-right-3 tw-top-full tw-z-30 tw-pt-3 md:tw-right-4"
              data-reader-outline-toolbar-slot={outlineScrollRoot ? 'route-scroll' : 'viewport'}
            />
          ) : null}
        </header>

        <div className={[containerPaddingClassName, 'tw-relative tw-pb-3 md:tw-pb-4'].join(' ')}>
          {isArticleRenderer ? (
            <ArticleReaderView
              selected={selected}
              activeId={activeId}
              detail={detail}
              listError={listError}
              loadingDetail={loadingDetail}
              detailError={detailError}
              setMessagesRootRef={setMessagesRootRef}
              readerFeatures={readerFeatures}
              readerToolbarPortalTarget={readerToolbarPortalTarget}
              readerOutlinePortalTarget={readerOutlinePortalTarget}
              outlineScrollRoot={outlineScrollRoot}
            />
          ) : (
            <ChatDetailView
              selected={selected}
              activeId={activeId}
              detail={detail}
              listError={listError}
              loadingDetail={loadingDetail}
              detailError={detailError}
              outlineIndexByMessageId={outlineIndexByMessageId}
              getUserMessageRefSetter={getUserMessageRefSetter}
              setMessagesRootRef={setMessagesRootRef}
            />
          )}
        </div>
      </section>
    </section>
  );
}
