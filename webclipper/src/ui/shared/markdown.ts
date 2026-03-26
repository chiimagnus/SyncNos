import { renderToString as renderKatexToString } from 'katex';
import texmath from 'markdown-it-texmath';
import {
  createMarkdownRenderer as createMarkdownRendererCore,
  type MarkdownMathRuntime,
  type MarkdownRendererOptions,
} from '@ui/shared/markdown-core';

export type { MarkdownMathRuntime, MarkdownRendererOptions } from '@ui/shared/markdown-core';

const defaultMathRuntime: MarkdownMathRuntime = {
  texmathPlugin: texmath as any,
  katexEngine: {
    renderToString: renderKatexToString,
  },
};

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}) {
  const renderMath = options.renderMath ?? true;
  if (!renderMath) return createMarkdownRendererCore({ ...options, renderMath: false });
  return createMarkdownRendererCore({ ...options, renderMath: true }, defaultMathRuntime);
}
