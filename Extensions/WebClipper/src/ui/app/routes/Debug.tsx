import { send } from '../../../platform/runtime/runtime';
import { CORE_MESSAGE_TYPES } from '../../../platform/messaging/message-contracts';

export default function Debug() {
  const seedConversation = async () => {
    try {
      const now = Date.now();
      const key = `debug_${now}`;
      const upsertRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
        payload: {
          sourceType: 'chat',
          source: 'debug',
          conversationKey: key,
          title: `Debug Conversation ${new Date(now).toLocaleString()}`,
          url: '',
          lastCapturedAt: now,
        },
      });

      const conversationId = Number((upsertRes as any)?.data?.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        alert(`Upsert did not return a valid id: ${JSON.stringify(upsertRes)}`);
        return;
      }

      const messages = [
        {
          messageKey: `${key}_m1`,
          role: 'user',
          contentText: 'Hello from Debug seed.',
          contentMarkdown: 'Hello from **Debug seed**.',
          sequence: 1,
          updatedAt: now,
        },
        {
          messageKey: `${key}_m2`,
          role: 'assistant',
          contentText: 'Seeded successfully.',
          contentMarkdown: 'Seeded successfully.',
          sequence: 2,
          updatedAt: now,
        },
      ];

      const syncRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
        conversationId,
        messages,
      });

      alert(`Seeded conversation#${conversationId}\n${JSON.stringify(syncRes)}`);
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <section className="tw-grid tw-max-w-[860px] tw-gap-4">
      <header className="tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/85 tw-p-4">
        <h1 className="tw-m-0 tw-text-[26px] tw-font-black tw-leading-none tw-tracking-[-0.01em] tw-text-[var(--text)]">Debug</h1>
        <p className="tw-m-0 tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
          Temporary tools for migration verification.
        </p>
      </header>

      <article className="tw-grid tw-gap-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-4">
        <p className="tw-m-0 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">
          Seed one test conversation and two messages into local storage.
        </p>
        <div>
          <button
            onClick={seedConversation}
            type="button"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-bold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]"
          >
            Seed sample conversation
          </button>
        </div>
      </article>
    </section>
  );
}
