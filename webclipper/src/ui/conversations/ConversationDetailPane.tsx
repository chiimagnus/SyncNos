import { ChevronLeft } from 'lucide-react';

import { ChatMessageBubble } from '../shared/ChatMessageBubble';

import { t, formatConversationTitle } from '../../i18n';
import { useConversationsApp } from './conversations-context';
import { DetailHeaderActionBar } from './DetailHeaderActionBar';
import { buttonTintClassName } from '../shared/button-styles';
import { navIconButtonSmClassName } from '../shared/nav-styles';
import { ArticleCommentsSection } from './ArticleCommentsSection';
import { useRef } from 'react';

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

export type ConversationDetailPaneProps = {
  onBack?: () => void;
  hideHeader?: boolean;
  onExpandSidebar?: () => void;
  onTriggerCommentsSidebar?: (quoteText: string) => void;
  commentsSidebarOpen?: boolean;
};

export function ConversationDetailPane({
  onBack,
  hideHeader = false,
  onExpandSidebar,
  onTriggerCommentsSidebar,
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
    refreshActiveDetail,
  } = useConversationsApp();

  const safeActions = Array.isArray(detailHeaderActions) ? detailHeaderActions : [];
  const openActions = safeActions.filter((action) => action.slot === 'open');
  const chatWithActions = safeActions.filter((action) => action.slot === 'chat-with');
  const toolActions = safeActions.filter((action) => action.slot === 'tools');

  const outlineButtonClass = buttonTintClassName();
  const isArticle = String((selected as any)?.sourceType || '').trim().toLowerCase() === 'article';
  const canonicalUrl = normalizeHttpUrl((selected as any)?.url);
  const containerPaddingClassName = 'tw-px-3 md:tw-px-4';
  const expandSidebarLabel = t('expandSidebar');
  const hasArticleCommentsPane = Boolean(isArticle && selected && canonicalUrl);
  const commentsSidebarLabel = t('openCommentsSidebar');
  const messagesRootRef = useRef<HTMLDivElement | null>(null);
  const selectionQuoteRef = useRef<string>('');

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

  return (
    <section>
      <section
        className="tw-flex tw-flex-col"
        aria-label={t('conversationDetailAria')}
      >
        {!hideHeader ? (
          <header
            className={[
              'tw-sticky tw-top-0 tw-z-20 tw-flex tw-flex-col tw-items-stretch tw-gap-2 tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-pt-3 tw-pb-2 md:tw-flex-row md:tw-items-start md:tw-justify-between md:tw-gap-3 md:tw-pt-4',
              containerPaddingClassName,
            ].join(' ')}
          >
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-start tw-gap-2">
              {onExpandSidebar ? (
                <button type="button" onClick={onExpandSidebar} className={navIconButtonSmClassName(false)} aria-label={expandSidebarLabel}>
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
                <button type="button" onClick={onBack} className={navIconButtonSmClassName(false)} aria-label={t('backButton')}>
                  <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
                  <span className="tw-sr-only">{t('backButton')}</span>
                </button>
              ) : null}

              <div className="tw-min-w-0 tw-flex-1">
                <h2 className="tw-m-0 tw-block tw-min-w-0 tw-truncate tw-text-[20px] tw-font-extrabold tw-leading-[1.18] tw-tracking-[-0.01em] tw-text-[var(--text-primary)]">
                  {selected ? formatConversationTitle(selected.title) : t('detailTitle')}
                </h2>
                <div className="tw-mt-1 tw-min-w-0 tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                  {selected ? `${(selected as any).source} · ${(selected as any).conversationKey}` : t('selectConversationHint')}
                </div>
              </div>
            </div>
            <div className="tw-flex tw-w-full tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 md:tw-w-auto md:tw-flex-nowrap">
              {!isArticle ? (
                <DetailHeaderActionBar
                  actions={toolActions}
                  buttonClassName={outlineButtonClass}
                  menuTriggerLabel={t('detailHeaderToolsMenuLabel')}
                  menuTriggerTitle={t('detailHeaderToolsMenuLabel')}
                  menuTriggerAriaLabel={t('detailHeaderToolsMenuAria')}
                  menuAriaLabel={t('detailHeaderToolsMenuAria')}
                />
              ) : null}
              <DetailHeaderActionBar
                actions={chatWithActions}
                buttonClassName={outlineButtonClass}
                menuTriggerLabel={t('detailHeaderChatWithMenuLabel')}
                menuTriggerTitle={t('detailHeaderChatWithMenuLabel')}
                menuTriggerAriaLabel={t('detailHeaderChatWithMenuAria')}
                menuAriaLabel={t('detailHeaderChatWithMenuAria')}
              />
              <DetailHeaderActionBar
                actions={openActions}
                buttonClassName={outlineButtonClass}
                menuTriggerLabel={t('detailHeaderOpenInMenuLabel')}
                menuTriggerTitle={t('detailHeaderOpenInMenuLabel')}
                menuTriggerAriaLabel={t('detailHeaderOpenInMenuAria')}
                menuAriaLabel={t('detailHeaderOpenInMenuAria')}
              />

              {onTriggerCommentsSidebar ? (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    selectionQuoteRef.current = readSelectionQuote();
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
                    onTriggerCommentsSidebar(quoteText);
                  }}
                  className={navIconButtonSmClassName(Boolean(commentsSidebarOpen))}
                  aria-label={commentsSidebarLabel}
                  title={commentsSidebarLabel}
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
          className={[
            containerPaddingClassName,
            'tw-pb-3 md:tw-pb-4',
            hideHeader ? 'tw-pt-3 md:tw-pt-4' : '',
          ].join(' ')}
        >
          <div className="tw-flex tw-min-w-0 tw-gap-4">
            <div className="tw-min-w-0 tw-flex-1">
              {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{listError}</p> : null}
              {loadingDetail ? <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('loadingDots')}</p> : null}
              {detailError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{detailError}</p> : null}

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
                <div ref={messagesRootRef} className="tw-mt-3 tw-grid tw-gap-2.5">
                  {detail.messages.map((m) => {
                    const text = String((m as any).contentMarkdown || (m as any).contentText || '');
                    const messageConversationId = Number((m as any).conversationId || (selected as any)?.id || activeId);
                    return (
                      <ChatMessageBubble
                        key={String((m as any).id)}
                        role={isArticle ? undefined : (m as any).role}
                        markdown={text}
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
                <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('selectAConversation')}</p>
              )}
            </div>

          </div>
        </div>
      </section>
    </section>
  );
}
