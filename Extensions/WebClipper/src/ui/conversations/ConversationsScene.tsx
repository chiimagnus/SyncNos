import { useEffect, useState } from 'react';

import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';
import { useNarrowListDetailRoute } from '../shared/hooks/useNarrowListDetailRoute';

import { t, formatConversationTitle } from '../../i18n';
import { ConversationDetailPane } from './ConversationDetailPane';
import { ConversationListPane } from './ConversationListPane';
import { useConversationsApp } from './conversations-context';

type NarrowRoute = 'list' | 'detail';

export type PopupHeaderState =
  | { mode: 'list' }
  | {
      mode: 'detail';
      title: string;
      subtitle: string;
      onBack: () => void;
    };

export type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
  onPopupHeaderStateChange?: (state: PopupHeaderState) => void;
};

export function ConversationsScene({ defaultNarrowRoute = 'list', onPopupHeaderStateChange }: ConversationsSceneProps) {
  const isNarrow = useIsNarrowScreen();
  const { activeId, selectedConversation, detailHeaderActions } = useConversationsApp();
  const [listScrollTop, setListScrollTop] = useState(0);
  const { route: narrowRoute, openDetail, returnToList, listRestoreKey } = useNarrowListDetailRoute({
    isNarrow,
    defaultRoute: defaultNarrowRoute,
  });

  useEffect(() => {
    if (!onPopupHeaderStateChange) return;

    if (!isNarrow || narrowRoute !== 'detail') {
      onPopupHeaderStateChange({ mode: 'list' });
      return;
    }

    const title = activeId ? formatConversationTitle(selectedConversation?.title) : t('chatsTitle');
    const subtitle = activeId && selectedConversation
      ? `${String((selectedConversation as any).source || '').trim()} · ${String((selectedConversation as any).conversationKey || '').trim()}`.trim()
      : '';

    onPopupHeaderStateChange({
      mode: 'detail',
      title,
      subtitle,
      onBack: returnToList,
    });

    return () => {
      onPopupHeaderStateChange({ mode: 'list' });
    };
  }, [activeId, detailHeaderActions, isNarrow, narrowRoute, onPopupHeaderStateChange, returnToList, selectedConversation]);

  const list = (
    <ConversationListPane
      initialScrollTop={listScrollTop}
      scrollRestoreKey={listRestoreKey}
      onListScrollTopChange={setListScrollTop}
      onOpenConversation={() => {
        openDetail();
      }}
    />
  );

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">
          <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-3">
            <ConversationDetailPane hideHeader />
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
