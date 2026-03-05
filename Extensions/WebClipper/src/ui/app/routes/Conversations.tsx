import { useConversationsApp } from '../conversations/conversations-context';
import { ChatMessageBubble } from '../../shared/ChatMessageBubble';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function Conversations() {
  const {
    activeId,
    selectedIds,
    loadingList,
    listError,
    selectedConversation: selected,
    loadingDetail,
    detailError,
    detail,
    refreshList,
    refreshActiveDetail,
  } = useConversationsApp();

  const baseButtonClass =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-bold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const primaryButtonClass = `${baseButtonClass} tw-border-[var(--text)] tw-bg-[var(--text)] tw-text-white hover:tw-bg-[#c94f20]`;

  return (
    <section>
      <section className="tw-flex tw-flex-col tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label="Conversation detail">
        <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-pb-2">
          <div className="tw-min-w-0">
            <h2 className="tw-m-0 tw-max-w-[85%] tw-truncate tw-text-[20px] tw-font-extrabold tw-tracking-[-0.01em] tw-text-[var(--text)]">
              {selected ? selected.title || '(Untitled)' : 'Detail'}
            </h2>
            <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
              {selected ? `${selected.source} · ${selected.conversationKey}` : 'Select one conversation from sidebar'}
            </div>
          </div>

          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
            <button
              onClick={() => refreshList().catch(() => {})}
              disabled={loadingList}
              type="button"
              className={primaryButtonClass}
            >
              {loadingList ? 'Loading…' : 'Refresh List'}
            </button>
            <button
              onClick={() => refreshActiveDetail().catch(() => {})}
              disabled={!activeId || loadingDetail}
              type="button"
              className={primaryButtonClass}
            >
              {loadingDetail ? 'Loading…' : 'Reload Detail'}
            </button>
          </div>
        </header>

        {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{listError}</p> : null}
        {loadingDetail ? <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Loading…</p> : null}
        {detailError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{detailError}</p> : null}

        {detail?.messages?.length ? (
          <div className="tw-mt-3 tw-grid tw-gap-2.5">
            {detail.messages.map((m) => {
              const text = String(m.contentMarkdown || m.contentText || '');
              return (
                <ChatMessageBubble
                  key={String(m.id)}
                  role={m.role}
                  headerLeft={String(m.role || 'Message')}
                  headerRight={formatTime(m.updatedAt)}
                  markdown={text}
                />
              );
            })}
          </div>
        ) : activeId ? (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">No messages.</p>
        ) : (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Select a conversation.</p>
        )}
      </section>
    </section>
  );
}
