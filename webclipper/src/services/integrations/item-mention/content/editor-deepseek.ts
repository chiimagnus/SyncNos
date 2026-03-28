import type {
  ContentEditableEditor,
  EditorAdapter,
  EditorHandle,
  EditorRange,
  TextareaEditor,
} from '@services/integrations/item-mention/content/editor-adapter';
import { clampRange, replaceTextRange } from '@services/integrations/item-mention/content/editor-adapter';

function isElement(node: unknown): node is Element {
  return !!node && typeof (node as any).tagName === 'string';
}

function isVisible(el: Element | null): boolean {
  const anyEl = el as any;
  if (!anyEl || typeof anyEl.getBoundingClientRect !== 'function') return false;
  const rect = anyEl.getBoundingClientRect();
  return rect.width >= 6 && rect.height >= 6;
}

function isContentEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const anyEl = el as any;
  if (anyEl.isContentEditable === true) return true;
  const attr = String((el as any).getAttribute?.('contenteditable') || '')
    .trim()
    .toLowerCase();
  return attr === 'true';
}

function isTextarea(el: Element | null): el is HTMLTextAreaElement {
  return !!el && String((el as any).tagName || '').toLowerCase() === 'textarea';
}

function toTextareaEditor(handle: EditorHandle): TextareaEditor {
  const el = (handle as any)?.el as Element | null;
  if (!handle || (handle as any).kind !== 'textarea' || !isTextarea(el)) {
    throw new Error('invalid textarea editor');
  }
  return handle as TextareaEditor;
}

function toContentEditableEditor(handle: EditorHandle): ContentEditableEditor {
  const el = (handle as any)?.el as Element | null;
  if (!handle || (handle as any).kind !== 'contenteditable' || !isContentEditable(el)) {
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
  const start = String(startRange.cloneContents()?.textContent || '').length;

  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  const end = String(endRange.cloneContents()?.textContent || '').length;

  return { start, end };
}

type DomPoint = { node: Node; offset: number };

function resolveTextOffsetToDomPoint(root: HTMLElement, textOffset: number): DomPoint {
  const normalized = Math.max(0, Math.floor(Number(textOffset) || 0));
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let remaining = normalized;
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    lastText = node;
    const len = node.data.length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }

  if (!lastText) return { node: root, offset: normalized <= 0 ? 0 : root.childNodes.length };
  return { node: lastText, offset: lastText.data.length };
}

function setSelectionByOffsets(root: HTMLElement, start: number, end: number): boolean {
  const sel = globalThis.getSelection?.();
  if (!sel) return false;
  const range = document.createRange();
  const a = resolveTextOffsetToDomPoint(root, start);
  const b = resolveTextOffsetToDomPoint(root, end);
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch (_e) {
    try {
      range.selectNodeContents(root);
      range.collapse(false);
    } catch (_e2) {
      return false;
    }
  }
  try {
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch (_e) {
    return false;
  }
}

function insertTextCompat(text: string): boolean {
  try {
    const cmd = (document as any).execCommand as any;
    if (typeof cmd === 'function') {
      return !!cmd.call(document, 'insertText', false, String(text || ''));
    }
  } catch (_e) {
    // ignore
  }
  return false;
}

function dispatchBubbledInput(el: Element) {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (_e) {
    // ignore
  }
}

function findDeepseekEditor(): EditorHandle | null {
  const doc = document;
  if (!doc) return null;

  const active = doc.activeElement as Element | null;
  const activeEl = isElement(active) ? active : null;
  if (activeEl) {
    if (isTextarea(activeEl) && isVisible(activeEl)) return { kind: 'textarea', el: activeEl as HTMLTextAreaElement };
    if (isContentEditable(activeEl) && isVisible(activeEl))
      return { kind: 'contenteditable', el: activeEl as HTMLElement };
  }

  const textarea = doc.querySelector?.('textarea') as Element | null;
  if (textarea && isTextarea(textarea) && isVisible(textarea))
    return { kind: 'textarea', el: textarea as HTMLTextAreaElement };

  const ce = doc.querySelector?.(
    '[role="textbox"][contenteditable="true"], [contenteditable="true"][role="textbox"]',
  ) as Element | null;
  if (ce && isContentEditable(ce) && isVisible(ce)) return { kind: 'contenteditable', el: ce as HTMLElement };

  return null;
}

export const deepseekEditorAdapter: EditorAdapter = {
  detectActiveEditor() {
    return findDeepseekEditor();
  },
  getSelectionRange(editor: EditorHandle): EditorRange {
    if (editor.kind === 'textarea') {
      const el = toTextareaEditor(editor).el;
      const text = String(el.value || '');
      const start = Number(el.selectionStart);
      const end = Number(el.selectionEnd);
      return clampRange(text, {
        start: Number.isFinite(start) ? start : text.length,
        end: Number.isFinite(end) ? end : text.length,
      });
    }

    const el = toContentEditableEditor(editor).el;
    const text = String(el.textContent || '');
    const offsets = getSelectionOffsetsWithin(el);
    return clampRange(text, offsets);
  },
  replaceRange(editor: EditorHandle, range: EditorRange, text: string): EditorRange {
    if (editor.kind === 'textarea') {
      const el = toTextareaEditor(editor).el;
      const current = String(el.value || '');
      const normalized = clampRange(current, range);
      const { text: next, rangeAfter } = replaceTextRange({
        text: current,
        range: normalized,
        replacement: String(text || ''),
      });
      el.value = next;
      try {
        el.selectionStart = rangeAfter.start;
        el.selectionEnd = rangeAfter.end;
      } catch (_e) {
        // ignore
      }
      dispatchBubbledInput(el);
      return rangeAfter;
    }

    const el = toContentEditableEditor(editor).el;
    const current = String(el.textContent || '');
    const normalized = clampRange(current, range);
    const replacement = String(text || '');

    setSelectionByOffsets(el, normalized.start, normalized.end);
    const ok = insertTextCompat(replacement);

    if (!ok) {
      try {
        const sel = globalThis.getSelection?.();
        if (sel && sel.rangeCount > 0) {
          const domRange = sel.getRangeAt(0);
          domRange.deleteContents();
          domRange.insertNode(document.createTextNode(replacement));
          domRange.collapse(false);
          sel.removeAllRanges();
          sel.addRange(domRange);
        } else {
          el.textContent = `${String(el.textContent || '')}${replacement}`;
        }
      } catch (_e) {
        // ignore
      }
    }

    const rangeAfter = { start: normalized.start + replacement.length, end: normalized.start + replacement.length };
    setSelectionByOffsets(el, rangeAfter.start, rangeAfter.end);
    dispatchBubbledInput(el);
    return rangeAfter;
  },
  focus(editor: EditorHandle) {
    try {
      (editor.el as any).focus?.();
    } catch (_e) {
      // ignore
    }
  },
};
