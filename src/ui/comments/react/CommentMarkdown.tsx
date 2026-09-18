import { useEffect, useMemo, useState } from 'react';

import { createMarkdownRenderer, markdownLikelyContainsMath } from '@ui/shared/markdown-core';

const plainRenderer = createMarkdownRenderer({
  openLinksInNewTab: true,
  renderImages: false,
  renderMath: false,
});

let mathRenderer: ReturnType<typeof createMarkdownRenderer> | null = null;
let mathRendererPromise: Promise<ReturnType<typeof createMarkdownRenderer>> | null = null;

async function ensureMathRenderer(): Promise<ReturnType<typeof createMarkdownRenderer>> {
  if (mathRenderer) return mathRenderer;
  if (!mathRendererPromise) {
    mathRendererPromise = import('@ui/shared/markdown-math')
      .then((mod) => {
        const renderer = mod.createKatexMarkdownRenderer({
          openLinksInNewTab: true,
          renderImages: false,
          mathOutput: 'mathml',
        });
        mathRenderer = renderer;
        return renderer;
      })
      .catch((error) => {
        mathRendererPromise = null;
        throw error;
      });
  }
  return mathRendererPromise;
}

export function CommentMarkdown({ markdown }: { markdown: unknown }) {
  const source = String(markdown || '');
  const containsMath = useMemo(() => markdownLikelyContainsMath(source), [source]);
  const [loadedMathRenderer, setLoadedMathRenderer] = useState<ReturnType<typeof createMarkdownRenderer> | null>(
    () => mathRenderer,
  );

  useEffect(() => {
    if (!containsMath || loadedMathRenderer) return;
    let disposed = false;
    void ensureMathRenderer()
      .then((renderer) => {
        if (!disposed) setLoadedMathRenderer(renderer);
      })
      .catch((error) => {
        console.warn('[Comments] failed to load math renderer', {
          error: error instanceof Error ? error.message : String(error || ''),
        });
      });
    return () => {
      disposed = true;
    };
  }, [containsMath, loadedMathRenderer]);

  const activeRenderer = containsMath && loadedMathRenderer ? loadedMathRenderer : plainRenderer;
  const html = useMemo(() => activeRenderer.render(source), [activeRenderer, source]);
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  return <div className="webclipper-inpage-comments-panel__markdown" dangerouslySetInnerHTML={innerHtml} />;
}
