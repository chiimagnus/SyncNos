import { collectMarkdownImageReferences } from '@services/shared/markdown-image-references';

/**
 * Discourse 风格图片行经常是：
 *   ![alt](https://...png)Caption text...
 * 该写法在部分下游（尤其是行级解析器）里不会被当作独立图片块。
 *
 * 将其规范化为：
 *   ![alt](https://...png)
 *
 *   Caption text...
 */
export function normalizeStandaloneImageCaptionLines(markdown: unknown): string {
  const source = String(markdown || '');
  if (!source) return '';

  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const reference of collectMarkdownImageReferences(source)) {
    const lineStart = source.lastIndexOf('\n', Math.max(0, reference.start - 1)) + 1;
    if (source.slice(lineStart, reference.start).trim()) continue;
    const nextNewline = source.indexOf('\n', reference.end);
    const lineEnd = nextNewline >= 0 ? nextNewline : source.length;
    const caption = source.slice(reference.end, lineEnd).trim();
    if (!caption) continue;
    edits.push({ start: reference.end, end: lineEnd, text: `\n\n${caption}` });
  }

  let output = source;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!;
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  return output;
}

export default {
  normalizeStandaloneImageCaptionLines,
};
