import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
} from '@services/shared/markdown-image-references';
import { parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

export function collectOrderedSyncnosAssetIds(markdown: unknown): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const reference of collectMarkdownImageReferences(markdown)) {
    const assetId = parseSyncnosAssetId(reference.target);
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
  const references = collectMarkdownImageReferences(markdown);
  return replaceMarkdownImageReferences(markdown, references, (reference) => {
    const assetId = parseSyncnosAssetId(reference.target);
    if (assetId == null) return null;
    const replacement = resolve({
      assetId,
      alt: reference.alt,
      title: reference.title,
      angleWrapped: reference.angleWrapped,
    });
    if (!replacement) return null;
    if ('replacement' in replacement) return replacement;
    return replacement.target ? { target: replacement.target } : null;
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
