import type { EditorAdapter } from '@services/integrations/item-mention/content/editor-adapter';
import { createTextareaOrContentEditableEditorAdapter } from '@services/integrations/item-mention/content/editor-textarea-or-contenteditable';

export const deepseekEditorAdapter: EditorAdapter = createTextareaOrContentEditableEditorAdapter();
