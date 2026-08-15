import { ChatMessageBubble } from '@ui/shared/ChatMessageBubble';
import { t } from '@i18n';
import type { DetailViewSharedProps } from '@ui/conversations/views/detail-view-props';

export type ChatDetailViewProps = DetailViewSharedProps & {
  listError?: string | null;
  outlineIndexByMessageId: Map<number, number>;
  getUserMessageRefSetter: (messageId: number) => (node: HTMLDivElement | null) => void;
};

/**
 * ChatDetailView renders the chat-detail message list.
 * The prop bag is still the legacy one for now; renderer-specific prop cleanup
 * happens in the next task after the chat/article split is isolated.
 */
export function ChatDetailView({
  activeId,
  detail,
  imageAssetResolver,
  listError,
  loadingDetail,
  detailError,
  outlineIndexByMessageId,
  getUserMessageRefSetter,
  setMessagesRootRef,
}: ChatDetailViewProps) {
  return (
    <div className="tw-flex tw-min-w-0 tw-gap-4">
      <div className="tw-min-w-0 tw-flex-1">
        {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{listError}</p> : null}
        {loadingDetail ? (
          <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('loadingDots')}</p>
        ) : null}
        {detailError ? (
          <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--error)]">{detailError}</p>
        ) : null}

        {detail?.messages?.length ? (
          <div ref={setMessagesRootRef} className="tw-mt-3 tw-grid tw-gap-2.5">
            {detail.messages.map((m: any) => {
              const role = String((m as any).role || '')
                .trim()
                .toLowerCase();
              const rawMessageId = Number((m as any).id);
              const messageId = Number.isFinite(rawMessageId) ? Math.trunc(rawMessageId) : null;
              const outlineIndex = messageId == null ? null : outlineIndexByMessageId.get(messageId) || null;
              const text = String((m as any).contentMarkdown || (m as any).contentText || '');

              if (role === 'user' && messageId != null) {
                return (
                  <div
                    key={String((m as any).id)}
                    className="tw-min-w-0"
                    data-chat-outline-index={outlineIndex ?? undefined}
                    data-chat-outline-message-id={messageId}
                    ref={getUserMessageRefSetter(messageId)}
                  >
                    <ChatMessageBubble role={(m as any).role} markdown={text} imageAssetResolver={imageAssetResolver} />
                  </div>
                );
              }

              return (
                <ChatMessageBubble
                  key={String((m as any).id)}
                  role={(m as any).role}
                  markdown={text}
                  imageAssetResolver={imageAssetResolver}
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
  );
}
