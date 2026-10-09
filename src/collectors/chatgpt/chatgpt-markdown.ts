import { normalizeText as normalizeTextShared } from '@services/shared/normalize.ts';
import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';

function normalizeMarkdown(markdown: any): any {
  const s = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = s.split('\n').map((l: any) => l.replace(/[ \t]+$/g, ''));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInline(markdown: any): any {
  return normalizeMarkdown(markdown).replace(/\n+/g, ' ').trim();
}

function normalizeText(value: any): any {
  const text = String(value || '');
  return normalizeTextShared(text);
}

function wrapInlineCode(text: any): any {
  const s = String(text || '');
  if (!s) return '``';
  const matches = s.match(/`+/g) || [];
  const maxTicks = matches.reduce((m: any, t: any) => Math.max(m, t.length), 0);
  const fence = '`'.repeat(Math.max(1, maxTicks + 1));
  return `${fence}${s}${fence}`;
}

function codeFenceDelimiter(content: any): any {
  const runs = String(content || '').match(/`+/g) || [];
  const longest = runs.reduce((max: any, s: any) => Math.max(max, s.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function normalizeCodeLanguage(raw: any): any {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  if (!/^[a-z0-9_+.-]{1,40}$/.test(value)) return '';
  if (value === 'code' || value === 'text') return '';
  return value;
}

function pickCodeLanguageFromClass(className: any): any {
  const raw = String(className || '');
  if (!raw) return '';
  const parts = raw.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(language|lang)-([a-z0-9_+.-]+)$/i);
    if (m && m[2]) {
      const language = normalizeCodeLanguage(m[2]);
      if (language) return language;
    }
  }
  return '';
}

function extractPreCodeText(block: any): string {
  const code = block?.querySelector?.('code');
  return String(code?.textContent ?? block?.textContent ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/g, '');
}

function detectCodeLanguage(block: any): string {
  const code = block?.querySelector?.('code');
  const byCodeClass = pickCodeLanguageFromClass(code?.getAttribute?.('class'));
  if (byCodeClass) return byCodeClass;

  const header = block?.querySelector?.("[data-markdown-copy='exclude']");
  if (!header) return '';
  const leaves = Array.from(header.querySelectorAll('*')).filter(
    (node: any) =>
      !node.children?.length && String(node.tagName || '').toLowerCase() !== 'button' && !node.closest?.('button'),
  ) as any[];
  for (const leaf of leaves) {
    const language = normalizeCodeLanguage(leaf.textContent);
    if (language) return language;
  }
  return normalizeCodeLanguage(header.textContent);
}

function escapeTableCell(text: any): any {
  return String(text || '').replace(/\|/g, '\\|');
}

function isGoogleFaviconUrl(src: unknown): boolean {
  const value = String(src || '').trim();
  return (
    /^https:\/\/www\.google\.com\/s2\/favicons(?:[?#]|$)/i.test(value) ||
    /^https:\/\/t\d+\.gstatic\.com\/faviconV2(?:[?#]|$)/i.test(value)
  );
}

export function isChatgptNonContentImageUrl(src: unknown): boolean {
  const value = String(src || '').trim();
  return (
    isGoogleFaviconUrl(value) ||
    /^https:\/\/chatgpt\.com\/images\/ecosystem\/apps\/[^/?#]+\/icon\.png(?:[?#]|$)/i.test(value)
  );
}

const RICH_LAYOUT_COMPONENTS = new Set([
  'box',
  'card',
  'col',
  'row',
  'grid',
  'grid-item',
  'flow',
  'flow-item',
  'carousel-item',
]);

function isRichGraphic(node: any): boolean {
  if (!node || !node.getAttribute) return false;
  const tag = String(node.tagName || '').toLowerCase();
  if (tag !== 'svg' && tag !== 'canvas') return false;
  if (node.getAttribute('data-d-component') === 'icon') return false;
  if (node.getAttribute('data-syncnos-graphic') === 'true') return true;
  if (node.closest?.("[aria-hidden='true'], [data-markdown-copy='exclude'], button")) return false;
  if (
    tag === 'canvas' ||
    node.getAttribute('data-d-component') === 'svg' ||
    node.closest?.("[data-d-component='chart']") != null ||
    node.classList?.contains('recharts-surface') ||
    (node.getAttribute('role') === 'img' && !!node.getAttribute('aria-label'))
  )
    return true;
  const rect = node.getBoundingClientRect?.();
  const width = Number(rect?.width) || Number.parseFloat(node.getAttribute('width') || '') || 0;
  const height = Number(rect?.height) || Number.parseFloat(node.getAttribute('height') || '') || 0;
  return width >= 80 && height >= 50;
}

function hasRichGraphic(root: any): boolean {
  if (!root) return false;
  if (isRichGraphic(root) || root.querySelector?.('img[data-syncnos-graphic="true"]')) return true;
  return Array.from(root.querySelectorAll?.('svg, canvas') || []).some(isRichGraphic);
}

function graphicLabel(node: any): string {
  return String(node.getAttribute?.('aria-label') || node.querySelector?.('title')?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function graphicPlaceholder(node: any): string {
  const label = graphicLabel(node);
  return label ? `[图表：${label}]` : '[图表：请在原对话查看]';
}

const SVG_STYLES = [
  'fill',
  'stroke',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'opacity',
  'stroke-width',
  'stroke-dasharray',
  'text-anchor',
];
const MAX_GRAPHIC_DATA_LENGTH = 2_000_000;

function inlineSvgStyles(source: any, copy: any, win: any): void {
  if (typeof win?.getComputedStyle !== 'function') return;
  const sources = [source, ...Array.from(source.querySelectorAll('*'))] as any[];
  const copies = [copy, ...Array.from(copy.querySelectorAll('*'))] as any[];
  if (sources.length > 4000) return;
  for (let index = 0; index < sources.length; index += 1) {
    if (sources[index]?.namespaceURI !== 'http://www.w3.org/2000/svg') continue;
    const computed = win.getComputedStyle(sources[index]);
    for (const property of SVG_STYLES) {
      const value = computed.getPropertyValue(property).trim();
      if (value && !/url\((?!['\"]?#)/i.test(value)) copies[index].style.setProperty(property, value);
    }
  }
}

async function renderSvgPng(source: any, copy: any, win: any): Promise<string> {
  if (source.querySelector?.('foreignObject, image')) return '';
  const rect = source.getBoundingClientRect?.();
  const viewBox = String(source.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const sourceSize = (key: 'width' | 'height', fallback: number): number => {
    const attribute = String(source.getAttribute(key) || '');
    return Number(rect?.[key]) || (/^[\d.]+(?:px)?$/.test(attribute) ? Number.parseFloat(attribute) : 0) || fallback;
  };
  const nativeWidth = sourceSize('width', viewBox.length === 4 ? viewBox[2] : 0);
  const nativeHeight = sourceSize('height', viewBox.length === 4 ? viewBox[3] : 0);
  if (nativeWidth < 16 || nativeHeight < 16) return '';
  const scale = Math.min(
    1,
    1600 / nativeWidth,
    1200 / nativeHeight,
    Math.sqrt(1_800_000 / (nativeWidth * nativeHeight)),
  );
  const width = Math.max(1, Math.round(nativeWidth * scale));
  const height = Math.max(1, Math.round(nativeHeight * scale));
  const svg = copy.cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${nativeWidth} ${nativeHeight}`);
  inlineSvgStyles(source, svg, win);
  for (const node of [svg, ...Array.from(svg.querySelectorAll('*'))] as any[]) {
    for (const attr of Array.from(node.attributes || []) as any[]) {
      if (
        /^on/i.test(attr.name) ||
        ((attr.name === 'href' || attr.name === 'xlink:href') && !attr.value.startsWith('#'))
      ) {
        node.removeAttribute(attr.name);
      }
    }
  }
  svg
    .querySelectorAll('script, style, foreignObject, animate, animateTransform, animateMotion, set, image')
    .forEach((node: any) => node.remove());
  const xml = new win.XMLSerializer().serializeToString(svg);
  const image = new win.Image();
  const ready = new Promise<boolean>((resolve) => {
    const timeout = win.setTimeout(() => finish(false), 1200);
    const finish = (ok: boolean) => {
      win.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
  if (!(await ready)) return '';
  const canvas = source.ownerDocument.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.length <= MAX_GRAPHIC_DATA_LENGTH ? dataUrl : '';
}

function cloneWithControlState(root: any, snapshotCanvases = false): any {
  if (!root?.cloneNode) return null;
  const copy = root.cloneNode(true);
  const selector = 'input[type="checkbox"], input[type="radio"], input[type="range"], option';
  const live = Array.from(root.querySelectorAll?.(selector) || []) as any[];
  const snapshots = Array.from(copy.querySelectorAll?.(selector) || []) as any[];
  for (let index = 0; index < live.length; index += 1) {
    const src = live[index];
    const dest = snapshots[index];
    if (!src?.closest?.('[data-d-component]') || !dest) continue;
    if (String(src.tagName).toLowerCase() === 'option') dest.toggleAttribute('selected', !!src.selected);
    else if (src.type === 'range') dest.setAttribute('value', String(src.value || ''));
    else dest.toggleAttribute('checked', !!src.checked);
  }
  if (snapshotCanvases) {
    const canvases = Array.from(root.querySelectorAll?.('canvas') || []) as any[];
    const targets = Array.from(copy.querySelectorAll?.('canvas') || []) as any[];
    for (let index = 0; index < canvases.length; index += 1) {
      if (!isRichGraphic(canvases[index])) continue;
      try {
        const dataUrl = String(canvases[index].toDataURL('image/png') || '');
        if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > MAX_GRAPHIC_DATA_LENGTH) continue;
        const image = root.ownerDocument.createElement('img');
        image.setAttribute('data-syncnos-graphic', 'true');
        image.setAttribute('src', dataUrl);
        image.setAttribute('alt', graphicLabel(canvases[index]) || '图表');
        targets[index].replaceWith(image);
      } catch (_error) {
        // Keep the canvas for the text-only fallback when pixels cannot be read.
      }
    }
  }
  return copy;
}

function chartAccessibleTable(source: any, target: any): void {
  if (!source.classList?.contains('recharts-surface')) return;
  let original = source.parentElement;
  let cloned = target.parentElement;
  let list: any = null;
  for (let i = 0; i < 16 && original && cloned; i += 1) {
    const candidate = original.querySelector?.('ul.sr-only');
    if (candidate && original.querySelectorAll('svg.recharts-surface').length === 1) {
      list = candidate;
      break;
    }
    original = original.parentElement;
    cloned = cloned.parentElement;
  }
  if (!list || !cloned) return;
  const rows = Array.from(list.querySelectorAll('li'))
    .map((item: any) =>
      String(item.textContent || '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  if (!rows.length) return;

  const parsed = rows.map((line) => {
    const parts = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!parts) return null;
    const value = parts[2]!.match(/^(.*?)(?:\s+)?([+-]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[+-]?\d+)?%?)$/i);
    if (!value) return null;
    return { category: parts[1]!.trim(), series: value[1]!.trim() || '数值', value: value[2]! };
  });
  const first = parsed[0];
  const isTable = !!first && parsed.every((row) => row && row.series === first.series);
  const doc = target.ownerDocument;
  const replacement = doc.createElement(isTable ? 'table' : 'ul');
  replacement.setAttribute('data-syncnos-chart-data', 'true');
  if (isTable) {
    const header = doc.createElement('tr');
    for (const text of ['类别', first.series]) {
      const cell = doc.createElement('th');
      cell.textContent = text;
      header.appendChild(cell);
    }
    replacement.appendChild(header);
    for (const row of parsed) {
      const tr = doc.createElement('tr');
      for (const text of [row!.category, row!.value]) {
        const cell = doc.createElement('td');
        cell.textContent = text;
        tr.appendChild(cell);
      }
      replacement.appendChild(tr);
    }
  } else {
    for (const text of rows) {
      const item = doc.createElement('li');
      item.textContent = text;
      replacement.appendChild(item);
    }
  }
  cloned.querySelector?.('ul.sr-only')?.remove();
  target.parentElement?.insertBefore(replacement, target);
}

async function snapshotRichGraphics(root: any, win: any): Promise<string> {
  if (!hasRichGraphic(root) || !root?.cloneNode) return '';
  const copy = cloneWithControlState(root);
  const sources = Array.from(root.querySelectorAll('svg, canvas')) as any[];
  const targets = Array.from(copy.querySelectorAll('svg, canvas')) as any[];
  const jobs: Promise<{ image: any; dataUrl: string; label: string }>[] = [];
  let count = 0;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!isRichGraphic(source) || count++ >= 12) continue;
    const target = targets[index];
    chartAccessibleTable(source, target);
    target.setAttribute('data-syncnos-graphic', 'true');
    jobs.push(
      (async () => {
        let dataUrl = '';
        try {
          dataUrl =
            String(source.tagName).toLowerCase() === 'canvas'
              ? source.toDataURL('image/png')
              : await renderSvgPng(source, target, win);
        } catch (_error) {
          // A failed local rasterization keeps the original graphic for the readable fallback.
        }
        return { image: target, dataUrl, label: graphicLabel(source) || '图表' };
      })(),
    );
  }
  let totalImageLength = 0;
  for (const { image, dataUrl, label } of await Promise.all(jobs)) {
    if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > MAX_GRAPHIC_DATA_LENGTH) continue;
    if (totalImageLength + dataUrl.length > 4_000_000) continue;
    totalImageLength += dataUrl.length;
    const replacement = root.ownerDocument.createElement('img');
    replacement.setAttribute('data-syncnos-graphic', 'true');
    replacement.setAttribute('src', dataUrl);
    replacement.setAttribute('alt', label);
    for (const sibling of [image.previousSibling, image.nextSibling]) {
      if (sibling?.nodeType === 3 && !String(sibling.textContent || '').trim()) sibling.remove();
    }
    image.replaceWith(replacement);
  }
  return copy.outerHTML;
}

function removeNonContentNodes(container: any): any {
  if (!container || !container.querySelectorAll) return container;

  function looksLikeMermaidSource(text: string): boolean {
    const s = String(text || '').trim();
    if (!s || s.length < 12) return false;
    return /\b(graph\s+(TD|LR|RL|BT)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt)\b/i.test(s);
  }

  function shouldKeepHiddenNode(el: any): boolean {
    if (!el) return false;
    const text = String(el.textContent || '').trim();
    if (text.includes('\n')) return true;
    if (text.length >= 120) return true;
    if (looksLikeMermaidSource(text)) return true;

    // Many rich-code/diagram components keep the raw source in hidden/sr-only nodes.
    // Keep those nodes when they are clearly part of a code/diagram container.
    try {
      const keepSelectors = [
        'pre',
        'code',
        '#code-block-viewer',
        '[data-code-block]',
        '[data-language]',
        '[data-code-language]',
        '.cm-content',
        '.cm-line',
        '.mermaid',
        "[data-testid*='code' i]",
      ];
      const selector = keepSelectors.join(',');
      if (typeof el.closest === 'function' && el.closest(selector)) return true;
    } catch (_e) {
      // ignore
    }

    return false;
  }

  container.querySelectorAll("[data-markdown-copy='exclude']").forEach((el: any) => {
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  });

  const controls =
    '[data-d-component="checkbox"], [data-d-component="radio"], [data-d-component="radio-group"], [data-d-component="slider"], [data-d-component="select"], [data-d-component="segmented-control"]';
  container.querySelectorAll(controls).forEach((el: any) => {
    if (!container.contains(el)) return;
    const kind = String(el.getAttribute('data-d-component') || '');
    const label = String(el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const selected = el.querySelector?.(
      '[aria-checked="true"], [aria-pressed="true"], [data-state="checked"], [data-state="active"], input:checked, option:checked',
    );
    let summary = '';
    if (kind === 'checkbox' || kind === 'radio') {
      const state =
        el.getAttribute('aria-checked') ||
        el.getAttribute('data-state') ||
        selected?.getAttribute?.('aria-checked') ||
        selected?.getAttribute?.('data-state');
      const checked =
        state === 'true' ||
        state === 'checked' ||
        !!el.matches?.('input:checked') ||
        !!el.querySelector?.('input:checked');
      summary = `${checked ? '[x]' : '[ ]'} ${label || '选项'}`;
    } else if (kind === 'slider') {
      const valueNode = el.querySelector?.('[role="slider"], input[type="range"]') || el;
      const value =
        valueNode.getAttribute('aria-valuetext') ||
        valueNode.getAttribute('aria-valuenow') ||
        valueNode.getAttribute('value');
      summary = `${label || '滑块'}：${String(value || '').trim()}`;
    } else {
      const selectedLabel = String(selected?.getAttribute?.('aria-label') || selected?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      summary = `${label || '选择'}${selectedLabel && selectedLabel !== label ? `：${selectedLabel}` : ''}`;
    }
    if (!summary.trim()) return;
    const replacement = container.ownerDocument.createElement('p');
    replacement.textContent = summary;
    el.replaceWith(replacement);
  });

  container.querySelectorAll('svg, canvas').forEach((el: any) => {
    if (!isRichGraphic(el)) return;
    const placeholder = container.ownerDocument.createElement('p');
    placeholder.textContent = graphicPlaceholder(el);
    for (const sibling of [el.previousSibling, el.nextSibling]) {
      if (sibling?.nodeType === 3 && !String(sibling.textContent || '').trim()) sibling.remove();
    }
    el.replaceWith(placeholder);
  });

  container.querySelectorAll('svg, path, input, select, option, script, style').forEach((el: any) => {
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  });

  container.querySelectorAll('button').forEach((el: any) => {
    try {
      const candidates = [
        String(el.getAttribute ? el.getAttribute('data-clipboard-text') || '' : ''),
        String(el.getAttribute ? el.getAttribute('data-copy-text') || '' : ''),
        String(el.getAttribute ? el.getAttribute('data-code') || '' : ''),
        String(el.getAttribute ? el.getAttribute('data-source') || '' : ''),
        String(el.getAttribute ? el.getAttribute('data-mermaid') || '' : ''),
        String(el.getAttribute ? el.getAttribute('data-mermaid-source') || '' : ''),
      ].filter(Boolean);
      const picked = candidates.find((s: string) => s && (s.includes('\n') || s.length > 160)) || '';
      const code = String(picked || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n+$/g, '');
      if (code && (code.includes('\n') || code.length > 120)) {
        const doc = container.ownerDocument || document;
        const pre = doc && doc.createElement ? doc.createElement('pre') : null;
        const codeEl = pre && pre.appendChild ? doc.createElement('code') : null;
        if (pre && codeEl) {
          if (looksLikeMermaidSource(code)) codeEl.setAttribute('class', 'language-mermaid');
          codeEl.textContent = code;
          pre.appendChild(codeEl);
          try {
            el.parentNode && el.parentNode.insertBefore(pre, el);
          } catch (_e2) {
            // ignore
          }
        }
      }
    } catch (_e) {
      // ignore
    }
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  });

  // Some code/diagram components may store the raw source in hidden/readonly textareas.
  // Remove them by default to avoid capturing input boxes, but keep when they clearly look like content.
  container.querySelectorAll('textarea').forEach((el: any) => {
    if (shouldKeepHiddenNode(el)) return;
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  });

  container.querySelectorAll(".sr-only, [aria-hidden='true']").forEach((el: any) => {
    if (shouldKeepHiddenNode(el)) return;
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  });

  return container;
}

function getAssistantContentRoot(wrapper: any): any {
  if (!wrapper) return null;
  const selection = wrapper.querySelector?.('[data-chatgpt-selection-message-id]');
  if (selection) return selection;

  const primary = Array.from(
    wrapper.querySelectorAll?.("[data-markdown-text-style='assistant-message'][data-markdown-text-tone='primary']") ||
      [],
  ) as any[];
  if (primary.length === 1) return primary[0];
  if (primary.length > 1) {
    const doc = wrapper.ownerDocument || document;
    const holder = doc.createElement('div');
    for (const node of primary) holder.appendChild(node.cloneNode(true));
    return holder;
  }

  return wrapper.querySelector?.("[data-markdown-text-style='assistant-message']") || wrapper;
}

function sanitizeRenderedClone(root: any): any {
  if (!root || !root.cloneNode) return null;
  try {
    const cloned = root.cloneNode(true);
    replaceMathElementsWithLatexText(cloned);
    removeNonContentNodes(cloned);
    return cloned;
  } catch (_e) {
    return null;
  }
}

function extractTextFromSanitizedClone(clone: any): any {
  if (!clone) return '';
  const inner = typeof clone.innerText === 'string' ? clone.innerText : '';
  if (inner && inner.trim()) return inner;

  const blockTags = new Set([
    'P',
    'DIV',
    'LI',
    'UL',
    'OL',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'PRE',
    'SECTION',
    'ARTICLE',
    'TABLE',
    'TR',
  ]);
  const parts: any[] = [];
  const TEXT_NODE = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function walk(node: any): any {
    if (!node) return;
    const t = node.nodeType;
    if (t === TEXT_NODE) {
      const v = node.nodeValue ? String(node.nodeValue) : '';
      if (v) parts.push(v);
      return;
    }
    if (t !== ELEMENT_NODE) return;

    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }

    if (tag === 'PRE') {
      const codeText = extractPreCodeText(node);
      if (codeText) parts.push(codeText);
      parts.push('\n\n');
      return;
    }

    const children = node.childNodes ? Array.from(node.childNodes) : [];
    for (const c of children) walk(c);

    if (blockTags.has(tag)) parts.push('\n\n');
  }

  walk(clone);
  return parts.join('');
}

function htmlToMarkdown(root: any): any {
  if (!root) return '';
  const TEXT_NODE = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function renderChildren(el: any, ctx: any): any {
    const out = [];
    const kids = el && el.childNodes ? Array.from(el.childNodes) : [];
    for (const c of kids) out.push(renderNode(c, ctx));
    return out.join('');
  }

  function renderListItem(li: any, marker: any, depth: any, ctx: any): any {
    const indent = '  '.repeat(Math.max(0, depth));
    const continuationIndent = indent + ' '.repeat(marker.length + 1);

    const contentClone = li.cloneNode ? li.cloneNode(true) : null;
    if (contentClone && contentClone.childNodes) {
      const toRemove: any[] = [];
      for (const child of Array.from(contentClone.childNodes) as any[]) {
        if (!child || !child.tagName) continue;
        const tag = String(child.tagName || '').toLowerCase();
        if (tag === 'ul' || tag === 'ol') toRemove.push(child);
      }
      for (const n of toRemove) {
        try {
          n.remove();
        } catch (_e) {
          // ignore
        }
      }
    }

    const body = normalizeMarkdown(renderChildren(contentClone || li, ctx)).replace(/\n{2,}/g, '\n');
    const lines = body ? body.split('\n').filter((l: any) => l.length) : [];
    const out = [];
    if (lines.length) {
      out.push(`${indent}${marker} ${lines[0]}`);
      for (const line of lines.slice(1)) out.push(`${continuationIndent}${line}`);
    } else {
      out.push(`${indent}${marker}`);
    }

    const nestedLists: any[] = [];
    if (li && li.childNodes) {
      for (const child of Array.from(li.childNodes) as any[]) {
        if (!child || !child.tagName) continue;
        const tag = String(child.tagName || '').toLowerCase();
        if (tag === 'ul' || tag === 'ol') nestedLists.push(child);
      }
    }
    for (const nested of nestedLists) {
      const nestedMarkdown = renderList(nested, String(nested.tagName || '').toLowerCase() === 'ol', {
        ...ctx,
        listDepth: depth + 1,
      }).trimEnd();
      if (nestedMarkdown) out.push(nestedMarkdown);
    }

    return out.join('\n');
  }

  function renderList(listEl: any, ordered: any, ctx: any): any {
    const depth = ctx && Number.isFinite(ctx.listDepth) ? ctx.listDepth : 0;
    const startValue = Number.parseInt(String(listEl.getAttribute ? listEl.getAttribute('start') || '' : ''), 10);
    const hasStart = Number.isFinite(startValue);

    const items: any[] = [];
    const children: any[] = listEl && listEl.children ? (Array.from(listEl.children) as any[]) : [];
    let orderedIndex = hasStart ? startValue : 1;
    for (const child of children) {
      if (!child || String(child.tagName || '').toLowerCase() !== 'li') continue;
      const marker = ordered ? `${orderedIndex}.` : '-';
      items.push(renderListItem(child, marker, depth, { ...ctx, listDepth: depth }));
      if (ordered) orderedIndex += 1;
    }
    return items.join('\n') + (items.length ? '\n\n' : '');
  }

  function renderBlockquote(el: any, ctx: any): any {
    const raw = normalizeMarkdown(renderChildren(el, ctx));
    if (!raw) return '';
    const lines = raw.split('\n');
    const quoted = lines.map((l: any) => (l ? `> ${l}` : '>')).join('\n');
    return `${quoted}\n\n`;
  }

  function renderTable(tableEl: any, ctx: any): any {
    if (!tableEl || !tableEl.querySelectorAll) return '';
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (!rows.length) return '';

    const matrix = rows.map((tr: any) => {
      const cells = Array.from(tr.children || []).filter((c: any) => {
        const tag = c && c.tagName ? String(c.tagName).toLowerCase() : '';
        return tag === 'th' || tag === 'td';
      });
      return cells.map((cell: any) => escapeTableCell(normalizeInline(renderChildren(cell, ctx))));
    });

    const colCount = Math.max(0, ...matrix.map((r: any) => r.length));
    if (!colCount || !matrix.length) return '';

    const out = [];
    const header = matrix[0].concat(Array(Math.max(0, colCount - matrix[0].length)).fill(''));
    out.push(`| ${header.join(' | ')} |`);
    out.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
    for (const row of matrix.slice(1)) {
      const padded = row.concat(Array(Math.max(0, colCount - row.length)).fill(''));
      out.push(`| ${padded.join(' | ')} |`);
    }
    return `\n\n${out.join('\n')}\n\n`;
  }

  function renderNode(node: any, ctx: any): any {
    if (!node) return '';
    if (node.nodeType === TEXT_NODE) return node.nodeValue ? String(node.nodeValue) : '';
    if (node.nodeType !== ELEMENT_NODE) return '';

    const tag = node.tagName ? String(node.tagName).toLowerCase() : '';
    if (!tag) return renderChildren(node, ctx);

    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path' || tag === 'button') return '';

    const markdownCopy =
      typeof node.getAttribute === 'function' ? String(node.getAttribute('data-markdown-copy') || '') : '';
    if (markdownCopy === 'exclude') return '';
    if (markdownCopy === 'code-block') {
      const text = extractPreCodeText(node);
      if (!text.trim()) return '';
      const lang = detectCodeLanguage(node);
      const fence = codeFenceDelimiter(text);
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    }

    if (tag === 'textarea') {
      const text = String((node && typeof node.value === 'string' ? node.value : node.textContent) || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n+$/g, '');
      if (!text.trim()) return '';
      const isMermaid =
        /\b(graph\s+(TD|LR|RL|BT)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt)\b/i.test(text);
      const fence = codeFenceDelimiter(text);
      const lang = isMermaid ? 'mermaid' : '';
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    }

    if (tag === 'pre') {
      const text = extractPreCodeText(node);
      if (!text.trim()) return '';
      const lang = detectCodeLanguage(node);
      const fence = codeFenceDelimiter(text);
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    }

    if (tag === 'code') return wrapInlineCode(String(node.textContent || ''));
    if (tag === 'strong' || tag === 'b') return `**${renderChildren(node, ctx)}**`;
    if (tag === 'em' || tag === 'i') return `*${renderChildren(node, ctx)}*`;
    if (tag === 'del' || tag === 's') return `~~${renderChildren(node, ctx)}~~`;

    if (tag === 'a') {
      const href = node.getAttribute ? String(node.getAttribute('href') || '') : '';
      const text = normalizeMarkdown(renderChildren(node, ctx));
      if (href && /^https?:\/\//i.test(href)) return `[${text || href}](${href})`;
      return text;
    }

    if (tag === 'img') {
      const src = node.getAttribute ? String(node.getAttribute('src') || '').trim() : '';
      if (isChatgptNonContentImageUrl(src)) return '';
      if (
        node.getAttribute?.('data-syncnos-graphic') === 'true' &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)
      ) {
        const alt = String(node.getAttribute('alt') || '图表').replace(/[\[\]\\]/g, '\\$&');
        return `\n\n![${alt}](${src})\n\n`;
      }
      if (/^https?:\/\//i.test(src)) return `![](${src})`;
      return '';
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = normalizeMarkdown(renderChildren(node, ctx));
      if (!text) return '';
      return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`;
    }

    if (tag === 'table') return renderTable(node, ctx);
    if (tag === 'ul') return renderList(node, false, ctx);
    if (tag === 'ol') return renderList(node, true, ctx);
    if (tag === 'blockquote') return renderBlockquote(node, ctx);

    if (tag === 'p') {
      const text = normalizeMarkdown(renderChildren(node, ctx));
      return text ? `${text}\n\n` : '';
    }

    if (tag === 'li') {
      const text = normalizeMarkdown(renderChildren(node, ctx));
      return text ? `${text}\n` : '';
    }

    const rendered = renderChildren(node, ctx);
    if (RICH_LAYOUT_COMPONENTS.has(String(node.getAttribute?.('data-d-component') || ''))) {
      const content = normalizeMarkdown(rendered);
      return content ? `\n\n${content}\n\n` : '';
    }
    return rendered;
  }

  return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
}

function extractRenderedMarkdown(root: any): any {
  const cloned = sanitizeRenderedClone(root);
  if (!cloned) return '';
  return htmlToMarkdown(cloned) || '';
}

function extractRenderedText(root: any): any {
  const cloned = sanitizeRenderedClone(root);
  if (!cloned) return '';
  return normalizeText(extractTextFromSanitizedClone(cloned));
}

function extractAssistantMarkdown(wrapper: any): any {
  return extractRenderedMarkdown(getAssistantContentRoot(wrapper));
}

function extractAssistantText(wrapper: any): any {
  return extractRenderedText(getAssistantContentRoot(wrapper));
}

const api = {
  removeNonContentNodes,
  normalizeMarkdown,
  extractTextFromSanitizedClone,
  htmlToMarkdown,
  extractRenderedMarkdown,
  extractRenderedText,
  extractAssistantMarkdown,
  extractAssistantText,
  hasRichGraphic,
  cloneWithControlState,
  snapshotRichGraphics,
};

export default api;
