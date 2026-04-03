export function resolveTargetRootIdFromSaveResult(result: unknown): number | null {
  const id = Number((result as { createdRootId?: unknown } | null | undefined)?.createdRootId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.round(id);
}

export function resolveTargetRootIdForReply(rootId: unknown): number | null {
  const id = Number(rootId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.round(id);
}

export function resolvePendingFocusTarget(input: {
  pendingFocusRootId: unknown;
  fallbackPendingFocusRootId: unknown;
  hasFocusWithinPanel: boolean;
  existingRootIds: Iterable<unknown>;
}): number | null {
  if (input.hasFocusWithinPanel !== true) return null;
  const explicit = Number(input.pendingFocusRootId);
  const fallback = Number(input.fallbackPendingFocusRootId);
  const candidate = Number.isFinite(explicit) && explicit > 0 ? explicit : fallback;
  if (!Number.isFinite(candidate) || candidate <= 0) return null;
  const normalized = Math.round(candidate);

  const rootIds = new Set<number>();
  for (const value of input.existingRootIds) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    rootIds.add(Math.round(n));
  }
  if (!rootIds.has(normalized)) return null;
  return normalized;
}
