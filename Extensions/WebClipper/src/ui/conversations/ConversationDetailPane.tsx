import { ChatMessageBubble } from '../shared/ChatMessageBubble';

import { t } from '../../i18n';
import { useConversationsApp } from './conversations-context';

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
  } = useConversationsApp();

  const baseButtonClass =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-bold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const outlineButtonClass = `${baseButtonClass} tw-border-[var(--border)] tw-bg-white/75 tw-text-[var(--text)] hover:tw-border-[var(--border-strong)]`;

  return (
    <section>
      <section className="tw-flex tw-flex-col tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label="Conversation detail">
        {!hideHeader ? (
          <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-pb-2">
            <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              {onBack ? (
                <button type="button" onClick={onBack} className={outlineButtonClass} aria-label="Back">
                  {t('backButton')}
                </button>
              ) : null}

              <div className="tw-min-w-0">
                <h2 className="tw-m-0 tw-text-[20px] tw-font-extrabold tw-leading-[1.18] tw-tracking-[-0.01em] tw-text-[var(--text)] tw-break-words [overflow-wrap:anywhere]">
                  {selected ? selected.title || t('untitled') : t('detailTitle')}
                </h2>
                <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                  {selected ? `${(selected as any).source} · ${(selected as any).conversationKey}` : t('selectConversationHint')}
                </div>
              </div>
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
                  headerLeft={String((m as any).role || 'Message')}
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
