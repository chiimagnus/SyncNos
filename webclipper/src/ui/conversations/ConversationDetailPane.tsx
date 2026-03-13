import { ChevronLeft } from 'lucide-react';

import { ChatMessageBubble } from '../shared/ChatMessageBubble';

import { t, formatConversationTitle } from '../../i18n';
import { useConversationsApp } from './conversations-context';
import { DetailHeaderActionBar } from './DetailHeaderActionBar';
import { buttonTintClassName } from '../shared/button-styles';
import { navIconButtonSmClassName } from '../shared/nav-styles';

export type ConversationDetailPaneProps = {
  onBack?: () => void;
  hideHeader?: boolean;
};

export function ConversationDetailPane({ onBack, hideHeader = false }: ConversationDetailPaneProps) {
  const {
    activeId,
    listError,
    selectedConversation: selected,
    loadingDetail,
    detailError,
    detail,
    detailHeaderActions,
  } = useConversationsApp();

  const safeActions = Array.isArray(detailHeaderActions) ? detailHeaderActions : [];
  const openActions = safeActions.filter((action) => action.slot === 'open');
  const chatWithActions = safeActions.filter((action) => action.slot === 'chat-with');

  const outlineButtonClass = buttonTintClassName();
  const isArticle = String((selected as any)?.sourceType || '').trim().toLowerCase() === 'article';

  return (
    <section>
      <section
        className="tw-flex tw-flex-col"
        aria-label={t('conversationDetailAria')}
      >
        {!hideHeader ? (
          <header className="tw-flex tw-flex-nowrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-pb-2">
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-start tw-gap-2">
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
            <div className="tw-flex tw-shrink-0 tw-flex-nowrap tw-items-center tw-gap-2">
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
            </div>
          </header>
        ) : null}

        {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{listError}</p> : null}
        {loadingDetail ? <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('loadingDots')}</p> : null}
        {detailError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{detailError}</p> : null}

        {detail?.messages?.length ? (
          <div className="tw-mt-3 tw-grid tw-gap-2.5">
            {detail.messages.map((m) => {
              const text = String((m as any).contentMarkdown || (m as any).contentText || '');
              return (
                <ChatMessageBubble
                  key={String((m as any).id)}
                  role={isArticle ? undefined : (m as any).role}
                  markdown={text}
                />
              );
            })}
          </div>
        ) : activeId ? (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('noMessages')}</p>
        ) : (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('selectAConversation')}</p>
        )}
      </section>
    </section>
  );
}
