import { renderToString as renderKatexToString } from 'katex';
import texmath from 'markdown-it-texmath';
import {
  createMarkdownRenderer,
  type MarkdownMathRuntime,
  type MarkdownRendererOptions,
} from '@ui/shared/markdown-core';
import 'katex/dist/katex.min.css';

const katexMathRuntime: MarkdownMathRuntime = {
  texmathPlugin: texmath as any,
  katexEngine: {
    renderToString: renderKatexToString,
  },
};

export function createKatexMarkdownRenderer(options: MarkdownRendererOptions = {}) {
  return createMarkdownRenderer({ ...options, renderMath: true }, katexMathRuntime);
}
