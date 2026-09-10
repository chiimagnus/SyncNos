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

  function markerTextsFromElement(element: any): any[] | null {
    const vm = element?.__vue__;
    if (vm?.$options?.name !== 'RichTextPanelWithMarker') return null;
    return Array.isArray(vm?.$props?.markerTexts) ? vm.$props.markerTexts : null;
  }

  const host = String(globalThis.location?.hostname || '')
    .trim()
    .toLowerCase();
  const pathname = String(globalThis.location?.pathname || '');
  const matched = (host === 'dedao.cn' || host.endsWith('.dedao.cn')) && /^\/course\/article\b/i.test(pathname);
  if (!matched) return { ready: false, annotations: [] };

  const markerTexts = markerTextsFromElement(document.querySelector('.editor-show'));
  if (!markerTexts) return { ready: false, annotations: [] };

  const annotations: DedaoCourseArticleAnnotation[] = [];
  const seen = new Set<string>();
  for (const raw of markerTexts) {
    const id = normalizeText(raw?.id);
    if (!id || seen.has(id)) continue;
    const meta = raw?.meta || {};
    const quote = normalizeText(meta?.noteLine);
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
