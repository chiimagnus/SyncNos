export type EditorRange = {
  start: number;
  end: number;
};

export type TextareaEditor = {
  kind: 'textarea';
  el: HTMLTextAreaElement;
};

export type ContentEditableEditor = {
  kind: 'contenteditable';
  el: HTMLElement;
};

export type EditorHandle = TextareaEditor | ContentEditableEditor;

export type EditorAdapter = {
  detectActiveEditor: () => EditorHandle | null;
  getSelectionRange: (editor: EditorHandle) => EditorRange;
  replaceRange: (editor: EditorHandle, range: EditorRange, text: string) => EditorRange;
  focus: (editor: EditorHandle) => void;
};

export function clampRange(text: string, range: EditorRange): EditorRange {
  const len = Math.max(0, String(text || '').length);
  const start = Math.max(0, Math.min(len, Math.floor(Number(range.start) || 0)));
  const end = Math.max(start, Math.min(len, Math.floor(Number(range.end) || 0)));
  return { start, end };
}

export function replaceTextRange(input: { text: string; range: EditorRange; replacement: string }): {
  text: string;
  rangeAfter: EditorRange;
} {
  const text = String(input.text || '');
  const replacement = String(input.replacement || '');
  const range = clampRange(text, input.range);
  const next = `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
  const caret = range.start + replacement.length;
  return { text: next, rangeAfter: { start: caret, end: caret } };
}
