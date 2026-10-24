import katexCss from 'virtual:syncnos-katex-shadow-css';
import { getURL } from '@services/shared/runtime';

export { createKatexMarkdownRenderer } from '@ui/shared/markdown-math';

// Use the same processed vendor stylesheet as the reader, not a second font manifest.
const fontFaceRule = /@font-face\s*\{[^}]*\}/g;
const fontCss = (katexCss.match(fontFaceRule) || []).join('\n');
const layoutCss = katexCss.replace(fontFaceRule, '');

type StyleEntry = { element: HTMLStyleElement; users: number };
type StyleRoot = Document | ShadowRoot;
const fontStyles = new WeakMap<StyleRoot, StyleEntry>();
const layoutStyles = new WeakMap<StyleRoot, StyleEntry>();

function resolveFontUrls(css: string): string {
  return css.replace(/url\((['"]?)(\/[^)'"\s]+)\1\)/g, (_match, quote: string, path: string) => {
    // Content-script styles must not resolve /assets against the visited website.
    return `url(${quote}${getURL(path.slice(1)) || path}${quote})`;
  });
}

function retainStyle(
  root: StyleRoot,
  entries: WeakMap<StyleRoot, StyleEntry>,
  kind: 'fonts' | 'layout',
  css: () => string,
): () => void {
  let entry = entries.get(root);
  if (!entry) {
    const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
    const element = doc.createElement('style');
    element.dataset.syncnosKatex = kind;
    element.textContent = css();
    const parent = root.nodeType === 9 ? doc.head || doc.documentElement : root;
    parent.appendChild(element);
    entry = { element, users: 0 };
    entries.set(root, entry);
  }
  entry.users += 1;
  return () => {
    entry.users -= 1;
    if (entry.users) return;
    entry.element.remove();
    entries.delete(root);
  };
}

export function mountKatexStyles(element: HTMLElement): () => void {
  const doc = element.ownerDocument;
  const root = element.getRootNode();
  const layoutRoot = root.nodeType === 11 && 'host' in root ? (root as ShadowRoot) : doc;
  // Chromium does not register @font-face declared only inside a shadow root.
  // Only font declarations reach the document; all layout rules stay in the panel.
  const releaseFonts = retainStyle(doc, fontStyles, 'fonts', () => resolveFontUrls(fontCss));
  const releaseLayout = retainStyle(layoutRoot, layoutStyles, 'layout', () => layoutCss);
  return () => {
    releaseLayout();
    releaseFonts();
  };
}
