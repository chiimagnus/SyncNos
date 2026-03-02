export type CollectorDefinition = {
  id: string;
  matches: (location: { href?: string; hostname?: string; pathname?: string }) => boolean;
  inpageMatches?: (location: { href?: string; hostname?: string; pathname?: string }) => boolean;
  collector: {
    capture: (options?: Record<string, unknown>) => unknown;
    [key: string]: unknown;
  };
};

export function assertCollectorDef(definition: unknown): CollectorDefinition {
  const normalized = definition as Partial<CollectorDefinition> | null;
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('collector def must be an object');
  }
  if (!normalized.id || typeof normalized.id !== 'string') {
    throw new Error('collector def missing id');
  }
  if (typeof normalized.matches !== 'function') {
    throw new Error(`collector ${normalized.id} missing matches()`);
  }
  if (!normalized.collector || typeof normalized.collector.capture !== 'function') {
    throw new Error(`collector ${normalized.id} missing capture()`);
  }
  return normalized as CollectorDefinition;
}
