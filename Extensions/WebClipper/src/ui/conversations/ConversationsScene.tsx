import { useEffect, useState } from 'react';

import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';

import { ConversationDetailPane } from './ConversationDetailPane';
import { ConversationListPane } from './ConversationListPane';
import { useConversationsApp } from './conversations-context';

type NarrowRoute = 'list' | 'detail';

export type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
};

export function ConversationsScene({ defaultNarrowRoute = 'list' }: ConversationsSceneProps) {
  const isNarrow = useIsNarrowScreen();
  const { activeId, selectedConversation } = useConversationsApp();
  const [narrowRoute, setNarrowRoute] = useState<NarrowRoute>(defaultNarrowRoute);

  useEffect(() => {
    if (!isNarrow) return;
    // When switching into narrow mode, keep users at the list by default.
    setNarrowRoute(defaultNarrowRoute);
  }, [defaultNarrowRoute, isNarrow]);

  const list = (
    <ConversationListPane
      onOpenConversation={() => {
        if (!isNarrow) return;
        setNarrowRoute('detail');
      }}
    />
  );

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">
          <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--panel)]/60 tw-px-3 tw-py-2 tw-backdrop-blur-sm">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <button
                type="button"
                className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)]"
                onClick={() => setNarrowRoute('list')}
                aria-label="Back"
              >
                Back
              </button>

              <div className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-center tw-text-xs tw-font-extrabold tw-text-[var(--muted)]">
                {activeId ? String(selectedConversation?.title || '').trim() || '(Untitled)' : 'Chats'}
              </div>

              <div className="tw-w-[74px]" aria-hidden="true" />
            </div>
          </div>

          <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-3">
            <ConversationDetailPane />
          </div>
        </div>
      );
    }

    return <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">{list}</div>;
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/70">
      <aside className="tw-flex tw-min-h-0 tw-w-[min(420px,40%)] tw-min-w-[320px] tw-flex-col tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/55">
        {list}
      </aside>
      <main className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-3">
        <ConversationDetailPane />
      </main>
    </div>
  );
}
