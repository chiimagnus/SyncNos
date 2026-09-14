import { extractSelectionText, extractUserSelectionText } from '@services/shared/dom/selection';
import { useCallback, useLayoutEffect, useRef } from 'react';

type SelectionAttachmentInput = {
  open: boolean;
  panelRootRef: React.RefObject<HTMLElement | null>;
  requestSelection: () => void;
};

function buildNodePathSignature(node: Node | null | undefined): string {
  if (!node) return '';
  const parts: string[] = [];
  let cursor: Node | null = node;
  for (let depth = 0; cursor && depth < 12; depth += 1) {
    const parentNode: Node | null = cursor.parentNode;
    const index = parentNode ? Array.prototype.indexOf.call(parentNode.childNodes, cursor) : -1;
    parts.push(`${cursor.nodeType}:${index}`);
    cursor = parentNode;
  }
  return parts.reverse().join('/');
}

function selectionTouchesPanel(selection: Selection, panelRoot: HTMLElement | null): boolean {
  if (!panelRoot) return false;
  const nodes = [selection.anchorNode, selection.focusNode];
  return nodes.some((node) => {
    if (!node) return false;
    try {
      return panelRoot === node || panelRoot.contains(node);
    } catch (_error) {
      return false;
    }
  });
}

function buildSelectionSignature(selection: Selection | null | undefined, panelRoot: HTMLElement | null): string {
  if (!selection || Number(selection.rangeCount || 0) <= 0) return 'empty';
  if (selectionTouchesPanel(selection, panelRoot)) return 'empty';
  const direct = extractSelectionText(selection, { trim: true, maxLen: 200 });
  const text = direct.text || extractUserSelectionText({ trim: true, maxLen: 200 }).text;
  if (!text) return 'empty';
  return `${text}#${buildNodePathSignature(selection.anchorNode)}:${Number(selection.anchorOffset || 0)}|${buildNodePathSignature(selection.focusNode)}:${Number(selection.focusOffset || 0)}`;
}

export function useCommentSelectionAttachment({ open, panelRootRef, requestSelection }: SelectionAttachmentInput) {
  const requestSelectionRef = useRef(requestSelection);
  requestSelectionRef.current = requestSelection;
  const lastSignatureRef = useRef('');
  const dirtyRef = useRef(false);
  const commitFrameRef = useRef<number | null>(null);

  const cancelCommit = useCallback(() => {
    const id = commitFrameRef.current;
    if (id == null) return;
    commitFrameRef.current = null;
    if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
    else clearTimeout(id);
  }, []);

  const resetDedupe = useCallback(() => {
    lastSignatureRef.current = '';
    dirtyRef.current = false;
    cancelCommit();
  }, [cancelCommit]);

  const commit = useCallback(() => {
    cancelCommit();
    const schedule =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
    commitFrameRef.current = schedule(() => {
      commitFrameRef.current = null;
      let signature = 'empty';
      try {
        signature = buildSelectionSignature(globalThis.getSelection?.(), panelRootRef.current);
      } catch (_error) {
        signature = 'empty';
      }
      if (signature === 'empty' || signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;
      try {
        requestSelectionRef.current();
      } catch (_error) {
        // Selection attachment is best-effort UI state; the controller owns selection validation.
      }
    });
  }, [cancelCommit, panelRootRef]);

  useLayoutEffect(() => {
    if (!open) {
      resetDedupe();
      return;
    }
    const onSelectionChange = () => {
      dirtyRef.current = true;
    };
    const onPointerCommit = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      commit();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      commit();
    };
    document.addEventListener('selectionchange', onSelectionChange, true);
    document.addEventListener('pointerup', onPointerCommit, true);
    document.addEventListener('mouseup', onPointerCommit, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange, true);
      document.removeEventListener('pointerup', onPointerCommit, true);
      document.removeEventListener('mouseup', onPointerCommit, true);
      document.removeEventListener('keyup', onKeyUp, true);
      dirtyRef.current = false;
      cancelCommit();
    };
  }, [cancelCommit, commit, open, resetDedupe]);

  return { resetDedupe };
}
