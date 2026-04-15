export type OutlineRectLike = {
  top: number;
  bottom: number;
};

export type OutlineIndexCandidate = {
  index: number;
  top: number;
  bottom: number;
};

export function computeOutlineCenterY(input: {
  rootRect: OutlineRectLike | null;
  viewportRect: OutlineRectLike;
  messagesRect?: OutlineRectLike | null;
}): number {
  const baseRoot = input.rootRect || input.viewportRect;
  const visibleTop = Math.max(baseRoot.top, input.messagesRect?.top ?? baseRoot.top);
  return (visibleTop + baseRoot.bottom) / 2;
}

function normalizeCandidates(candidates: OutlineIndexCandidate[]): OutlineIndexCandidate[] {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  return candidates.filter((candidate) => Number.isFinite(candidate.index) && candidate.index > 0);
}

function pickClosest(centerY: number, candidates: OutlineIndexCandidate[]): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const center = (candidate.top + candidate.bottom) / 2;
    const distance = Math.abs(center - centerY);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestIndex = candidate.index;
  }
  return bestIndex;
}

export function pickActiveOutlineIndex(input: {
  centerY: number;
  visibleCandidates: OutlineIndexCandidate[];
  allCandidates?: OutlineIndexCandidate[];
  previousActiveIndex?: number | null;
}): number | null {
  const visibleCandidates = normalizeCandidates(input.visibleCandidates);
  if (visibleCandidates.length > 0) return pickClosest(input.centerY, visibleCandidates);

  const previous = Number(input.previousActiveIndex);
  if (Number.isFinite(previous) && previous > 0) return Math.trunc(previous);

  const fallbackCandidates = normalizeCandidates(input.allCandidates || []);
  if (!fallbackCandidates.length) return null;
  return pickClosest(input.centerY, fallbackCandidates);
}
