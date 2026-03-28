import type {
  EditorAdapter,
  EditorHandle,
  EditorRange,
  TextareaEditor,
} from '@services/integrations/item-mention/content/editor-adapter';
import { clampRange, replaceTextRange } from '@services/integrations/item-mention/content/editor-adapter';

function isTextarea(node: unknown): node is HTMLTextAreaElement {
  return (
    !!node && typeof (node as any).tagName === 'string' && String((node as any).tagName).toLowerCase() === 'textarea'
  );
}

function setTextareaValueCompat(el: HTMLTextAreaElement, value: string) {
  // React-controlled textareas often ignore direct assignment unless the native setter + input event fires.
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (desc?.set) {
      desc.set.call(el, value);
      return;
    }
  } catch (_e) {
    // ignore
  }
  el.value = value;
}

function dispatchBubbledInput(el: HTMLElement) {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (_e) {
    // ignore
  }
}

function pickTextarea(): HTMLTextAreaElement | null {
  const doc = document;
  const active = doc?.activeElement;
  if (isTextarea(active)) return active;

  const root = doc?.querySelector?.('main') || doc;
  const list = Array.from(root?.querySelectorAll?.('textarea') || []) as any[];
  for (const el of list) {
    if (!isTextarea(el)) continue;
    if ((el as any).disabled) continue;
    if ((el as any).readOnly) continue;
    return el;
  }
  return null;
}

function toTextareaEditor(handle: EditorHandle): TextareaEditor {
  if (!handle || (handle as any).kind !== 'textarea' || !isTextarea((handle as any).el)) {
    throw new Error('invalid textarea editor');
  }
  return handle as TextareaEditor;
}

export const chatgptTextareaEditorAdapter: EditorAdapter = {
  detectActiveEditor() {
    const ta = pickTextarea();
    if (!ta) return null;
    return { kind: 'textarea', el: ta };
  },
  getSelectionRange(editor: EditorHandle): EditorRange {
    const ta = toTextareaEditor(editor).el;
    const text = String(ta.value || '');
    const start = Number(ta.selectionStart);
    const end = Number(ta.selectionEnd);
    return clampRange(text, {
      start: Number.isFinite(start) ? start : text.length,
      end: Number.isFinite(end) ? end : text.length,
    });
  },
  replaceRange(editor: EditorHandle, range: EditorRange, text: string): EditorRange {
    const ta = toTextareaEditor(editor).el;
    const current = String(ta.value || '');
    const { text: next, rangeAfter } = replaceTextRange({ text: current, range, replacement: text });
    setTextareaValueCompat(ta, next);
    try {
      ta.setSelectionRange(rangeAfter.start, rangeAfter.end);
    } catch (_e) {
      // ignore
    }
    dispatchBubbledInput(ta);
    return rangeAfter;
  },
  focus(editor: EditorHandle) {
    const ta = toTextareaEditor(editor).el;
    try {
      ta.focus();
    } catch (_e) {
      // ignore
    }
  },
};
