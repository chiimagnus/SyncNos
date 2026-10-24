import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createMarkdownRenderer, markdownLikelyContainsMath } from '@ui/shared/markdown-core';

const plainRenderer = createMarkdownRenderer({
  openLinksInNewTab: true,
  renderImages: false,
});

type MathRuntime = {
  renderer: ReturnType<typeof createMarkdownRenderer>;
  mountStyles: (element: HTMLElement) => () => void;
};
let mathRuntime: MathRuntime | null = null;
let mathRuntimePromise: Promise<MathRuntime> | null = null;

async function ensureMathRuntime(): Promise<MathRuntime> {
  if (mathRuntime) return mathRuntime;
  if (!mathRuntimePromise) {
    mathRuntimePromise = import('@ui/shared/markdown-math-styles')
      .then((mod) => {
        const runtime = {
          renderer: mod.createKatexMarkdownRenderer({ openLinksInNewTab: true, renderImages: false }),
          mountStyles: mod.mountKatexStyles,
        };
        mathRuntime = runtime;
        return runtime;
      })
      .catch((error) => {
        mathRuntimePromise = null;
        throw error;
      });
  }
  return mathRuntimePromise;
}

export function CommentMarkdown({ markdown }: { markdown: string }) {
  const source = markdown;
  const containsMath = useMemo(() => markdownLikelyContainsMath(source), [source]);
  const elementRef = useRef<HTMLDivElement>(null);
  const [loadedMathRuntime, setLoadedMathRuntime] = useState(() => mathRuntime);

  useLayoutEffect(() => {
    if (!containsMath || !loadedMathRuntime || !elementRef.current) return;
    return loadedMathRuntime.mountStyles(elementRef.current);
  }, [containsMath, loadedMathRuntime]);

  useEffect(() => {
    if (!containsMath || loadedMathRuntime) return;
    let disposed = false;
    void ensureMathRuntime()
      .then((runtime) => {
        if (!disposed) setLoadedMathRuntime(runtime);
      })
      .catch((error) => {
        console.warn('[Comments] failed to load math renderer', {
          error: error instanceof Error ? error.message : String(error || ''),
        });
      });
    return () => {
      disposed = true;
    };
  }, [containsMath, loadedMathRuntime]);

  const activeRenderer = containsMath && loadedMathRuntime ? loadedMathRuntime.renderer : plainRenderer;
  const html = useMemo(() => activeRenderer.render(source), [activeRenderer, source]);
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  return (
    <div ref={elementRef} className="webclipper-inpage-comments-panel__markdown" dangerouslySetInnerHTML={innerHtml} />
  );
}
