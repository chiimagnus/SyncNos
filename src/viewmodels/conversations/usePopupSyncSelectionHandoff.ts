import { useCallback, useEffect, useRef } from 'react';

import {
  readPopupSyncSelectionHandoff,
  subscribePopupSyncSelectionHandoff,
} from '@services/conversations/popup-sync-selection-handoff';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';

export function usePopupSyncSelectionHandoff() {
  const { loadingInitialList, replaceSelectedIds } = useConversationsApp();
  const initialLoadStartedRef = useRef(false);
  const initialLoadSettledRef = useRef(false);
  const pendingRef = useRef<number[] | null>(null);

  const receive = useCallback(
    (conversationIds: number[]) => {
      if (!initialLoadSettledRef.current) {
        pendingRef.current = conversationIds;
        return;
      }
      replaceSelectedIds(conversationIds);
    },
    [replaceSelectedIds],
  );

  useEffect(() => {
    let storageChangeSeen = false;
    const unsubscribe = subscribePopupSyncSelectionHandoff((conversationIds) => {
      storageChangeSeen = true;
      receive(conversationIds);
    });

    void readPopupSyncSelectionHandoff()
      .then((conversationIds) => {
        if (conversationIds && !storageChangeSeen) receive(conversationIds);
      })
      .catch(() => {});

    return unsubscribe;
  }, [receive]);

  useEffect(() => {
    if (loadingInitialList) {
      initialLoadStartedRef.current = true;
      return;
    }
    if (!initialLoadStartedRef.current || initialLoadSettledRef.current) return;

    initialLoadSettledRef.current = true;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) replaceSelectedIds(pending);
  }, [loadingInitialList, replaceSelectedIds]);
}
