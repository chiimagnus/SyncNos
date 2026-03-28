import type {
  ContentEditableEditor,
  EditorAdapter,
  EditorHandle,
  EditorRange,
} from '@services/integrations/item-mention/content/editor-adapter';
import { clampRange, replaceTextRange } from '@services/integrations/item-mention/content/editor-adapter';

function isNotionHost(hostname: string): boolean {
  return /(^|\.)notion\.so$/.test(String(hostname || '').toLowerCase());
}

function hasNotionAiSignals(): boolean {
  const doc = document;
  if (!doc || !doc.querySelector) return false;
  // These signals are observed on Notion AI chat UIs (page/side-panel/dialog).
  return !!doc.querySelector(
    '[data-agent-chat-user-step-id], [data-testid="agent-send-message-button"], [data-testid="unified-chat-model-button"]',
  );
}

function isNotionAiContext(): boolean {
  if (!isNotionHost(location?.hostname || '')) return false;
  const path = String(location?.pathname || '');
  // `https://www.notion.so/chat?...` is the canonical Notion AI chat entry.
  if (path === '/chat' || path.startsWith('/chat/')) return true;
  return hasNotionAiSignals();
}

function isVisible(el: Element | null): boolean {
  const anyEl = el as any;
  if (!anyEl || typeof anyEl.getBoundingClientRect !== 'function') return false;
  const rect = anyEl.getBoundingClientRect();
  return rect.width >= 6 && rect.height >= 6;
}

const NOTION_AI_LEAF_SELECTOR = 'div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]';

function isComposerLeaf(el: Element | null): el is HTMLElement {
  return !!el && typeof (el as any).matches === 'function' && (el as any).matches(NOTION_AI_LEAF_SELECTOR);
}

function findComposerLeafFromActiveOrSelection(): HTMLElement | null {
  const doc = document;
  if (!doc) return null;

  const active = doc.activeElement as Element | null;
  if (isComposerLeaf(active) && isVisible(active)) return active;
  const activeLeaf =
    active && (active as any).closest ? ((active as any).closest(NOTION_AI_LEAF_SELECTOR) as any) : null;
  if (isComposerLeaf(activeLeaf) && isVisible(activeLeaf)) return activeLeaf;

  const sel = globalThis.getSelection?.();
  if (sel && sel.rangeCount > 0) {
    try {
      const range = sel.getRangeAt(0);
      const node = range?.commonAncestorContainer as any;
      const el: Element | null =
        node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement ? node.parentElement : null;
      const leaf = el && (el as any).closest ? ((el as any).closest(NOTION_AI_LEAF_SELECTOR) as any) : null;
      if (isComposerLeaf(leaf) && isVisible(leaf)) return leaf;
    } catch (_e) {
      // ignore selection parsing failures
    }
  }

  // Only fallback to "the single visible leaf" to avoid hijacking normal Notion page editors.
  const list = Array.from(doc.querySelectorAll(NOTION_AI_LEAF_SELECTOR)) as HTMLElement[];
  const visible = list.filter((el) => isVisible(el));
  if (visible.length === 1) return visible[0]!;
  return null;
}

function toContentEditableEditor(handle: EditorHandle): ContentEditableEditor {
  const el = (handle as any)?.el as HTMLElement | null;
  const isEditable =
    !!el &&
    ((el as any).isContentEditable === true ||
      String(el.getAttribute?.('contenteditable') || '')
        .trim()
        .toLowerCase() === 'true');
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

function dispatchBubbledInput(el: HTMLElement) {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (_e) {
    // ignore
  }
}

export const notionAiContentEditableAdapter: EditorAdapter = {
  detectActiveEditor() {
    if (!isNotionAiContext()) return null;
    const el = findComposerLeafFromActiveOrSelection();
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
