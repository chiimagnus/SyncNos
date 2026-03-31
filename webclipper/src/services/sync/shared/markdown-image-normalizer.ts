const STANDALONE_IMAGE_WITH_TRAILING_TEXT_RE =
  /^(\s*!\[[^\]]*\]\(\s*(?:<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\))\s*(.+)$/gm;

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
  const src = String(markdown || '');
  if (!src) return '';

  return src.replace(STANDALONE_IMAGE_WITH_TRAILING_TEXT_RE, (_full, imageRaw, trailingTextRaw) => {
    const image = String(imageRaw || '');
    const trailingText = String(trailingTextRaw || '').trim();
    if (!trailingText) return image;
    return `${image}\n\n${trailingText}`;
  });
}

export default {
  normalizeStandaloneImageCaptionLines,
};
