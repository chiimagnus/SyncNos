export type DedaoCourseArticleAnnotation = {
  id: string;
  range: string;
  quote: string;
  note: string;
  tag: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
};

export type DedaoCourseArticleAnnotationSnapshot = {
  matched: boolean;
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

  function readRange(value: any, meta: any): string {
    const direct = normalizeText(value?.range);
    if (direct) return direct;
    const location = meta?.extra?.location;
    if (typeof location !== 'string' || !location.trim()) return '';
    try {
      return normalizeText(JSON.parse(location)?.range);
    } catch (_e) {
      return '';
    }
  }

  function rangeOrder(range: string): [number, number, number, number] | null {
    const match = String(range || '').match(/^(\d+):(\d+),(\d+):(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  }

  function compareAnnotation(left: DedaoCourseArticleAnnotation, right: DedaoCourseArticleAnnotation): number {
    const a = rangeOrder(left.range);
    const b = rangeOrder(right.range);
    if (a && b) {
      for (let i = 0; i < a.length; i += 1) {
        const delta = a[i] - b[i];
        if (delta) return delta;
      }
    } else if (a) {
      return -1;
    } else if (b) {
      return 1;
    }
    return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
  }

  function markerTextsFromVm(vm: any): any[] | null {
    if (!vm) return null;
    const candidates = [vm?.$props?.markerTexts, vm?.markerTexts, vm?.props?.markerTexts];
    for (const value of candidates) {
      if (Array.isArray(value)) return value;
    }
    return null;
  }

  function markerTextsFromElement(element: any): any[] | null {
    if (!element) return null;
    const vms = [
      element.__vue__,
      element.__vueParentComponent?.proxy,
      element.__vueParentComponent,
      element.__vnode?.componentInstance,
    ];
    for (const vm of vms) {
      const markerTexts = markerTextsFromVm(vm);
      if (markerTexts) return markerTexts;
    }
    return null;
  }

  const host = String(globalThis.location?.hostname || '')
    .trim()
    .toLowerCase();
  const pathname = String(globalThis.location?.pathname || '');
  const matched = (host === 'dedao.cn' || host.endsWith('.dedao.cn')) && /^\/course\/article\b/i.test(pathname);
  if (!matched) return { matched: false, ready: false, annotations: [] };

  let markerTexts: any[] | null = null;
  const preferredSelectors = [
    '.editor-show',
    '.iget_rich-text-panel--container',
    '.article-body',
    '.article-body-wrap',
    '.article-wrap',
  ];
  for (const selector of preferredSelectors) {
    const nodes = Array.from(document.querySelectorAll(selector)) as any[];
    for (const node of nodes) {
      markerTexts = markerTextsFromElement(node);
      if (markerTexts) break;
    }
    if (markerTexts) break;
  }

  if (!markerTexts) {
    const nodes = Array.from(document.querySelectorAll('div')) as any[];
    for (const node of nodes) {
      markerTexts = markerTextsFromElement(node);
      if (markerTexts) break;
    }
  }

  if (!markerTexts) return { matched: true, ready: false, annotations: [] };

  const annotations: DedaoCourseArticleAnnotation[] = [];
  const seen = new Set<string>();
  for (const raw of markerTexts) {
    const meta = raw?.meta || {};
    const quote = normalizeText(meta?.noteLine);
    const note = normalizeText(meta?.note);
    if (!quote && !note) continue;

    const range = readRange(raw, meta);
    const id = normalizeText(raw?.id || meta?.noteIdHazy || meta?.noteIdStr);
    const dedupeKey = id || `${range}\u0000${quote}\u0000${note}`;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    annotations.push({
      id,
      range,
      quote,
      note,
      tag: normalizeText(meta?.tag),
      authorName: normalizeText(meta?.notesOwner?.name),
      createdAt: normalizeTimestamp(meta?.createTime),
      updatedAt: normalizeTimestamp(meta?.updateTime),
    });
  }

  annotations.sort(compareAnnotation);
  return { matched: true, ready: true, annotations };
}
