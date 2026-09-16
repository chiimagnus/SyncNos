export type DedaoCourseArticleAnnotation = {
  id: string;
  quote: string;
  note: string;
  createdAt: number;
  updatedAt: number;
};

type DedaoCourseArticleAnnotationSnapshot = {
  ready: boolean;
  annotations: DedaoCourseArticleAnnotation[];
};

/**
 * Runs in the page MAIN world via scripting.executeScript.
 * Keep all helpers inside this function so Chrome/Firefox can serialize it without closures.
 */
export function collectDedaoCourseArticleAnnotationsInMainWorld(): DedaoCourseArticleAnnotationSnapshot {
  function normalizeText(value: unknown): string {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  function normalizeTimestamp(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function articleMarkerVmFromElement(element: any): any | null {
    const vm = element?.__vue__;
    if (vm?.$options?.name !== 'RichTextPanelWithMarker') return null;
    return Array.isArray(vm?.$props?.markerTexts) ? vm : null;
  }

  function quoteFromRange(rawRange: unknown, contents: unknown): string {
    const range = normalizeText(rawRange);
    const match = range.match(/^(\d+):(\d+),(\d+):(\d+)$/);
    if (!match || !Array.isArray(contents)) return '';

    const startIndex = Number(match[1]);
    const startOffset = Number(match[2]);
    const endIndex = Number(match[3]);
    const endOffset = Number(match[4]);
    if (startIndex > endIndex || endIndex >= contents.length) return '';

    const selected: string[] = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const text = (contents[index] as any)?.text;
      if (typeof text !== 'string') return '';

      const from = index === startIndex ? startOffset : 0;
      const to = index === endIndex ? endOffset : text.length;
      if (from < 0 || to < from || to > text.length) return '';
      selected.push(text.slice(from, to));
    }
    return normalizeText(selected.join('\n\n'));
  }

  const host = String(globalThis.location?.hostname || '')
    .trim()
    .toLowerCase();
  const pathname = String(globalThis.location?.pathname || '');
  const matched = (host === 'dedao.cn' || host.endsWith('.dedao.cn')) && /^\/course\/article\b/i.test(pathname);
  if (!matched) return { ready: false, annotations: [] };

  const markerVm = articleMarkerVmFromElement(document.querySelector('.editor-show'));
  if (!markerVm) return { ready: false, annotations: [] };
  const markerTexts = markerVm.$props.markerTexts as any[];
  const contents = markerVm.$props.contents;

  const annotations: DedaoCourseArticleAnnotation[] = [];
  const seen = new Set<string>();
  for (const raw of markerTexts) {
    const id = normalizeText(raw?.id);
    if (!id || seen.has(id)) continue;
    const meta = raw?.meta || {};
    const quote = normalizeText(meta?.noteLine) || quoteFromRange(raw?.range, contents);
    const note = normalizeText(meta?.note);
    if (!quote && !note) continue;
    seen.add(id);

    annotations.push({
      id,
      quote,
      note,
      createdAt: normalizeTimestamp(meta?.createTime),
      updatedAt: normalizeTimestamp(meta?.updateTime),
    });
  }

  return { ready: true, annotations };
}
