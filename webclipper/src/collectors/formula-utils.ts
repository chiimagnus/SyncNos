export type FormulaReplaceResult = {
  replacedCount: number;
};

function normalizeTeX(value: unknown): string {
  // Keep backslashes and braces; only normalize whitespace and remove ZWSP.
  return String(value || '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyTeX(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.includes('\\')) return true;
  if (/[{}_^]/.test(text)) return true;
  return false;
}

function readAttr(el: any, name: string): string {
  try {
    if (!el || typeof el.getAttribute !== 'function') return '';
    return String(el.getAttribute(name) || '').trim();
  } catch (_e) {
    return '';
  }
}

function texFromAnnotation(el: any): string {
  if (!el || typeof el.querySelector !== 'function') return '';
  const ann = el.querySelector('annotation[encoding="application/x-tex"]');
  const raw = ann ? String(ann.textContent || '').trim() : '';
  return normalizeTeX(raw);
}

function texFromContainerAnnotations(container: any): string {
  if (!container || typeof container.querySelector !== 'function') return '';
  const ann = container.querySelector('annotation[encoding="application/x-tex"]');
  const raw = ann ? String(ann.textContent || '').trim() : '';
  return normalizeTeX(raw);
}

function texFromMathScript(el: any): { tex: string; display: boolean } | null {
  if (!el) return null;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag !== 'script') return null;
  const type = readAttr(el, 'type').toLowerCase();
  if (!type.startsWith('math/tex')) return null;
  const display = /mode\s*=\s*display/i.test(type);
  const tex = normalizeTeX(el.textContent || '');
  if (!tex) return null;
  return { tex, display };
}

function texFromDataMath(el: any): { tex: string; display: boolean } | null {
  const dataMath = readAttr(el, 'data-math');
  const tex = normalizeTeX(dataMath);
  if (!tex) return null;
  const cls = String(el && el.className ? el.className : '').toLowerCase();
  const display = cls.includes('math-block');
  return { tex, display };
}

function texFromCommonDataAttrs(el: any): string {
  const candidates = ['data-latex', 'data-tex', 'data-katex', 'data-formula', 'data-math'];
  for (const key of candidates) {
    const v = readAttr(el, key);
    if (!v) continue;
    const tex = normalizeTeX(v);
    if (tex) return tex;
  }
  return '';
}

function bestEffortTextFormula(el: any): string {
  const raw = el && typeof el.textContent === 'string' ? el.textContent : '';
  return normalizeTeX(raw);
}

function replaceWithText(el: any, text: string): boolean {
  const content = String(text || '');
  if (!content.trim()) return false;
  try {
    const doc = el && el.ownerDocument ? el.ownerDocument : null;
    const node = doc && typeof doc.createTextNode === 'function' ? doc.createTextNode(content) : null;
    if (!node) return false;
    if (typeof el.replaceWith === 'function') {
      el.replaceWith(node);
      return true;
    }
    if (el.parentNode && typeof el.parentNode.replaceChild === 'function') {
      el.parentNode.replaceChild(node, el);
      return true;
    }
  } catch (_e) {
    // ignore
  }
  return false;
}

export function replaceMathElementsWithLatexText(container: ParentNode | null): FormulaReplaceResult {
  if (!container || typeof (container as any).querySelectorAll !== 'function') return { replacedCount: 0 };

  const root = container as any;

  function wrapTeX(tex: string, display: boolean): string {
    const normalized = normalizeTeX(tex);
    if (!normalized) return '';
    if (!isLikelyTeX(normalized)) return normalized;
    return display ? `\n\n$$${normalized}$$\n\n` : `$${normalized}$`;
  }

  function extractTeXFromContainer(node: any): { tex: string; display: boolean; hasTeX: boolean } {
    const hasQuery = !!(node && typeof node.querySelector === 'function');
    const tag = String(node && node.tagName ? node.tagName : '').toLowerCase();
    const cls = String(node && node.className ? node.className : '').toLowerCase();

    let display = tag === 'pre' || cls.includes('katex-display') || cls.includes('math-block');

    if (hasQuery) {
      const mathBlock = node.querySelector('.math-block[data-math]');
      if (mathBlock) {
        const found = texFromDataMath(mathBlock);
        if (found && found.tex) return { tex: found.tex, display: true, hasTeX: isLikelyTeX(found.tex) };
      }

      const script = node.querySelector("script[type^='math/tex']");
      if (script) {
        const found = texFromMathScript(script);
        if (found && found.tex) return { tex: found.tex, display: found.display || display, hasTeX: isLikelyTeX(found.tex) };
      }

      const ann = texFromContainerAnnotations(node);
      if (ann) return { tex: ann, display, hasTeX: isLikelyTeX(ann) };
    }

    const fromAttrs = texFromCommonDataAttrs(node);
    if (fromAttrs) return { tex: fromAttrs, display, hasTeX: isLikelyTeX(fromAttrs) };

    const visible = bestEffortTextFormula(node);
    return { tex: visible, display, hasTeX: false };
  }

  // Some sites (e.g. Yuanbao) wrap display formulas inside a `<pre>` container (not code).
  // If we leave it as `<pre>`, most html-to-markdown converters will mistakenly emit a code fence.
  const preList = Array.from(root.querySelectorAll('pre')) as any[];
  let replacedCount = 0;
  for (const pre of preList) {
    if (!pre || !pre.parentNode) continue;
    if (pre.querySelector && pre.querySelector('code')) continue;
    let hasMath = false;
    try {
      hasMath = !!pre.querySelector(".math-block[data-math], .katex, .katex-display, mjx-container, script[type^='math/tex'], .ybc-markdown-katex");
    } catch (_e) {
      hasMath = false;
    }
    if (!hasMath) continue;

    const extracted = extractTeXFromContainer(pre);
    const wrapped = extracted.hasTeX ? wrapTeX(extracted.tex, true) : `\n\n${normalizeTeX(extracted.tex)}\n\n`;
    if (replaceWithText(pre, wrapped)) replacedCount += 1;
  }

  // Prefer outermost containers to avoid double replacements.
  const selectors = [
    '.math-block[data-math]',
    // MathJax v2 inline scripts.
    'script[type^="math/tex"]',
    // Yuanbao inline katex wrapper.
    '.ybc-markdown-katex',
    // Generic KaTeX containers.
    '.katex-display',
    '.katex',
    // MathJax v3 container.
    'mjx-container',
  ];

  const nodes: any[] = [];
  for (const selector of selectors) {
    try {
      const list = root.querySelectorAll(selector);
      for (const el of Array.from(list || [])) nodes.push(el);
    } catch (_e) {
      // ignore
    }
  }

  if (!nodes.length) return { replacedCount };

  function depthOf(el: any): number {
    let depth = 0;
    let cur = el && el.parentElement ? el.parentElement : null;
    while (cur) {
      depth += 1;
      cur = cur.parentElement || null;
      if (depth > 64) break;
    }
    return depth;
  }

  nodes.sort((a, b) => depthOf(a) - depthOf(b));

  for (const el of nodes) {
    if (!el) continue;

    // If a parent has already been replaced, this node will be detached.
    if (!el.parentNode) continue;

    const fromScript = texFromMathScript(el);
    if (fromScript) {
      const wrapped = wrapTeX(fromScript.tex, fromScript.display);
      if (replaceWithText(el, wrapped)) replacedCount += 1;
      continue;
    }

    // Gemini uses `.math-block[data-math]` (KaTeX HTML is aria-hidden and can be removed).
    const fromDataMath = texFromDataMath(el);
    if (fromDataMath && fromDataMath.tex) {
      const wrapped = wrapTeX(fromDataMath.tex, fromDataMath.display);
      if (replaceWithText(el, wrapped)) replacedCount += 1;
      continue;
    }

    // KaTeX / MathJax: prefer MathML annotation if present.
    const ann = texFromAnnotation(el);
    if (ann) {
      const cls = String(el && el.className ? el.className : '').toLowerCase();
      const display = cls.includes('katex-display') || cls.includes('math-block');
      const wrapped = wrapTeX(ann, display);
      if (replaceWithText(el, wrapped)) replacedCount += 1;
      continue;
    }

    // Some sites store original TeX in data attributes.
    const fromAttrs = texFromCommonDataAttrs(el);
    if (fromAttrs) {
      const cls = String(el && el.className ? el.className : '').toLowerCase();
      const display = cls.includes('katex-display') || cls.includes('math-block');
      const wrapped = wrapTeX(fromAttrs, display);
      if (replaceWithText(el, wrapped)) replacedCount += 1;
      continue;
    }

    // Best-effort fallback: keep visible math-ish text (avoids dropping formulas entirely).
    const cls = String(el && el.className ? el.className : '').toLowerCase();
    const looksMath =
      cls.includes('katex')
      || cls.includes('math')
      || String(el.tagName || '').toLowerCase() === 'mjx-container';
    if (!looksMath) continue;

    const visible = bestEffortTextFormula(el);
    if (!visible) continue;
    const display = cls.includes('katex-display') || cls.includes('math-block');
    // Do NOT wrap non-TeX visible strings with `$`/`$$` (most renderers treat it as TeX and will fail).
    const content = display ? `\n\n${visible}\n\n` : visible;
    if (replaceWithText(el, content)) replacedCount += 1;
  }

  return { replacedCount };
}
