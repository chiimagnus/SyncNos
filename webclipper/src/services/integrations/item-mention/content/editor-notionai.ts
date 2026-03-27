import type { ContentEditableEditor, EditorAdapter, EditorHandle, EditorRange } from '@services/integrations/item-mention/content/editor-adapter';
import { clampRange, replaceTextRange } from '@services/integrations/item-mention/content/editor-adapter';

function isNotionHost(hostname: string): boolean {
  return /(^|\.)notion\.so$/.test(String(hostname || '').toLowerCase());
}

function isVisible(el: Element | null): boolean {
  const anyEl = el as any;
  if (!anyEl || typeof anyEl.getBoundingClientRect !== 'function') return false;
  const rect = anyEl.getBoundingClientRect();
  return rect.width >= 6 && rect.height >= 6;
}

function pickComposerLeaf(): HTMLElement | null {
  if (!isNotionHost(location?.hostname || '')) return null;
  const list = Array.from(
    document.querySelectorAll('div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]'),
  ) as HTMLElement[];
  for (const el of list) {
    if (!el) continue;
    if (!isVisible(el)) continue;
    return el;
  }
  return null;
}

function toContentEditableEditor(handle: EditorHandle): ContentEditableEditor {
  const el = (handle as any)?.el as HTMLElement | null;
  const isEditable =
    !!el &&
    (((el as any).isContentEditable === true) ||
      String(el.getAttribute?.('contenteditable') || '').trim().toLowerCase() === 'true');
  if (!handle || (handle as any).kind !== 'contenteditable' || !isEditable) {
    throw new Error('invalid contenteditable editor');
  }
  return handle as ContentEditableEditor;
}

function getSelectionOffsetsWithin(root: HTMLElement): EditorRange {
  const sel = globalThis.getSelection?.();
  if (!sel || sel.rangeCount <= 0) {
    const text = String(root.textContent || '');
    return { start: text.length, end: text.length };
  }
  const range = sel.getRangeAt(0);
  const within = root.contains(range.commonAncestorContainer);
  if (!within) {
    const text = String(root.textContent || '');
    return { start: text.length, end: text.length };
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const start = startRange.toString().length;

  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  const end = endRange.toString().length;

  return { start, end };
}

function setCaretOffset(root: HTMLElement, offset: number) {
  const sel = globalThis.getSelection?.();
  if (!sel) return false;
  const range = document.createRange();
  const textNode = root.firstChild;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.max(0, Math.min(offset, (textNode.textContent || '').length)));
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export const notionAiContentEditableAdapter: EditorAdapter = {
  detectActiveEditor() {
    const el = pickComposerLeaf();
    if (!el) return null;
    return { kind: 'contenteditable', el };
  },
  getSelectionRange(editor: EditorHandle): EditorRange {
    const el = toContentEditableEditor(editor).el;
    const text = String(el.textContent || '');
    const offsets = getSelectionOffsetsWithin(el);
    return clampRange(text, offsets);
  },
  replaceRange(editor: EditorHandle, range: EditorRange, text: string): EditorRange {
    const el = toContentEditableEditor(editor).el;
    const current = String(el.textContent || '');
    const normalized = clampRange(current, range);
    const { text: next, rangeAfter } = replaceTextRange({ text: current, range: normalized, replacement: text });

    el.textContent = next;
    try {
      setCaretOffset(el, rangeAfter.end);
    } catch (_e) {
      // ignore
    }
    return rangeAfter;
  },
  focus(editor: EditorHandle) {
    const el = toContentEditableEditor(editor).el;
    try {
      (el as any).focus?.();
    } catch (_e) {
      // ignore
    }
  },
};
