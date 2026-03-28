import type {
  ContentEditableEditor,
  EditorAdapter,
  EditorHandle,
  EditorRange,
} from '@services/integrations/item-mention/content/editor-adapter';
import { clampRange } from '@services/integrations/item-mention/content/editor-adapter';

function isElement(node: unknown): node is Element {
  // Avoid referencing DOM globals (`Node`) at module scope; unit tests may not polyfill them.
  return !!node && typeof (node as any).tagName === 'string';
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

function isVisible(el: Element | null): boolean {
  const anyEl = el as any;
  if (!anyEl || typeof anyEl.getBoundingClientRect !== 'function') return false;
  const rect = anyEl.getBoundingClientRect();
  return rect.width >= 6 && rect.height >= 6;
}

function findGeminiComposer(): HTMLElement | null {
  const doc = document;
  if (!doc) return null;

  const active = doc.activeElement as Element | null;
  const activeEl = isElement(active) ? active : null;
  if (activeEl) {
    const maybe = isContentEditable(activeEl)
      ? activeEl
      : (activeEl as any).closest?.('[role="textbox"][contenteditable="true"], [contenteditable="true"][role="textbox"]');
    if (isElement(maybe) && isContentEditable(maybe) && isVisible(maybe)) return maybe as HTMLElement;
  }

  const primary = doc.querySelector?.(
    '[role="textbox"][contenteditable="true"], [contenteditable="true"][role="textbox"]',
  ) as Element | null;
  if (primary && isContentEditable(primary) && isVisible(primary)) return primary as HTMLElement;

  const list = Array.from(doc.querySelectorAll?.('[contenteditable="true"]') || []) as Element[];
  for (const el of list) {
    if (isContentEditable(el) && isVisible(el)) return el as HTMLElement;
  }

  return null;
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
  // `NodeFilter.SHOW_TEXT` is not always present in unit-test environments, so use the numeric value.
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

function dispatchBubbledInput(el: HTMLElement) {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (_e) {
    // ignore
  }
}

export const geminiContentEditableAdapter: EditorAdapter = {
  detectActiveEditor() {
    const el = findGeminiComposer();
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
    const el = toContentEditableEditor(editor).el;
    try {
      (el as any).focus?.();
    } catch (_e) {
      // ignore
    }
  },
};

