import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createMarkdownRenderer, markdownLikelyContainsMath } from '@ui/shared/markdown-core';

const plainRenderers = {
  content: createMarkdownRenderer(),
  textOnly: createMarkdownRenderer({ renderImages: false }),
};

type MathRuntime = {
  renderers: typeof plainRenderers;
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
          renderers: {
            content: mod.createKatexMarkdownRenderer(),
            textOnly: mod.createKatexMarkdownRenderer({ renderImages: false }),
          },
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

type MarkdownContentProps = {
  markdown: string;
  className?: string;
  renderImages?: boolean;
  syncnosAssetSrcById?: ReadonlyMap<number, string>;
  chatgptFileSrcById?: ReadonlyMap<string, string>;
};

export function MarkdownContent({
  markdown,
  className,
  renderImages = true,
  syncnosAssetSrcById,
  chatgptFileSrcById,
}: MarkdownContentProps) {
  const containsMath = useMemo(() => markdownLikelyContainsMath(markdown), [markdown]);
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
        console.warn('[Markdown] failed to load math renderer', error);
      });
    return () => {
      disposed = true;
    };
  }, [containsMath, loadedMathRuntime]);

  const renderers = containsMath && loadedMathRuntime ? loadedMathRuntime.renderers : plainRenderers;
  const renderer = renderImages ? renderers.content : renderers.textOnly;
  const html = useMemo(
    () => renderer.render(markdown, { syncnosAssetSrcById, chatgptFileSrcById }),
    [renderer, markdown, syncnosAssetSrcById, chatgptFileSrcById],
  );
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  return <div ref={elementRef} className={className} dangerouslySetInnerHTML={innerHtml} />;
}
