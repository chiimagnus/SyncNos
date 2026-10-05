import type {
  CommentSaveResult,
  CommentSidebarHostActions,
  CommentSidebarHostSnapshot,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createDiscussionState, discussionReducer, type DiscussionMenuTarget } from './discussion-reducer';

type UseDiscussionPanelInput = {
  snapshot: CommentSidebarHostSnapshot;
  actions: CommentSidebarHostActions;
};

function isSuccessfulMutation(result: CommentSaveResult): boolean {
  if (result === true) return true;
  return Boolean(result && typeof result === 'object' && result.ok === true);
}

function buildContextKey(snapshot: CommentSidebarHostSnapshot): string {
  return String(snapshot.contextKey || `source:${String(snapshot.lastOpenSource || '')}`);
}

export function useDiscussionPanel({ snapshot, actions }: UseDiscussionPanelInput) {
  const contextKey = buildContextKey(snapshot);
  const [state, dispatch] = useReducer(discussionReducer, contextKey, createDiscussionState);
  const [localBusyCount, setLocalBusyCount] = useState(0);
  const mountedRef = useRef(true);
  const actionInFlightRef = useRef(false);

  useLayoutEffect(() => {
    dispatch({ type: 'context', contextKey });
  }, [contextKey]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionInFlightRef.current = false;
    };
  }, []);

  const runBusyTask = useCallback(async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    if (!mountedRef.current || actionInFlightRef.current) return undefined;
    actionInFlightRef.current = true;
    setLocalBusyCount((count) => count + 1);
    try {
      return await task();
    } finally {
      actionInFlightRef.current = false;
      if (mountedRef.current) setLocalBusyCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const submitRoot = useCallback(
    async (text: string): Promise<CommentSaveResult> => {
      if (!mountedRef.current || actionInFlightRef.current) return undefined;
      actionInFlightRef.current = true;
      setLocalBusyCount((count) => count + 1);
      dispatch({ type: 'submit-start', kind: 'root' });
      try {
        const result = await actions.save(text);
        if (mountedRef.current) {
          dispatch(
            isSuccessfulMutation(result)
              ? { type: 'submit-success', kind: 'root' }
              : { type: 'submit-error', kind: 'root', error: 'Comment was not saved.' },
          );
        }
        return result;
      } catch (error) {
        if (mountedRef.current) {
          dispatch({
            type: 'submit-error',
            kind: 'root',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      } finally {
        actionInFlightRef.current = false;
        if (mountedRef.current) setLocalBusyCount((count) => Math.max(0, count - 1));
      }
    },
    [actions],
  );

  const submitReply = useCallback(
    async (rootId: number, text: string): Promise<CommentSaveResult> => {
      if (!mountedRef.current || actionInFlightRef.current) return false;
      actionInFlightRef.current = true;
      setLocalBusyCount((count) => count + 1);
      dispatch({ type: 'submit-start', kind: 'reply', rootId });
      try {
        const result = await actions.reply(rootId, text);
        if (mountedRef.current) {
          dispatch(
            isSuccessfulMutation(result)
              ? { type: 'submit-success', kind: 'reply', rootId }
              : { type: 'submit-error', kind: 'reply', rootId, error: 'Reply was not saved.' },
          );
        }
        return result;
      } catch (error) {
        if (mountedRef.current) {
          dispatch({
            type: 'submit-error',
            kind: 'reply',
            rootId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      } finally {
        actionInFlightRef.current = false;
        if (mountedRef.current) setLocalBusyCount((count) => Math.max(0, count - 1));
      }
    },
    [actions],
  );

  const deleteComment = useCallback(
    async (id: number): Promise<void> => {
      await runBusyTask(() => Promise.resolve(actions.delete(id)));
    },
    [actions, runBusyTask],
  );

  return {
    state,
    dispatch,
    mutationBusy: localBusyCount > 0,
    runBusyTask,
    submitRoot,
    submitReply,
    deleteComment,
    setRootDraft(value: string) {
      dispatch({ type: 'set-root-draft', value });
    },
    setReplyDraft(rootId: number, value: string) {
      dispatch({ type: 'set-reply-draft', rootId, value });
    },
    setActiveRoot(rootId: number | null) {
      dispatch({ type: 'activate-root', rootId });
    },
    setOpenMenu(target: DiscussionMenuTarget) {
      dispatch({ type: 'open-menu', target });
    },
    setConfirmDelete(id: number | null) {
      dispatch({ type: 'confirm-delete', id });
    },
  };
}
