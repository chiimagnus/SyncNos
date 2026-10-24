import { mountKatexStyles } from '@ui/shared/markdown-math-styles';

// The reader owns its document for the lifetime of this lazy module. Comments
// retain/release the same styles per mounted consumer and shadow root instead.
if (typeof document !== 'undefined') mountKatexStyles(document.documentElement);

export { createKatexMarkdownRenderer } from '@ui/shared/markdown-math';
