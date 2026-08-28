import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type CommentOptionalAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onTrigger?: () => void | string | Promise<void | string>;
};

export type CommentPanelOptionalActionConfig = {
  resolveActions: () => Promise<CommentOptionalAction[]>;
  resolveSingleActionLabel?: () => Promise<string | null>;
};

export type CommentThreadOptionalActionContext = {
  conversationId?: number | null;
  articleTitle?: string | null;
  canonicalUrl?: string | null;
};

export type CommentThreadOptionalActionConfig = {
  resolveActions: (
    rootComment: CommentSidebarItem,
    context: CommentThreadOptionalActionContext,
    replies?: CommentSidebarItem[] | null,
  ) => Promise<CommentOptionalAction[]>;
  resolveContext?: () => CommentThreadOptionalActionContext | Promise<CommentThreadOptionalActionContext>;
};

type TargetKey = 'panel' | number;

type Input = {
  panelConfig?: CommentPanelOptionalActionConfig | null;
  commentConfig?: CommentThreadOptionalActionConfig | null;
  showNotice?: (message: string) => void;
};

function normalizeActions(input: unknown): CommentOptionalAction[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((candidate: any) => {
    const id = String(candidate?.id || '').trim();
    const label = String(candidate?.label || '').trim();
    if (!id || !label || typeof candidate?.onTrigger !== 'function') return [];
    return [{ id, label, disabled: Boolean(candidate.disabled), onTrigger: candidate.onTrigger }];
  });
}

export function useCommentOptionalActions({ panelConfig, commentConfig, showNotice }: Input) {
  const [panelLabel, setPanelLabel] = useState('Chat with...');
  const [actionsByTarget, setActionsByTarget] = useState<Record<string, CommentOptionalAction[]>>({});
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    if (!panelConfig?.resolveSingleActionLabel) return;
    const generation = ++generationRef.current;
    void Promise.resolve(panelConfig.resolveSingleActionLabel())
      .then((label) => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        const normalized = String(label || '').trim();
        if (normalized) setPanelLabel(normalized);
      })
      .catch(() => {});
  }, [panelConfig]);

  const setTargetActions = useCallback((target: TargetKey, actions: CommentOptionalAction[]) => {
    if (!mountedRef.current) return;
    setActionsByTarget((current) => ({ ...current, [String(target)]: actions }));
  }, []);

  const preparePanel = useCallback(async () => {
    if (!panelConfig) return [];
    const generation = ++generationRef.current;
    try {
      const actions = normalizeActions(await panelConfig.resolveActions());
      if (!mountedRef.current || generation !== generationRef.current) return [];
      setTargetActions('panel', actions);
      if (!actions.length) showNotice?.('No AI platforms enabled');
      return actions;
    } catch (error) {
      if (mountedRef.current && generation === generationRef.current) {
        showNotice?.(error instanceof Error ? error.message : String(error || 'Action failed.'));
      }
      return [];
    }
  }, [panelConfig, setTargetActions, showNotice]);

  const prepareComment = useCallback(
    async (root: CommentSidebarItem, replies: readonly CommentSidebarItem[]) => {
      if (!commentConfig) return [];
      const generation = ++generationRef.current;
      try {
        const context = commentConfig.resolveContext ? await commentConfig.resolveContext() : {};
        const actions = normalizeActions(await commentConfig.resolveActions(root, context || {}, [...replies]));
        if (!mountedRef.current || generation !== generationRef.current) return [];
        setTargetActions(Number(root.id), actions);
        if (!actions.length) showNotice?.('No AI platforms enabled');
        return actions;
      } catch (error) {
        if (mountedRef.current && generation === generationRef.current) {
          showNotice?.(error instanceof Error ? error.message : String(error || 'Action failed.'));
        }
        return [];
      }
    },
    [commentConfig, setTargetActions, showNotice],
  );

  const trigger = useCallback(
    async (action: CommentOptionalAction) => {
      if (!action || action.disabled || typeof action.onTrigger !== 'function') return;
      const generation = ++generationRef.current;
      try {
        const message = await action.onTrigger();
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (message) showNotice?.(String(message));
      } catch (error) {
        if (mountedRef.current && generation === generationRef.current) {
          showNotice?.(error instanceof Error ? error.message : String(error || 'Action failed.'));
        }
      }
    },
    [showNotice],
  );

  return {
    panelLabel,
    getActions(target: TargetKey) {
      return actionsByTarget[String(target)] || [];
    },
    preparePanel,
    prepareComment,
    trigger,
  };
}
