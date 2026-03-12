import { useEffect, useState } from 'react';

import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';
import { useNarrowListDetailRoute } from '../shared/hooks/useNarrowListDetailRoute';

import { t, formatConversationTitle } from '../../i18n';
import type { DetailHeaderAction } from '../../integrations/detail-header-actions';
import { ConversationDetailPane } from './ConversationDetailPane';
import { ConversationListPane } from './ConversationListPane';
import { useConversationsApp } from './conversations-context';
import { consumePendingOpenConversationId } from './pending-open';

type NarrowRoute = 'list' | 'detail';

export type PopupHeaderState =
  | { mode: 'list' }
  | {
      mode: 'detail';
      title: string;
      subtitle: string;
      actions: DetailHeaderAction[];
      onBack: () => void;
    };

export type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
  onPopupHeaderStateChange?: (state: PopupHeaderState) => void;
  inlineNarrowDetailHeader?: boolean;
  onPopupNotionSyncStarted?: () => void;
};

export function ConversationsScene({
  defaultNarrowRoute = 'list',
  onPopupHeaderStateChange,
  inlineNarrowDetailHeader = false,
  onPopupNotionSyncStarted,
}: ConversationsSceneProps) {
  const isNarrow = useIsNarrowScreen();
  const { activeId, selectedConversation, detailHeaderActions, setActiveId } = useConversationsApp();
  const [listScrollTop, setListScrollTop] = useState(0);
  const { route: narrowRoute, openDetail, returnToList, listRestoreKey } = useNarrowListDetailRoute({
    isNarrow,
    defaultRoute: defaultNarrowRoute,
  });

  useEffect(() => {
    if (!isNarrow) return;
    const id = consumePendingOpenConversationId();
    if (!id) return;
    setActiveId(id);
    openDetail();
  }, [isNarrow, openDetail, setActiveId]);

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
      actions: detailHeaderActions,
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
      onPopupNotionSyncStarted={onPopupNotionSyncStarted}
      onOpenConversation={() => {
        openDetail();
      }}
    />
  );

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
          <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-3">
            {inlineNarrowDetailHeader ? <ConversationDetailPane onBack={returnToList} /> : <ConversationDetailPane hideHeader />}
          </div>
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
        {list}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
      <aside className="tw-flex tw-min-h-0 tw-w-[min(420px,40%)] tw-min-w-[320px] tw-flex-col tw-border-r tw-border-[var(--border)] tw-bg-[var(--bg-sunken)]">
        {list}
      </aside>
      <main className="route-scroll tw-min-h-0 tw-flex-1 tw-bg-[var(--bg-primary)] tw-overflow-auto tw-overflow-x-hidden tw-p-3">
        <ConversationDetailPane />
      </main>
    </div>
  );
}
