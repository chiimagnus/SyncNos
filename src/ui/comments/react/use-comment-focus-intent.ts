import type { DiscussionAction, DiscussionFocusIntent } from '@viewmodels/comments/discussion-reducer';
import { useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type RefCallback } from 'react';
import { resolvePendingFocusTarget } from './focus-rules';

type MenuTarget = number;

type UseCommentFocusIntentInput = {
  open: boolean;
  busy: boolean;
  focusComposerSignal: number;
  quoteText: string;
  focusIntent: DiscussionFocusIntent;
  dispatch: Dispatch<DiscussionAction>;
  composerRef: MutableRefObject<HTMLTextAreaElement | null>;
  replyRefs: MutableRefObject<Record<number, HTMLTextAreaElement | null>>;
  pendingFocusRootId: number | null;
  rootIds: ReadonlySet<number>;
  focusScopeKey: unknown;
  setPendingFocusRootId?: (rootId: number | null) => void;
};

function focusNode(node: HTMLTextAreaElement | HTMLButtonElement | null | undefined): boolean {
  if (!node) return false;
  try {
    node.focus();
    if (node instanceof HTMLTextAreaElement) {
      const value = String(node.value || '');
      node.setSelectionRange(value.length, value.length);
    }
    return true;
  } catch (_error) {
    return false;
  }
}

export function useCommentFocusIntent(input: UseCommentFocusIntentInput) {
  const {
    open,
    busy,
    focusComposerSignal,
    quoteText,
    focusIntent,
    dispatch,
    composerRef,
    replyRefs,
    pendingFocusRootId,
    rootIds,
    focusScopeKey,
    setPendingFocusRootId,
  } = input;
  const lastComposerSignalRef = useRef(0);
  const lastQuoteRef = useRef('');
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useLayoutEffect(() => {
    const signal = Number(focusComposerSignal || 0);
    if (!open || busy || !Number.isFinite(signal) || signal <= lastComposerSignalRef.current) return;
    if (focusNode(composerRef.current)) lastComposerSignalRef.current = signal;
  }, [busy, composerRef, focusComposerSignal, open]);

  useLayoutEffect(() => {
    if (!open) {
      lastQuoteRef.current = '';
      return;
    }
    const quote = String(quoteText || '').trim();
    if (!quote) {
      lastQuoteRef.current = '';
      return;
    }
    if (busy || quote === lastQuoteRef.current) return;
    if (focusNode(composerRef.current)) lastQuoteRef.current = quote;
  }, [busy, composerRef, open, quoteText]);

  useLayoutEffect(() => {
    if (!open || busy || !focusIntent) return;
    const intent = focusIntent;
    let focused = false;
    if (intent.kind === 'root') focused = focusNode(composerRef.current);
    if (intent.kind === 'reply') focused = focusNode(replyRefs.current[intent.rootId]);
    if (intent.kind === 'menu') focused = focusNode(menuTriggerRefs.current[String(intent.target)]);
    if (focused) dispatch({ type: 'consume-focus', epoch: intent.epoch });
  }, [busy, composerRef, dispatch, focusIntent, focusScopeKey, open, replyRefs]);

  useLayoutEffect(() => {
    if (!open || busy) return;
    const rootId = resolvePendingFocusTarget({
      pendingFocusRootId: pendingFocusRootId,
      fallbackPendingFocusRootId: null,
      hasFocusWithinPanel: true,
      existingRootIds: rootIds,
    });
    if (rootId == null) return;
    if (!focusNode(replyRefs.current[rootId])) return;
    setPendingFocusRootId?.(null);
  }, [busy, focusScopeKey, open, pendingFocusRootId, replyRefs, rootIds, setPendingFocusRootId]);

  const registerMenuTrigger = (target: MenuTarget): RefCallback<HTMLButtonElement> => {
    const key = String(target);
    return (node) => {
      menuTriggerRefs.current[key] = node;
    };
  };

  return { registerMenuTrigger };
}
