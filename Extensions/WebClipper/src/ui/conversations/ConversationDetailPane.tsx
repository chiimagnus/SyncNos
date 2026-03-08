import { ChevronLeft } from 'lucide-react';

import { ChatMessageBubble } from '../shared/ChatMessageBubble';

import { t, formatConversationTitle } from '../../i18n';
import { useConversationsApp } from './conversations-context';
import { DetailHeaderActionBar } from './DetailHeaderActionBar';
import { buttonTintClassName } from '../shared/button-styles';
import { navIconButtonSmClassName } from '../shared/nav-styles';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

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

  return (
    <section>
      <section className="tw-flex tw-flex-col tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label={t('conversationDetailAria')}>
        {!hideHeader ? (
          <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-pb-2">
            <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              {onBack ? (
                <button type="button" onClick={onBack} className={navIconButtonSmClassName(false)} aria-label={t('backButton')}>
                  <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
                  <span className="tw-sr-only">{t('backButton')}</span>
                </button>
              ) : null}

              <div className="tw-min-w-0">
                <h2 className="tw-m-0 tw-text-[20px] tw-font-extrabold tw-leading-[1.18] tw-tracking-[-0.01em] tw-text-[var(--text)] tw-break-words [overflow-wrap:anywhere]">
                  {selected ? formatConversationTitle(selected.title) : t('detailTitle')}
                </h2>
                <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                  {selected ? `${(selected as any).source} · ${(selected as any).conversationKey}` : t('selectConversationHint')}
                </div>
              </div>
            </div>
            <div className="tw-flex tw-items-center tw-gap-2">
              <DetailHeaderActionBar
                actions={chatWithActions}
                buttonClassName={outlineButtonClass}
                menuTriggerLabel="Chat with..."
                menuTriggerTitle="Chat with..."
                menuTriggerAriaLabel="Chat with"
                menuAriaLabel="Chat with"
              />
              <DetailHeaderActionBar actions={openActions} buttonClassName={outlineButtonClass} />
            </div>
          </header>
        ) : null}

        {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{listError}</p> : null}
        {loadingDetail ? <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{t('loadingDots')}</p> : null}
        {detailError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{detailError}</p> : null}

        {detail?.messages?.length ? (
          <div className="tw-mt-3 tw-grid tw-gap-2.5">
            {detail.messages.map((m) => {
              const text = String((m as any).contentMarkdown || (m as any).contentText || '');
              return (
                <ChatMessageBubble
                  key={String((m as any).id)}
                  role={(m as any).role}
                  headerLeft={String((m as any).role || t('messageRoleFallback'))}
                  headerRight={formatTime((m as any).updatedAt)}
                  markdown={text}
                />
              );
            })}
          </div>
        ) : activeId ? (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{t('noMessages')}</p>
        ) : (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">{t('selectAConversation')}</p>
        )}
      </section>
    </section>
  );
}
