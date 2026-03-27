import { ChevronLeft } from 'lucide-react';

import { ChatMessageBubble } from '@ui/shared/ChatMessageBubble';

import { t, formatConversationTitle } from '@i18n';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { DetailHeaderActionBar } from '@ui/conversations/DetailHeaderActionBar';
import { buttonTintClassName, headerButtonClassName } from '@ui/shared/button-styles';
import { tooltipAttrs } from '@ui/shared/AppTooltip';
import { ArticleCommentsSection } from '@ui/conversations/ArticleCommentsSection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildArticleCommentLocatorFromRange } from '@services/comments/locator';
import type { ArticleCommentLocator } from '@services/comments/domain/models';
import { storageGet, storageOnChanged } from '@services/shared/storage';
import {
  MARKDOWN_READING_PROFILE_STORAGE_KEY,
  normalizeStoredMarkdownReadingProfile,
} from '@services/protocols/markdown-reading-profile-storage';

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

function isArticleConversationLike(conversation: any): boolean {
  const sourceType = String(conversation?.sourceType || '')
    .trim()
    .toLowerCase();
  if (sourceType === 'article') return true;

  const source = String(conversation?.source || '')
    .trim()
    .toLowerCase();
  if (source !== 'web') return false;
  return Boolean(normalizeHttpUrl(conversation?.url));
}

export type ConversationDetailPaneProps = {
  onBack?: () => void;
  hideHeader?: boolean;
  onExpandSidebar?: () => void;
  onTriggerCommentsSidebar?: (input: { quoteText: string; locator: ArticleCommentLocator | null }) => void;
  onCommentsLocatorRootChange?: (root: Element | null) => void;
  commentsSidebarOpen?: boolean;
};

export function ConversationDetailPane({
  onBack,
  hideHeader = false,
  onExpandSidebar,
  onTriggerCommentsSidebar,
  onCommentsLocatorRootChange,
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
    cleanUrlDraft,
  } = useConversationsApp();

  const safeActions = Array.isArray(detailHeaderActions) ? detailHeaderActions : [];
  const openActions = safeActions.filter((action) => action.slot === 'open');
  const toolActions = safeActions.filter((action) => action.slot === 'tools');

  const outlineButtonClass = buttonTintClassName();
  const headerIconButtonClass = headerButtonClassName();
  const isArticle = isArticleConversationLike(selected);
  const canonicalUrl = normalizeHttpUrl((selected as any)?.url);
  const containerPaddingClassName = 'tw-px-3 md:tw-px-4';
  const expandSidebarLabel = t('expandSidebar');
  const hasArticleCommentsPane = Boolean(isArticle && selected && canonicalUrl);
  const commentsSidebarLabel = t('openCommentsSidebar');
  const messagesRootRef = useRef<HTMLDivElement | null>(null);
  const setMessagesRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      messagesRootRef.current = node;
      try {
        onCommentsLocatorRootChange?.(node);
      } catch (_e) {
        // ignore
      }
    },
    [onCommentsLocatorRootChange],
  );
  const selectionQuoteRef = useRef<string>('');
  const selectionLocatorRef = useRef<ArticleCommentLocator | null>(null);

  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlCleaning, setUrlCleaning] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const displayedUrl = String((selected as any)?.url || '').trim();
  const [markdownReadingProfile, setMarkdownReadingProfile] = useState(() => normalizeStoredMarkdownReadingProfile(''));

  useEffect(() => {
    setUrlEditing(false);
    setUrlDraft('');
    setUrlCleaning(false);
  }, [activeId]);

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

  useEffect(() => {
    let disposed = false;

    void storageGet([MARKDOWN_READING_PROFILE_STORAGE_KEY])
      .then((res) => {
        if (disposed) return;
        setMarkdownReadingProfile(normalizeStoredMarkdownReadingProfile(res?.[MARKDOWN_READING_PROFILE_STORAGE_KEY]));
      })
      .catch(() => {
        if (disposed) return;
        setMarkdownReadingProfile(normalizeStoredMarkdownReadingProfile(''));
      });

    const unsubscribe = storageOnChanged((changes: any, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes || typeof changes !== 'object') return;
      if (!Object.prototype.hasOwnProperty.call(changes, MARKDOWN_READING_PROFILE_STORAGE_KEY)) return;
      const nextValue = changes[MARKDOWN_READING_PROFILE_STORAGE_KEY]?.newValue;
      setMarkdownReadingProfile(normalizeStoredMarkdownReadingProfile(nextValue));
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const saveUrlDraft = async () => {
    await updateSelectedConversationUrl(String(urlDraft || ''));
    setUrlEditing(false);
  };

  const readSelectionQuote = (): string => {
    const root = messagesRootRef.current;
    if (!root) return '';
    try {
      const sel = globalThis.getSelection?.();
      if (!sel || sel.rangeCount <= 0) return '';
      const text = String(sel.toString() || '').trim();
      if (!text) return '';
      const anchor = sel.anchorNode as any as Node | null;
      const focus = sel.focusNode as any as Node | null;
      if (anchor && !root.contains(anchor)) return '';
      if (focus && !root.contains(focus)) return '';
      return text;
    } catch (_e) {
      return '';
    }
  };

  const readSelectionRange = (): Range | null => {
    const root = messagesRootRef.current;
    if (!root) return null;
    try {
      const sel = globalThis.getSelection?.();
      if (!sel || sel.rangeCount <= 0) return null;
      const range = sel.getRangeAt(0);
      const anchor = sel.anchorNode as any as Node | null;
      const focus = sel.focusNode as any as Node | null;
      if (anchor && !root.contains(anchor)) return null;
      if (focus && !root.contains(focus)) return null;
      return range.cloneRange();
    } catch (_e) {
      return null;
    }
  };

  return (
    <section className="tw-min-h-full tw-bg-[var(--bg-card)]">
      <section className="tw-flex tw-flex-col tw-bg-[var(--bg-card)]" aria-label={t('conversationDetailAria')}>
        {!hideHeader ? (
          <header
            className={[
              'tw-sticky tw-top-0 tw-z-20 tw-flex tw-flex-col tw-items-stretch tw-gap-2 tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-pt-3 tw-pb-2 md:tw-flex-row md:tw-items-start md:tw-justify-between md:tw-gap-3 md:tw-pt-4',
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
                          className="tw-min-w-0 tw-flex-1 tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-primary)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
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
                              setUrlEditing(false);
                              setUrlDraft('');
                              return;
                            }
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void (async () => {
                                try {
                                  await saveUrlDraft();
                                } catch (error) {
                                  const message =
                                    error instanceof Error && error.message
                                      ? error.message
                                      : String(error || t('actionFailedFallback'));
                                  if (message === 'SYNCNOS_URL_EDIT_CANCELLED') return;
                                  if (typeof globalThis.window?.alert === 'function') globalThis.window.alert(message);
                                  else console.error(message);
                                }
                              })();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="tw-shrink-0 tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-extrabold tw-text-[var(--text-secondary)] hover:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_85%,var(--bg-card))] disabled:tw-opacity-60"
                          disabled={urlCleaning}
                          onClick={() => {
                            if (urlCleaning) return;
                            void (async () => {
                              setUrlCleaning(true);
                              try {
                                const cleaned = await cleanUrlDraft(String(urlDraft || ''));
                                setUrlDraft(cleaned);
                              } catch (error) {
                                const message =
                                  error instanceof Error && error.message
                                    ? error.message
                                    : String(error || t('actionFailedFallback'));
                                if (typeof globalThis.window?.alert === 'function') globalThis.window.alert(message);
                                else console.error(message);
                              } finally {
                                setUrlCleaning(false);
                              }
                            })();
                          }}
                        >
                          {urlCleaning ? '清理中…' : '清理参数'}
                        </button>
                        <span className="tw-shrink-0 tw-whitespace-nowrap tw-opacity-80">Enter 保存 · Esc 取消</span>
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
            <div className="tw-flex tw-w-full tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 md:tw-w-auto md:tw-flex-nowrap">
              {!isArticle ? (
                <DetailHeaderActionBar
                  actions={toolActions}
                  buttonClassName={outlineButtonClass}
                  menuTriggerLabel={t('detailHeaderToolsMenuLabel')}
                  menuTriggerAriaLabel={t('detailHeaderToolsMenuAria')}
                  menuAriaLabel={t('detailHeaderToolsMenuAria')}
                />
              ) : null}
              <DetailHeaderActionBar
                actions={openActions}
                buttonClassName={headerIconButtonClass}
                iconOnly
                menuTriggerLabel={t('detailHeaderOpenInMenuLabel')}
                menuTriggerAriaLabel={t('detailHeaderOpenInMenuAria')}
                menuAriaLabel={t('detailHeaderOpenInMenuAria')}
              />

              {onTriggerCommentsSidebar ? (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    selectionQuoteRef.current = readSelectionQuote();
                    selectionLocatorRef.current = null;
                    const range = readSelectionRange();
                    if (range && messagesRootRef.current) {
                      const locatorRoot = messagesRootRef.current;
                      selectionLocatorRef.current = buildArticleCommentLocatorFromRange({
                        env: 'app',
                        root: locatorRoot,
                        range,
                      });
                    }
                    // Avoid the button stealing focus and potentially collapsing selection before we read it.
                    try {
                      e.preventDefault();
                    } catch (_e2) {
                      // ignore
                    }
                  }}
                  onClick={() => {
                    const quoteText = String(selectionQuoteRef.current || '').trim();
                    // When no selection, explicitly clear the quote.
                    onTriggerCommentsSidebar({ quoteText, locator: selectionLocatorRef.current });
                  }}
                  className={headerButtonClassName()}
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
            </div>
          </header>
        ) : null}

        <div
          className={[containerPaddingClassName, 'tw-pb-3 md:tw-pb-4', hideHeader ? 'tw-pt-3 md:tw-pt-4' : ''].join(
            ' ',
          )}
        >
          <div className="tw-flex tw-min-w-0 tw-gap-4">
            <div className="tw-min-w-0 tw-flex-1">
              {listError ? (
                <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{listError}</p>
              ) : null}
              {loadingDetail ? (
                <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  {t('loadingDots')}
                </p>
              ) : null}
              {detailError ? (
                <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{detailError}</p>
              ) : null}

              {/* Narrow screens: keep inline comments. */}
              {hasArticleCommentsPane ? (
                <div className="md:tw-hidden">
                  <ArticleCommentsSection
                    conversationId={Number((selected as any)?.id || activeId || 0)}
                    canonicalUrl={canonicalUrl}
                  />
                </div>
              ) : null}

              {detail?.messages?.length ? (
                <div ref={setMessagesRootRef} className="tw-mt-3 tw-grid tw-gap-2.5">
                  {detail.messages.map((m) => {
                    const text = String((m as any).contentMarkdown || (m as any).contentText || '');
                    const messageConversationId = Number(
                      (m as any).conversationId || (selected as any)?.id || activeId,
                    );
                    return (
                      <ChatMessageBubble
                        key={String((m as any).id)}
                        role={isArticle ? 'assistant' : (m as any).role}
                        markdown={text}
                        readingProfile={markdownReadingProfile}
                        conversationId={
                          Number.isFinite(messageConversationId) && messageConversationId > 0
                            ? messageConversationId
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              ) : activeId ? (
                <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('noMessages')}</p>
              ) : (
                <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  {t('selectAConversation')}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
