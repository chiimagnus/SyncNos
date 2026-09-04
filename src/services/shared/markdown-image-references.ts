import MarkdownIt from 'markdown-it';

const markdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false });
const INLINE_IMAGE_CANDIDATE_RE = /!\[([^\]\r\n]*)\]\(\s*(<[^>\r\n]+>|[^\s)]+)(\s+"[^"\r\n]*")?\s*\)/g;

export type MarkdownImageReference = {
  start: number;
  end: number;
  full: string;
  alt: string;
  rawTarget: string;
  target: string;
  targetStart: number;
  targetEnd: number;
  title: string;
  angleWrapped: boolean;
};

export type MarkdownImageReferenceReplacement = { target: string } | { replacement: string } | null;

function collectRawCandidates(source: string): MarkdownImageReference[] {
  const output: MarkdownImageReference[] = [];
  INLINE_IMAGE_CANDIDATE_RE.lastIndex = 0;
  for (const match of source.matchAll(INLINE_IMAGE_CANDIDATE_RE)) {
    const start = match.index ?? 0;
    const full = String(match[0] || '');
    const alt = String(match[1] || '');
    const rawTarget = String(match[2] || '');
    const title = String(match[3] || '');
    const angleWrapped = rawTarget.startsWith('<') && rawTarget.endsWith('>');
    const rawTargetOffset = full.indexOf(rawTarget, alt.length + 4);
    if (rawTargetOffset < 0) continue;
    const rawTargetStart = start + rawTargetOffset;
    const targetStart = rawTargetStart + (angleWrapped ? 1 : 0);
    const targetEnd = rawTargetStart + rawTarget.length - (angleWrapped ? 1 : 0);
    output.push({
      start,
      end: start + full.length,
      full,
      alt,
      rawTarget,
      target: source.slice(targetStart, targetEnd).trim(),
      targetStart,
      targetEnd,
      title,
      angleWrapped,
    });
  }
  return output;
}

function collectImageTokenSources(tokens: readonly any[], output: Set<string>): void {
  for (const token of tokens) {
    if (token?.type === 'image' && typeof token.attrGet === 'function') {
      const src = String(token.attrGet('src') || '');
      if (src) output.add(src);
    }
    if (Array.isArray(token?.children) && token.children.length) collectImageTokenSources(token.children, output);
  }
}

export function collectMarkdownImageReferences(markdown: unknown): MarkdownImageReference[] {
  const source = String(markdown || '');
  if (!source) return [];
  const candidates = collectRawCandidates(source);
  if (!candidates.length) return [];

  let namespaceIndex = 0;
  let probePrefix = 'https://syncnos.invalid/__markdown-image-probe__/';
  while (source.includes(probePrefix)) {
    namespaceIndex += 1;
    probePrefix = `https://syncnos.invalid/__markdown-image-probe-${namespaceIndex}__/`;
  }

  const probeUrls = candidates.map((_, index) => `${probePrefix}${index}`);
  let probeSource = source;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!;
    probeSource = `${probeSource.slice(0, candidate.targetStart)}${probeUrls[index]}${probeSource.slice(candidate.targetEnd)}`;
  }

  const imageSources = new Set<string>();
  collectImageTokenSources(markdownParser.parse(probeSource, {}), imageSources);
  return candidates.filter((_, index) => imageSources.has(probeUrls[index]!));
}

export function replaceMarkdownImageReferences(
  markdown: unknown,
  references: readonly MarkdownImageReference[],
  resolve: (reference: MarkdownImageReference) => MarkdownImageReferenceReplacement,
): string {
  let output = String(markdown || '');
  for (let index = references.length - 1; index >= 0; index -= 1) {
    const reference = references[index]!;
    const replacement = resolve(reference);
    if (!replacement) continue;
    if ('replacement' in replacement) {
      output = `${output.slice(0, reference.start)}${replacement.replacement}${output.slice(reference.end)}`;
      continue;
    }
    output = `${output.slice(0, reference.targetStart)}${replacement.target}${output.slice(reference.targetEnd)}`;
  }
  return output;
}
