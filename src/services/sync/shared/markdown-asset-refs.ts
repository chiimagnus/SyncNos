const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function stripAngleBrackets(value: string): string {
  const text = value.trim();
  return text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1).trim() : text;
}

export function parseSyncnosAssetId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const matched = /^syncnos-asset:\/\/(\d+)$/i.exec(stripAngleBrackets(value));
  if (!matched) return null;
  const id = Number(matched[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function collectOrderedSyncnosAssetIds(markdown: unknown): number[] {
  const text = String(markdown || '');
  if (!text) return [];

  const seen = new Set<number>();
  const ordered: number[] = [];
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const assetId = parseSyncnosAssetId(match[2]);
    if (assetId == null || seen.has(assetId)) continue;
    seen.add(assetId);
    ordered.push(assetId);
  }
  return ordered;
}

export type SyncnosAssetImageReference = {
  assetId: number;
  alt: string;
  title: string;
  angleWrapped: boolean;
};

export type SyncnosAssetImageReplacement = { target: string } | { replacement: string } | null;

export function replaceSyncnosAssetImageReferences(
  markdown: unknown,
  resolve: (reference: SyncnosAssetImageReference) => SyncnosAssetImageReplacement,
): string {
  const text = String(markdown || '');
  if (!text) return text;

  MARKDOWN_IMAGE_RE.lastIndex = 0;
  return text.replace(MARKDOWN_IMAGE_RE, (full, altRaw, targetRaw, titleRaw) => {
    const assetId = parseSyncnosAssetId(targetRaw);
    if (assetId == null) return full;
    const reference: SyncnosAssetImageReference = {
      assetId,
      alt: altRaw ? String(altRaw) : '',
      title: titleRaw ? String(titleRaw) : '',
      angleWrapped: String(targetRaw).trim().startsWith('<'),
    };
    const resolved = resolve(reference);
    if (!resolved) return full;
    if ('replacement' in resolved) return resolved.replacement;
    if (!resolved.target) return full;
    const target = reference.angleWrapped ? `<${resolved.target}>` : resolved.target;
    return `![${reference.alt}](${target}${reference.title})`;
  });
}

export function replaceSyncnosAssetImageTargets(
  markdown: unknown,
  targetByAssetId: ReadonlyMap<number, string>,
): string {
  if (targetByAssetId.size === 0) return String(markdown || '');
  return replaceSyncnosAssetImageReferences(markdown, ({ assetId }) => {
    const target = targetByAssetId.get(assetId);
    return target ? { target } : null;
  });
}
