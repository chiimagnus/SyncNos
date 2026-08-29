import { ChatMessageBubble } from '@ui/shared/ChatMessageBubble';
import { t } from '@i18n';
import { useSyncnosAssetSrcMap } from '@viewmodels/conversations/useSyncnosAssetSrcMap';
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
  selected,
  activeId,
  detail,
  listError,
  loadingDetail,
  detailError,
  outlineIndexByMessageId,
  getUserMessageRefSetter,
  setMessagesRootRef,
}: ChatDetailViewProps) {
  const detailConversationId = Number((detail as any)?.conversationId || (selected as any)?.id || activeId);
  const assetSrcById = useSyncnosAssetSrcMap({
    conversationId: Number.isFinite(detailConversationId) && detailConversationId > 0 ? detailConversationId : null,
    markdowns: Array.isArray(detail?.messages)
      ? detail.messages.map((message: any) => String(message?.contentMarkdown || message?.contentText || ''))
      : [],
  });

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
                    <ChatMessageBubble
                      role={(m as any).role}
                      markdown={text}
                      syncnosAssetSrcById={assetSrcById}
                    />
                  </div>
                );
              }

              return (
                <ChatMessageBubble
                  key={String((m as any).id)}
                  role={(m as any).role}
                  markdown={text}
                  syncnosAssetSrcById={assetSrcById}
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
